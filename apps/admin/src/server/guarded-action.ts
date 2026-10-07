import type { z } from "zod";
import { toPublicError } from "@website/security";
import {
  canAccessAdmin,
  requirePermission,
  type Permission,
  type Principal,
  type ResourceContext,
} from "@website/permissions";

/**
 * The ONLY way to define an admin mutation. Order is fixed:
 * authenticate (+ staff role) → validate → authorize → business logic (which writes the audit record
 * in the same transaction).
 *
 * Kept free of `server-only` so it is unit-testable; it is wired in ./context.ts.
 */
export type GuardedResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly error: "unauthenticated" | "forbidden" | "invalid_input" | "conflict";
      readonly issues?: readonly string[];
    };

export function createGuardedAction<S extends z.ZodType, T>(definition: {
  permission: Permission;
  input: S;
  resource?: (input: z.infer<S>) => ResourceContext;
  handler: (input: z.infer<S>, principal: Principal) => Promise<T>;
}) {
  return (getPrincipal: () => Promise<Principal | null>) =>
    async (rawInput: unknown): Promise<GuardedResult<T>> => {
      const principal = await getPrincipal();
      if (principal === null || !principal.active) return { ok: false, error: "unauthenticated" };
      // One user pool: a member or customer account is authenticated but is not staff.
      if (!canAccessAdmin(principal)) return { ok: false, error: "forbidden" };

      // Validate before resource-scoped authorization (scope may depend on input),
      // but never reveal validation details to unauthenticated callers.
      const parsed = definition.input.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          error: "invalid_input",
          issues: parsed.error.issues.map((i) => i.message),
        };
      }
      try {
        requirePermission(principal, definition.permission, definition.resource?.(parsed.data));
      } catch {
        return { ok: false, error: "forbidden" };
      }
      try {
        return { ok: true, data: await definition.handler(parsed.data, principal) };
      } catch (error) {
        // Race condition: the document changed since it was read (optimistic concurrency).
        if (toPublicError(error).code === "conflict") return { ok: false, error: "conflict" };
        throw error; // unexpected: Next.js logs it and shows the client a generic error
      }
    };
}
