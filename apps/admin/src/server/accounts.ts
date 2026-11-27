import "server-only";
import { z } from "zod";
import { hasTwoSignInMethods, type AccountAdmin, type PasskeyStore } from "@website/auth";
import type { AuditEvent } from "@website/audit";
import type { AuditChange, Invite, UserSummary } from "@website/db";
import type { SqlAccountStore, SqlMemberProfileStore, SqlRoleStore } from "@website/db/sql";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";
import { logSecurityEvent, type Logger } from "@website/observability";
import {
  accountChangeRefusal,
  canAssignRole,
  isWebsiteRole,
  sameScope,
  type AccountChangeRefusal,
  type Principal,
  type RoleAssignment,
  type RoleDefinition,
} from "@website/permissions";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface AccountDeps {
  readonly accounts: Pick<
    SqlAccountStore,
    "change" | "get" | "findByEmail" | "findByName" | "searchByPrefix" | "invite" | "cancelInvite"
  >;
  readonly roles: Pick<SqlRoleStore, "get" | "list">;
  readonly memberProfiles: Pick<SqlMemberProfileStore, "findByUserId">;
  readonly passkeys: Pick<PasskeyStore, "listByUser">;
  readonly authAdmin: AccountAdmin;
  readonly logger: Logger;
  readonly sendInvite: (invite: Invite, roleName: string) => Promise<unknown>;
}

const REFUSAL_MESSAGE: Record<AccountChangeRefusal, string> = {
  self: "You cannot change your own account. Ask another administrator.",
  forbidden: "You can only give or remove roles whose permissions you hold yourself.",
  last_superadmin: "This is the last active superadmin. Make someone else superadmin first.",
};

const ScopeInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }).strict(),
  z.object({ type: z.literal("chapter"), chapterId: safeId }).strict(),
  z.object({ type: z.literal("orgUnit"), orgUnitId: safeId }).strict(),
]);
const RoleChangeInput = z
  .object({
    uid: safeId,
    version: z.number().int().min(0),
    roleId: safeId,
    scope: ScopeInput,
    periodId: safeId.nullable().optional(),
  })
  .strict();
const StatusInput = z
  .object({ uid: safeId, version: z.number().int().min(0), status: z.enum(["active", "inactive"]) })
  .strict();
const PersonInput = z
  .object({
    person: safeText(120).refine(
      (value) => !value.includes("@") || z.email().safeParse(value).success,
      "Type a valid e-mail address.",
    ),
    roleId: safeId,
  })
  .strict();
const InviteRef = z.object({ email: z.email().max(254) }).strict();

/** The most lines one pasted list may have. */
export const MAX_PEOPLE_LINES = 100;
const PeopleListInput = z
  .object({
    list: z.string().max(30_000),
    /** The role of a line that names none. */
    roleId: safeId.nullable(),
  })
  .strict();

export type PersonLineOutcome =
  "invite" | "assign" | "duplicate" | "unknown_role" | "not_allowed" | "invalid";
export interface PersonLine {
  /** Position among the non-empty lines (1 = the first). */
  readonly line: number;
  readonly email: string;
  readonly roleName: string | null;
  readonly outcome: PersonLineOutcome;
}
export interface PersonLineReport extends PersonLine {
  /** What was done; null when the line was not applied (see `outcome`). */
  readonly done: "invited" | "assigned" | "failed" | null;
  readonly message?: string;
}

const sameAssignment = (a: RoleAssignment, b: RoleAssignment) =>
  a.roleId === b.roleId &&
  sameScope(a.scope, b.scope) &&
  (a.periodId ?? null) === (b.periodId ?? null) &&
  !a.revokedAt &&
  !b.revokedAt;

const isStaffRole = (role: RoleDefinition) => role.permissions.length > 0;

const accountAudit =
  (audit: AuditBuilder) =>
  (change: AuditChange, current: UserSummary): AuditEvent =>
    audit({
      module: "users",
      action: "UPDATE",
      resourceType: "user",
      resourceId: current.uid,
      title: current.email ?? current.uid,
      ...change,
      revertible: false,
    });

export function createAccountActions(deps: AccountDeps) {
  const refuse = (reason: AccountChangeRefusal | null) => {
    if (reason) throw new RuleViolationError(REFUSAL_MESSAGE[reason]);
  };
  const loadRole = async (roleId: string) => {
    const role = await deps.roles.get(roleId);
    if (!role) throw new RuleViolationError("This role does not exist.");
    return role;
  };
  const afterChange = async (actor: Principal, target: UserSummary, details: object) => {
    await deps.authAdmin.revokeSessions(target.uid);
    logSecurityEvent(deps.logger, {
      type: "staff.role_changed",
      actorId: actor.userId,
      details: { targetId: target.uid, ...details },
    });
  };

  const give = async (
    input: z.infer<typeof RoleChangeInput>,
    principal: Principal,
    audit: AuditBuilder,
  ) => {
    const role = await loadRole(input.roleId);
    if (isStaffRole(role)) {
      const [methods, passkeys] = await Promise.all([
        deps.authAdmin.signInMethods(input.uid),
        deps.passkeys.listByUser(input.uid),
      ]);
      if (!hasTwoSignInMethods({ ...methods, passkeys: passkeys.length })) {
        throw new RuleViolationError(
          "This account needs a second sign-in method first: two-step verification, or a passkey plus Google or a password (web → Your account).",
        );
      }
    }
    const added: RoleAssignment = {
      roleId: role.id,
      scope: input.scope,
      periodId: input.periodId ?? null,
      source: "manual",
      revokedAt: null,
    };
    const website = isWebsiteRole(added);
    const account = website ? await deps.accounts.get(input.uid) : null;
    const replacedIds = (account?.roleAssignments ?? [])
      .filter((a) => isWebsiteRole(a) && a.roleId !== role.id)
      .map((a) => a.roleId);
    const replaced = (await Promise.all(replacedIds.map((id) => deps.roles.get(id)))).filter(
      (r) => r !== null,
    );
    const updated = await deps.accounts.change(
      input.uid,
      input.version,
      (current, superadminsAfter) => {
        refuse(
          accountChangeRefusal({
            actor: principal,
            targetUserId: input.uid,
            role,
            superadminsAfter,
          }),
        );
        for (const old of replaced) {
          refuse(
            accountChangeRefusal({
              actor: principal,
              targetUserId: input.uid,
              role: old,
              superadminsAfter,
            }),
          );
        }
        if (current.roleAssignments.some((a) => sameAssignment(a, added))) {
          throw new RuleViolationError("The account already has this role in this scope.");
        }
      },
      {
        roleAssignmentsFrom: (current) => [
          ...current.roleAssignments.filter((a) => !(website && isWebsiteRole(a))),
          added,
        ],
      },
      accountAudit(audit),
    );
    await afterChange(principal, updated, {
      added: role.id,
      scope: input.scope.type,
      ...(replacedIds.length > 0 ? { replaced: replacedIds } : {}),
    });
    return { version: updated.version };
  };

  const assignRole = createGuardedAction({
    permission: "users.edit",
    input: RoleChangeInput,
    recentSignIn: true,
    handler: give,
  });

  /** One person: the role at once when an account exists, else an invite. Shared by the single form and the pasted list. */
  const addOne = async (
    { person, roleId }: z.infer<typeof PersonInput>,
    principal: Principal,
    audit: AuditBuilder,
  ) => {
    const isEmail = person.includes("@");
    const found = isEmail
      ? [await deps.accounts.findByEmail(person)].filter((u) => u !== null)
      : await deps.accounts.findByName(person);
    if (found.length > 1) {
      throw new RuleViolationError("Several accounts have this name. Use the e-mail address.");
    }
    const account = found[0];
    if (account) {
      const scope = { type: "global" } as const;
      await give({ uid: account.uid, version: account.version, roleId, scope }, principal, audit);
      return { invited: false };
    }
    if (!isEmail) {
      throw new RuleViolationError(
        "No account has this name. Invite the person by e-mail instead.",
      );
    }
    const role = await loadRole(roleId);
    if (!canAssignRole(principal, role)) refuse("forbidden");
    const invite = await deps.accounts.invite(
      person,
      role.id,
      principal.userId,
      (change, action, id) =>
        audit({
          module: "users",
          action,
          resourceType: "invite",
          resourceId: id,
          title: person.toLowerCase(),
          ...change,
          revertible: false,
        }),
      new Date(),
    );
    await deps.sendInvite(invite, role.name);
    return { invited: true };
  };

  const addPerson = createGuardedAction({
    permission: "users.edit",
    input: PersonInput,
    recentSignIn: true,
    handler: addOne,
  });

  /** Reads the pasted lines and says, per line, what applying would do. Never writes. */
  const classify = async (
    { list, roleId }: z.infer<typeof PeopleListInput>,
    principal: Principal,
  ): Promise<PersonLine[]> => {
    const rows = list
      .split(/\r?\n/)
      .map((text) => text.trim())
      .filter((text) => text !== "");
    if (rows.length > MAX_PEOPLE_LINES) {
      throw new RuleViolationError(`Paste at most ${MAX_PEOPLE_LINES} lines.`);
    }
    const roles = await deps.roles.list();
    const byName = new Map(roles.map((r) => [r.name.trim().toLowerCase(), r]));
    const fallback = roleId ? roles.find((r) => r.id === roleId) : undefined;
    const seen = new Set<string>();
    const lines: PersonLine[] = [];
    for (const [index, row] of rows.entries()) {
      const [address = "", named] = row.split(";").map((part) => part.trim());
      const line = index + 1;
      const email = address.toLowerCase();
      if (!z.email().max(254).safeParse(address).success) {
        lines.push({ line, email: address, roleName: named ?? null, outcome: "invalid" });
        continue;
      }
      const role = named ? byName.get(named.toLowerCase()) : fallback;
      const roleName = role?.name ?? named ?? null;
      if (seen.has(email)) {
        lines.push({ line, email, roleName, outcome: "duplicate" });
        continue;
      }
      seen.add(email);
      if (!role) {
        lines.push({ line, email, roleName, outcome: "unknown_role" });
      } else if (!canAssignRole(principal, role)) {
        lines.push({ line, email, roleName, outcome: "not_allowed" });
      } else {
        const exists = (await deps.accounts.findByEmail(email)) !== null;
        lines.push({ line, email, roleName, outcome: exists ? "assign" : "invite" });
      }
    }
    return lines;
  };

  const previewPeople = createGuardedAction({
    permission: "users.edit",
    input: PeopleListInput,
    handler: async (input, principal) => ({ lines: await classify(input, principal) }),
  });

  /** Runs the single add per line that can be applied; a line that fails never stops the rest. */
  const addPeople = createGuardedAction({
    permission: "users.edit",
    input: PeopleListInput,
    recentSignIn: true,
    handler: async (input, principal, audit) => {
      const roles = await deps.roles.list();
      const roleOf = (name: string | null) =>
        roles.find((r) => r.name.toLowerCase() === name?.toLowerCase());
      const report: PersonLineReport[] = [];
      for (const line of await classify(input, principal)) {
        const role = roleOf(line.roleName);
        if ((line.outcome !== "invite" && line.outcome !== "assign") || !role) {
          report.push({ ...line, done: null });
          continue;
        }
        try {
          await addOne({ person: line.email, roleId: role.id }, principal, audit);
          report.push({ ...line, done: line.outcome === "invite" ? "invited" : "assigned" });
        } catch (error) {
          const message =
            error instanceof RuleViolationError
              ? error.message
              : error instanceof ConcurrencyConflictError
                ? "The account changed meanwhile. Add this line again."
                : "This line could not be applied.";
          if (!(error instanceof RuleViolationError)) {
            deps.logger.error("people list line failed", { error: String(error) });
          }
          report.push({ ...line, done: "failed", message });
        }
      }
      return { lines: report };
    },
  });

  const findPeople = createGuardedAction({
    permission: "users.edit",
    input: z.object({ query: safeText(120).pipe(z.string().min(2)) }).strict(),
    handler: async ({ query }) =>
      (await deps.accounts.searchByPrefix(query, 8)).map(({ uid, name, email }) => ({
        uid,
        name,
        email,
      })),
  });

  const cancelInvite = createGuardedAction({
    permission: "users.edit",
    input: InviteRef,
    recentSignIn: true,
    handler: async ({ email }, _principal, audit) => {
      const invite = await deps.accounts.cancelInvite(
        email,
        (change, id) =>
          audit({
            module: "users",
            action: "DELETE",
            resourceType: "invite",
            resourceId: id,
            title: email.toLowerCase(),
            ...change,
            revertible: false,
          }),
        new Date(),
      );
      return { email: invite.email };
    },
  });

  const personDetails = createGuardedAction({
    permission: "users.read",
    input: z.object({ uid: safeId }).strict(),
    resource: async ({ uid }) => {
      const account = await deps.accounts.get(uid);
      return account?.chapterId ? { chapterId: account.chapterId } : {};
    },
    handler: async ({ uid }) => {
      if ((await deps.accounts.get(uid)) === null) {
        throw new RuleViolationError("This account does not exist.");
      }
      const [methods, passkeys, profile] = await Promise.all([
        deps.authAdmin.signInMethods(uid),
        deps.passkeys.listByUser(uid),
        deps.memberProfiles.findByUserId(uid),
      ]);
      // Only whether the number is verified, never the number (that needs members.pii).
      return {
        ...methods,
        passkeys: passkeys.length,
        whatsappVerified: Boolean(profile?.whatsappVerifiedAt),
      };
    },
  });

  const revokeRole = createGuardedAction({
    permission: "users.edit",
    input: RoleChangeInput,
    recentSignIn: true,
    handler: async (input, principal, audit) => {
      const role = await loadRole(input.roleId);
      const removed: RoleAssignment = {
        roleId: role.id,
        scope: input.scope,
        periodId: input.periodId ?? null,
      };
      const updated = await deps.accounts.change(
        input.uid,
        input.version,
        (current, superadminsAfter) => {
          refuse(
            accountChangeRefusal({
              actor: principal,
              targetUserId: input.uid,
              role,
              superadminsAfter,
            }),
          );
          if (
            current.roleAssignments.some(
              (a) => a.source === "appointment" && sameAssignment(a, removed),
            )
          ) {
            throw new RuleViolationError(
              "This role comes from an appointment: end the appointment on the Officers tab of its unit (Organizations → Structure).",
            );
          }
        },
        {
          roleAssignmentsFrom: (current) =>
            current.roleAssignments.filter((a) => !sameAssignment(a, removed)),
        },
        accountAudit(audit),
      );
      await afterChange(principal, updated, { removed: role.id, scope: input.scope.type });
      return { version: updated.version };
    },
  });

  const setStatus = createGuardedAction({
    permission: "users.edit",
    input: StatusInput,
    recentSignIn: true,
    handler: async (input, principal, audit) => {
      const updated = await deps.accounts.change(
        input.uid,
        input.version,
        (_current, superadminsAfter) => {
          refuse(
            accountChangeRefusal({ actor: principal, targetUserId: input.uid, superadminsAfter }),
          );
        },
        { status: input.status },
        accountAudit(audit),
      );
      await deps.authAdmin.setDisabled(input.uid, input.status === "inactive");
      await afterChange(principal, updated, { status: input.status });
      return { version: updated.version };
    },
  });

  return {
    assignRole,
    addPerson,
    previewPeople,
    addPeople,
    findPeople,
    cancelInvite,
    personDetails,
    revokeRole,
    setStatus,
  };
}
