import "server-only";
import { z } from "zod";
import type { AuditAction } from "@website/audit";
import type {
  SqlLetterSettingsStore,
  SqlLetterStore,
  SqlLetterTypeStore,
  LetterAudit,
} from "@website/db/sql";
import {
  attachUpload,
  cancelLetter,
  checkUploadedNumber,
  issueUpload,
  letterUploadPath,
  MAX_LETTER_UPLOAD_BYTES,
  placeStamps,
  UploadPlacementSchema,
  LetterheadSchema,
  LetterInputSchema,
  LetterTypeInputSchema,
  passReview,
  returnLetter,
  signDesk,
  submitForReview,
  type Desk,
  type Letter,
  type LetterType,
} from "@website/domain/documents";
import type { ActiveSeat, PeriodDeskKey } from "@website/domain/organizations";
import { isPdf, RuleViolationError } from "@website/domain/shared";
import { openPdf, pdfText, type UnreadablePdfError } from "@website/pdf";
import { can, type Permission, type Principal, type ResourceContext } from "@website/permissions";
import { jsonError, readBodyLimited, sha256Hex } from "@website/security";
import { sanitizeRichText } from "@website/security/html";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder, type AuditContext } from "./guarded-action";
import type { LetterPdf } from "./letter-pdf";

export interface LetterDeps {
  readonly letters: Pick<
    SqlLetterStore,
    "get" | "create" | "update" | "transition" | "remove" | "issue"
  >;
  readonly types: Pick<SqlLetterTypeStore, "save">;
  readonly settings: Pick<SqlLetterSettingsStore, "get" | "save">;
  readonly afterIssue: (letter: Letter) => Promise<void>;
  /** The unit a period's desk is bound to (`period.desks.<desk>.orgUnitId`), or null. */
  readonly deskUnit: (periodId: string, desk: PeriodDeskKey) => Promise<string | null>;
  readonly seats: (uid: string) => Promise<readonly ActiveSeat[]>;
  readonly unitPath: (orgUnitId: string) => Promise<readonly string[] | null>;
  readonly storage: {
    save(
      path: string,
      bytes: Uint8Array,
      options: { visibility: "private"; contentType: "application/pdf" },
    ): Promise<unknown>;
    remove(path: string): Promise<void>;
  };
  readonly files: Pick<LetterPdf, "stampUpload" | "saveFile">;
  readonly afterStep: (letter: Letter) => Promise<void>;
  readonly now: () => Date;
  readonly uuid: () => string;
}

const Ref = z.object({ id: safeId, version: z.number().int().min(1) }).strict();
const SaveLetter = LetterInputSchema.and(
  z
    .object({
      id: safeId.optional(),
      version: z.number().int().min(1).nullable(),
      source: z.enum(["editor", "upload", "certificate"]).optional(),
    })
    .strict(),
);
const SaveType = LetterTypeInputSchema.and(
  z.object({ id: safeId.optional(), version: z.number().int().min(1).nullable() }).strict(),
);

const letterAudit =
  (audit: AuditBuilder, action: AuditAction): LetterAudit =>
  (before, after, current, next) =>
    audit({
      module: "letters",
      action,
      resourceType: "letter",
      resourceId: next.id,
      title: next.numberFormatted ?? next.subject,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible: false,
    });

export function createLetterActions(deps: LetterDeps) {
  const scopeOf = async ({ id }: { id: string }): Promise<ResourceContext> => {
    const letter = await deps.letters.get(id);
    return { orgUnitPath: letter?.orgUnitPath ?? [] };
  };
  const unitScope = async (orgUnitId: string): Promise<ResourceContext> => ({
    orgUnitPath: (await deps.unitPath(orgUnitId)) ?? [],
  });

  // A top-desk letter is written, edited and submitted by top-desk holders (and superadmins) only.
  const assertMayHandle = (
    letter: { readonly topDeskOnly: boolean } & ResourceContext,
    principal: Principal,
  ) => {
    if (letter.topDeskOnly && !can(principal, "letters.sign_coordinator", letter)) {
      throw new RuleViolationError("Only the top desk handles this letter.");
    }
  };

  const clean = <T extends z.infer<typeof LetterInputSchema>>(input: T): T => ({
    ...input,
    body: sanitizeRichText(input.body),
  });

  const save = createGuardedAction({
    permission: "letters.edit",
    input: SaveLetter,
    resource: (input) => (input.id ? scopeOf({ id: input.id }) : unitScope(input.orgUnitId)),
    handler: async ({ id, version, source, ...input }, principal, audit) => {
      const now = deps.now();
      const scope = await unitScope(input.orgUnitId);
      const current = id ? await deps.letters.get(id) : null;
      if (current) assertMayHandle(current, principal);
      if (input.topDeskOnly) assertMayHandle({ ...input, ...scope }, principal);
      if (id) {
        if (!can(principal, "letters.edit", scope)) {
          throw new RuleViolationError("You can only write letters for your own unit.");
        }
        const saved = await deps.letters.update(
          id,
          version as number,
          clean(input),
          letterAudit(audit, "UPDATE"),
          now,
        );
        return { id: saved.id, version: saved.version };
      }
      const saved = await deps.letters.create(
        clean(input),
        principal.userId,
        letterAudit(audit, "CREATE"),
        now,
        source,
      );
      return { id: saved.id, version: saved.version };
    },
  });

  const step = (
    permission: Permission,
    input: z.ZodType<{ id: string; version: number } & Record<string, unknown>>,
    action: AuditAction,
    decide: (
      letter: Letter,
      type: LetterType,
      input: Record<string, unknown>,
      uid: string,
      now: Date,
    ) => Letter | Promise<Letter>,
  ) =>
    createGuardedAction({
      permission,
      input,
      resource: scopeOf,
      handler: async ({ id, version, ...rest }, principal, audit) => {
        const now = deps.now();
        const saved = await deps.letters.transition(
          id,
          version,
          (letter, type) => {
            if (permission === "letters.edit") assertMayHandle(letter, principal);
            return decide(letter, type, rest, principal.userId, now);
          },
          letterAudit(audit, action),
          now,
        );
        await deps.afterStep(saved);
        return { version: saved.version, status: saved.status };
      },
    });

  // The unit's own signer desk (no top desk on the letter type) is never bound.
  const sign =
    (desk: Desk) =>
    async (letter: Letter, type: LetterType, _: unknown, uid: string, now: Date) => {
      const key =
        desk === "coordinator" ? "coordinator" : type.requiresCoordinator ? "signer" : null;
      const bound = key && (await deps.deskUnit(letter.periodId, key));
      if (bound && !(await deps.seats(uid)).some((seat) => seat.orgUnitId === bound)) {
        throw new RuleViolationError("This desk is bound to a unit: signing needs a seat in it.");
      }
      return signDesk(letter, type, desk, uid, now);
    };

  const remove = createGuardedAction({
    permission: "letters.edit",
    input: Ref,
    resource: scopeOf,
    handler: async ({ id, version }, principal, audit) => {
      const letter = await deps.letters.get(id);
      if (letter) assertMayHandle(letter, principal);
      await deps.letters.remove(id, version, letterAudit(audit, "DELETE"), deps.now());
      return { id };
    },
  });

  const issue = createGuardedAction({
    permission: "letters.issue",
    input: Ref,
    resource: scopeOf,
    handler: async ({ id, version }, _principal, audit) => {
      const { letterhead } = await deps.settings.get();
      const issued = await deps.letters.issue(
        id,
        version,
        letterhead,
        letterAudit(audit, "PUBLISH"),
        deps.now(),
      );
      if (issued.status === "issued" && issued.source === "editor") await deps.afterIssue(issued);
      return {
        status: issued.status,
        version: issued.version,
        numberFormatted: issued.numberFormatted,
        verificationCode: issued.verificationCode,
      };
    },
  });

  const saveType = createGuardedAction({
    permission: "letter_types.edit",
    input: SaveType,
    handler: async ({ id, version, ...input }, _principal, audit) => {
      const saved = await deps.types.save(
        id ?? null,
        version,
        input,
        (before, after, current, next) =>
          audit({
            module: "letter_types",
            action: current ? "UPDATE" : "CREATE",
            resourceType: "letterType",
            resourceId: next.id,
            title: `${next.code} — ${next.name}`,
            before,
            after,
            versionBefore: current?.version ?? null,
            versionAfter: next.version,
            revertible: false,
          }),
        deps.now(),
      );
      return { id: saved.id, version: saved.version };
    },
  });

  const saveLetterhead = createGuardedAction({
    permission: "letter_types.edit",
    input: z
      .object({ letterhead: LetterheadSchema, version: z.number().int().min(1).nullable() })
      .strict(),
    handler: async ({ letterhead, version }, principal, audit) => {
      const current = (await deps.settings.get()).letterhead;
      if (letterhead.stamp?.path !== current.stamp?.path && !can(principal, "letters.stamp")) {
        throw new RuleViolationError("Only holders of the stamp permission change the stamp.");
      }
      return {
        version: await deps.settings.save(letterhead, version, (before, after, next) =>
          audit({
            module: "letter_types",
            action: "UPDATE",
            resourceType: "letterhead",
            resourceId: "letters",
            title: "Letterhead",
            before,
            after,
            versionBefore: version,
            versionAfter: next,
            revertible: false,
          }),
        ),
      };
    },
  });

  const upload = createGuardedAction({
    permission: "letters.edit",
    input: Ref.extend({ request: z.instanceof(Request) }).strict(),
    resource: scopeOf,
    handler: async ({ id, version, request }, principal, audit) => {
      const bytes = await readBodyLimited(request, MAX_LETTER_UPLOAD_BYTES);
      if (bytes === null) throw new RuleViolationError("The PDF may be at most 10 MB.");
      if (!isPdf(bytes)) throw new RuleViolationError("Export the document as a PDF first.");
      const letter = await deps.letters.get(id);
      if (letter?.status !== "awaiting_file") {
        throw new RuleViolationError("This letter is not waiting for its file.");
      }
      assertMayHandle(letter, principal);
      await openPdf(bytes).catch((error: UnreadablePdfError) => {
        throw new RuleViolationError(error.message);
      });
      const numberChecked = checkUploadedNumber(
        await pdfText(bytes),
        letter.numberFormatted as string,
      );
      const now = deps.now();
      const path = letterUploadPath(letter, deps.uuid());
      await deps.storage.save(path, bytes, {
        visibility: "private",
        contentType: "application/pdf",
      });
      const file = {
        path,
        sha256: sha256Hex(bytes),
        size: bytes.length,
        numberChecked,
        uploadedBy: principal.userId,
        uploadedAt: now,
      };
      const saved = await deps.letters.transition(
        id,
        version,
        (current) => attachUpload(current, file),
        letterAudit(audit, "UPLOAD"),
        now,
      );
      if (letter.upload) await deps.storage.remove(letter.upload.path);
      return { version: saved.version, numberChecked };
    },
  });

  const issueFile = createGuardedAction({
    permission: "letters.issue",
    input: Ref,
    resource: scopeOf,
    handler: async ({ id, version }, _principal, audit) => {
      const letter = await deps.letters.get(id);
      if (!letter?.upload || letter.version !== version) {
        throw new RuleViolationError("Upload the final PDF first (or reload the page).");
      }
      if (!letter.placement?.qr) {
        throw new RuleViolationError(
          "Save the QR and signature positions first, then check the preview.",
        );
      }
      const stampedFrom = letter.upload.sha256;
      const archive = await deps.files.saveFile(letter, await deps.files.stampUpload(letter));
      const now = deps.now();
      const saved = await deps.letters.transition(
        id,
        version,
        (current) => issueUpload(current, archive, stampedFrom, now),
        letterAudit(audit, "PUBLISH"),
        now,
      );
      return { version: saved.version, status: saved.status };
    },
  });

  const uploadFile =
    (getPrincipal: () => Promise<Principal | null>, getAuditContext: () => Promise<AuditContext>) =>
    async (id: string, request: Request): Promise<Response> => {
      const version = Number(new URL(request.url).searchParams.get("version"));
      const result = await upload(getPrincipal, getAuditContext)({ id, version, request });
      const noStore = { "Cache-Control": "no-store" };
      if (result.ok) return Response.json(result.data, { status: 201, headers: noStore });
      if (result.error === "refused" || result.error === "invalid_input") {
        return Response.json(
          { error: "invalid_input", message: result.issues?.[0] },
          { status: 400, headers: noStore },
        );
      }
      return jsonError(
        result.error === "unauthenticated"
          ? "unauthenticated"
          : result.error === "conflict"
            ? "conflict"
            : "forbidden",
      );
    };

  const Note = Ref.extend({ note: safeText(1000, { multiline: true, allowEmpty: true }) }).strict();
  const Reason = Ref.extend({ reason: safeText(300, { allowEmpty: true }) }).strict();

  return {
    save,
    remove,
    submit: step("letters.edit", Ref, "UPDATE", (letter, type) => submitForReview(letter, type)),
    pass: step("letters.review", Ref, "UPDATE", (letter, type, _input, uid) =>
      passReview(letter, type, uid),
    ),
    returnToDraft: step("letters.review", Note, "UPDATE", (letter, _type, input, uid) =>
      returnLetter(letter, uid, input["note"] as string),
    ),
    signSecretary: step("letters.sign", Ref, "UPDATE", sign("secretary")),
    signCoordinator: step("letters.sign_coordinator", Ref, "UPDATE", sign("coordinator")),
    issue,
    cancel: step("letters.cancel", Reason, "UNPUBLISH", (letter, _type, input, _uid, now) =>
      cancelLetter(letter, input["reason"] as string, now),
    ),
    saveType,
    saveLetterhead,
    upload,
    uploadFile,
    place: step(
      "letters.edit",
      Ref.extend({ placement: UploadPlacementSchema }).strict(),
      "UPDATE",
      (letter, _type, input) =>
        placeStamps(letter, input["placement"] as z.infer<typeof UploadPlacementSchema>),
    ),
    issueFile,
  };
}
