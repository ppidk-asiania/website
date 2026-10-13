import { describe, expect, it } from "vitest";
import { z } from "zod";
import { jsonError, toPublicError } from "@website/security";

const named = (name: string) =>
  Object.assign(new Error("secret internal detail: /srv/db password=x"), { name });

describe("error handling without information exposure", () => {
  it("maps known errors to safe status codes", () => {
    expect(toPublicError(z.string().safeParse(1).error)).toEqual({
      status: 400,
      code: "invalid_input",
    });
    expect(toPublicError(named("UnauthenticatedError"))).toEqual({
      status: 401,
      code: "unauthenticated",
    });
    expect(toPublicError(named("ForbiddenError"))).toEqual({ status: 403, code: "forbidden" });
    expect(toPublicError(named("ConcurrencyConflictError"))).toEqual({
      status: 409,
      code: "conflict",
    });
    expect(toPublicError(named("TypeError"))).toEqual({ status: 500, code: "internal" });
    expect(toPublicError("boom")).toEqual({ status: 500, code: "internal" });
  });

  it("error responses contain only a code and a generic message — never details or stack traces", async () => {
    const res = jsonError("internal");
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: "internal", message: "Something went wrong." });
    expect(body).not.toMatch(/stack|password|\/srv/);
  });
});
