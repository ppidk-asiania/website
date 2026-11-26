import "server-only";
import { z } from "zod";
import type { SqlOrgDocumentStore } from "@website/db/sql";
import {
  MAX_ORG_DOCUMENT_BYTES,
  OrgDocumentInputSchema,
  orgDocumentPath,
  type OrgDocument,
} from "@website/domain/organizations";
import { isPdf, RuleViolationError } from "@website/domain/shared";
import { jsonError, readBodyLimited } from "@website/security";
import { safeId, safeText } from "@website/security/validation";
import type { Principal } from "@website/permissions";
import { createGuardedAction, type AuditBuilder, type AuditContext } from "./guarded-action";

export interface OrgDocumentDeps {
  readonly documents: Pick<SqlOrgDocumentStore, "write">;
  readonly storage: {
    save(
      path: string,
      bytes: Uint8Array,
      options: { visibility: "public"; contentType: "application/pdf" },
    ): Promise<unknown>;
  };
  readonly now: () => Date;
  readonly uuid: () => string;
}

const SaveInput = OrgDocumentInputSchema.and(
  z.object({ id: safeId.optional(), version: z.number().int().min(1).nullable() }).strict(),
);
const RefInput = z.object({ id: safeId, version: z.number().int().min(1) }).strict();

type Action = "CREATE" | "UPDATE" | "PUBLISH" | "UNPUBLISH" | "DELETE";

const documentAudit =
  (audit: AuditBuilder, action: Action) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: OrgDocument | null,
    next: OrgDocument,
  ) =>
    audit({
      module: "organizations",
      action,
      resourceType: "orgDocument",
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
    return decodeURIComponent(header ?? "") || "document.pdf";
  } catch {
    return "document.pdf";
  }
}

export function createOrgDocumentActions(deps: OrgDocumentDeps) {
  const save = createGuardedAction({
    permission: "organizations.edit",
    input: SaveInput,
    handler: async ({ id, version, ...input }, _principal, audit) => {
      let action: Action = "CREATE";
      const saved = await deps.documents.write(
        id ?? null,
        version,
        (current) => {
          if (current) {
            action =
              input.published !== current.published
                ? input.published
                  ? "PUBLISH"
                  : "UNPUBLISH"
                : "UPDATE";
          }
          return { ...input, deletedAt: null };
        },
        (before, after, current, next) =>
          documentAudit(audit, action)(before, after, current, next),
        deps.now(),
      );
      return { id: saved.id, version: saved.version };
    },
  });

  const remove = createGuardedAction({
    permission: "organizations.edit",
    input: RefInput,
    handler: async ({ id, version }, _principal, audit) => {
      const now = deps.now();
      await deps.documents.write(
        id,
        version,
        (current) => ({ ...(current as OrgDocument), deletedAt: now }),
        documentAudit(audit, "DELETE"),
        now,
      );
      return { id };
    },
  });

  // A replaced version stays downloadable: nothing here ever deletes a file.
  const upload = createGuardedAction({
    permission: "organizations.edit",
    input: z.object({ name: safeText(200), request: z.instanceof(Request) }).strict(),
    handler: async ({ name, request }) => {
      const bytes = await readBodyLimited(request, MAX_ORG_DOCUMENT_BYTES);
      if (bytes === null) throw new RuleViolationError("The document may be at most 10 MB.");
      if (!isPdf(bytes)) throw new RuleViolationError("Upload the document as a PDF.");
      const path = orgDocumentPath(deps.uuid());
      await deps.storage.save(path, bytes, {
        visibility: "public",
        contentType: "application/pdf",
      });
      return { path, name, size: bytes.length };
    },
  });

  const uploadFile =
    (getPrincipal: () => Promise<Principal | null>, getAuditContext: () => Promise<AuditContext>) =>
    async (request: Request): Promise<Response> => {
      const result = await upload(
        getPrincipal,
        getAuditContext,
      )({ name: fileName(request.headers.get("x-file-name")), request });
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

  return { save, remove, uploadFile };
}
