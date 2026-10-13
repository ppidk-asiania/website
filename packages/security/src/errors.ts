/**
 * Error handling without information exposure: clients get a stable code and a generic
 * message only. Details belong in server logs, never in responses.
 */
export type PublicErrorCode =
  "invalid_input" | "unauthenticated" | "forbidden" | "conflict" | "rate_limited" | "internal";

const STATUS: Record<PublicErrorCode, number> = {
  invalid_input: 400,
  unauthenticated: 401,
  forbidden: 403,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

const MESSAGE: Record<PublicErrorCode, string> = {
  invalid_input: "The request is invalid.",
  unauthenticated: "Sign-in required.",
  forbidden: "Request not allowed.",
  conflict: "This item was changed by someone else. Reload and try again.",
  rate_limited: "Too many requests. Try again later.",
  internal: "Something went wrong.",
};

/** Error class names (from zod, @website/permissions, @website/domain) → public codes. */
const BY_NAME: Record<string, PublicErrorCode> = {
  ZodError: "invalid_input",
  UnauthenticatedError: "unauthenticated",
  ForbiddenError: "forbidden",
  ConcurrencyConflictError: "conflict",
};

export function toPublicError(error: unknown): { status: number; code: PublicErrorCode } {
  const code = (error instanceof Error && BY_NAME[error.name]) || "internal";
  return { status: STATUS[code], code };
}

export function jsonError(code: PublicErrorCode, headers: Record<string, string> = {}): Response {
  return Response.json(
    { error: code, message: MESSAGE[code] },
    { status: STATUS[code], headers: { "Cache-Control": "no-store", ...headers } },
  );
}
