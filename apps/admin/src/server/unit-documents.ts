import "server-only";
import { z } from "zod";
import type { SqlUnitDocumentStore } from "@website/db/sql";
import {
  DEFAULT_UNIT_CAP_BYTES,
  MAX_UNIT_DOCUMENT_BYTES,
  UNIT_DOCUMENT_RETENTION_DAYS,
  UnitDocumentMetaSchema,
  UnitDocumentUpdateSchema,
  unitDocumentExtension,
  unitDocumentPath,
  unitDocumentRights,
  type UnitDocument,
  type UnitDocumentViewer,
} from "@website/domain/organizations";
import type { ActiveSeat } from "@website/domain/organizations";
import { RuleViolationError } from "@website/domain/shared";
import { can, canAccessAdmin, type Principal } from "@website/permissions";
import { jsonError, readBodyLimited } from "@website/security";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder, type AuditContext } from "./guarded-action";

export interface UnitDocumentDeps {
  readonly documents: Pick<
    SqlUnitDocumentStore,
    "get" | "write" | "bytesOf" | "listTrashed" | "purge"
  >;
  readonly storage: {
    save(
      path: string,
      bytes: Uint8Array,
      options: { visibility: "private"; contentType: "application/octet-stream" },
    ): Promise<unknown>;
    remove(path: string): Promise<void>;
    signedReadUrl(path: string): Promise<string>;
  };
  readonly activePeriod: () => Promise<{ id: string } | null>;
  readonly seats: (uid: string) => Promise<ActiveSeat[]>;
  readonly unitPeriod: (orgUnitId: string) => Promise<string | null>;
  readonly capBytes: () => Promise<number>;
  readonly now: () => Date;
  readonly uuid: () => string;
}

const Ref = z.object({ id: safeId, version: z.number().int().min(1) }).strict();
type Action = "CREATE" | "UPDATE" | "DELETE";

const documentAudit =
  (audit: AuditBuilder, action: Action) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: UnitDocument | null,
    next: UnitDocument,
  ) =>
    audit({
      module: "documents",
      action,
      resourceType: "unitDocument",
      resourceId: next.id,
      title: next.title,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible: false,
    });

function fileName(header: string | null): string {
  try {
    return decodeURIComponent(header ?? "") || "file";
  } catch {
    return "file";
  }
}

export function createUnitDocumentActions(deps: UnitDocumentDeps) {
  const viewerOf = async (principal: Principal): Promise<UnitDocumentViewer> => {
    const [period, seats] = await Promise.all([deps.activePeriod(), deps.seats(principal.userId)]);
    return {
      activePeriodId: period?.id ?? null,
      seatUnitIds: seats.map((s) => s.orgUnitId),
      editor: can(principal, "documents.edit"),
    };
  };
  // The first way in without the extra: any seat in the active period. Each handler still checks the folder.
  const orIf = async (principal: Principal) => (await deps.seats(principal.userId)).length > 0;

  const upload = createGuardedAction({
    permission: "documents.edit",
    orIf,
    input: UnitDocumentMetaSchema.extend({
      orgUnitId: safeId.nullable(),
      name: safeText(200),
      request: z.instanceof(Request),
    }).strict(),
    handler: async ({ orgUnitId, folder, title, name, request }, principal, audit) => {
      const viewer = await viewerOf(principal);
      if (viewer.activePeriodId === null)
        throw new RuleViolationError("Activate a board period first.");
      const target = { periodId: viewer.activePeriodId, orgUnitId };
      if (!unitDocumentRights(viewer, target).write) {
        throw new RuleViolationError("You may not add files to this folder.");
      }
      if (orgUnitId !== null && (await deps.unitPeriod(orgUnitId)) !== viewer.activePeriodId) {
        throw new RuleViolationError("Choose a unit of the active board period.");
      }
      const bytes = await readBodyLimited(request, MAX_UNIT_DOCUMENT_BYTES);
      if (bytes === null) throw new RuleViolationError("A file may be at most 10 MB.");
      const ext = unitDocumentExtension(name, bytes);
      if (ext === null) {
        throw new RuleViolationError("Use a PDF, Word, Excel, PowerPoint or image file.");
      }
      // shortcut: the cap is checked before the write without a lock, so two uploads at once can pass it by one file; upgrade if that matters.
      const used = await deps.documents.bytesOf(viewer.activePeriodId, orgUnitId);
      if (used + bytes.length > (await deps.capBytes())) {
        throw new RuleViolationError("This unit has used up its space for documents.");
      }
      const path = unitDocumentPath(viewer.activePeriodId, deps.uuid(), ext);
      await deps.storage.save(path, bytes, {
        visibility: "private",
        contentType: "application/octet-stream",
      });
      const saved = await deps.documents.write(
        null,
        null,
        () => ({
          ...target,
          folder,
          title,
          file: { path, name, size: bytes.length },
          uploadedBy: principal.userId,
          deletedAt: null,
        }),
        documentAudit(audit, "CREATE"),
        deps.now(),
      );
      return { id: saved.id, version: saved.version };
    },
  });

  /** Rename, move to another folder, or delete: the same check on the stored row. */
  const change = (
    action: Action,
    build: (current: UnitDocument, input: { title: string; folder: string }) => UnitDocument,
  ) =>
    createGuardedAction({
      permission: "documents.edit",
      orIf,
      input: action === "UPDATE" ? UnitDocumentUpdateSchema : Ref,
      handler: async (input, principal, audit) => {
        const doc = await deps.documents.get(input.id);
        if (!doc || doc.deletedAt) throw new RuleViolationError("This file does not exist.");
        if (!unitDocumentRights(await viewerOf(principal), doc).write) {
          throw new RuleViolationError("You may not change files in this folder.");
        }
        const meta = input as { title?: string; folder?: string };
        const saved = await deps.documents.write(
          input.id,
          input.version,
          (current) =>
            build(current as UnitDocument, { title: meta.title ?? "", folder: meta.folder ?? "" }),
          documentAudit(audit, action),
          deps.now(),
        );
        return { version: saved.version };
      },
    });

  const update = change("UPDATE", (d, { title, folder }) => ({ ...d, title, folder }));
  const remove = change("DELETE", (d) => ({ ...d, deletedAt: deps.now() }));

  /** Opens a file through the 15-minute signed link, after the same read check. */
  const open = async (id: string, principal: Principal | null): Promise<Response> => {
    if (principal === null || !principal.active) return jsonError("unauthenticated");
    if (!canAccessAdmin(principal)) return jsonError("forbidden");
    const doc = await deps.documents.get(id);
    if (!doc || doc.deletedAt || !unitDocumentRights(await viewerOf(principal), doc).read) {
      return Response.json(
        { error: "not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: await deps.storage.signedReadUrl(doc.file.path),
        "Cache-Control": "no-store",
      },
    });
  };

  const uploadFile =
    (getPrincipal: () => Promise<Principal | null>, getAuditContext: () => Promise<AuditContext>) =>
    async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const result = await upload(
        getPrincipal,
        getAuditContext,
      )({
        orgUnitId: url.searchParams.get("unit") || null,
        folder: url.searchParams.get("folder") ?? "",
        title: url.searchParams.get("title") ?? "",
        name: fileName(request.headers.get("x-file-name")),
        request,
      });
      if (result.ok) {
        return Response.json(result.data, {
          status: 201,
          headers: { "Cache-Control": "no-store" },
        });
      }
      if (result.error === "refused" || result.error === "invalid_input") {
        return Response.json(
          { error: "invalid_input", message: result.issues?.[0] },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }
      return jsonError(result.error === "unauthenticated" ? "unauthenticated" : "forbidden");
    };

  /** `expire` job: a deleted file and its row go 30 days after the delete. */
  async function purge(): Promise<number> {
    const cutoff = deps.now().getTime() - UNIT_DOCUMENT_RETENTION_DAYS * 86_400_000;
    const due = (await deps.documents.listTrashed()).filter(
      (d) => d.deletedAt !== null && d.deletedAt.getTime() <= cutoff,
    );
    for (const doc of due) {
      await deps.storage.remove(doc.file.path);
      await deps.documents.purge(doc.id);
    }
    return due.length;
  }

  return { update, remove, open, uploadFile, purge, viewerOf, defaultCap: DEFAULT_UNIT_CAP_BYTES };
}
