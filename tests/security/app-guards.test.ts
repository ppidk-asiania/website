import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@website/auth";
import { PRIVACY_POLICY_VERSION } from "@website/domain/members";
import { createSqlRateLimitStore, getDatabaseForRole } from "@website/db/sql";
import { normalizePermissions, resolveAssignments, type Principal } from "@website/permissions";
import type * as WebGuardModule from "../../apps/web/src/server/request-guard";

vi.mock("@website/db/sql", () => ({
  getDatabaseForRole: vi.fn(() => ({})),
  createSqlRateLimitStore: vi.fn(() => ({
    consume: () => Promise.reject(new Error("down")),
  })),
}));

const apps = ["web", "admin", "shop"] as const;
const roles = { web: "web_ro", admin: "admin_rw", shop: "shop_rw" } as const;
type GuardModule = typeof WebGuardModule;
const load = async (app: (typeof apps)[number]) => {
  vi.resetModules();
  return (await import(`../../apps/${app}/src/server/request-guard.ts`)) as GuardModule;
};

afterEach(() => vi.unstubAllEnvs());

describe.each(apps)("%s request guard wiring", (app) => {
  it("blocks cross-site API calls and adds rate-limit headers", async () => {
    vi.stubEnv("APP_ENV", "test");
    const { guardRequest } = await load(app);
    const crossSite = await guardRequest(
      new Request("https://site.example/api/session", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(crossSite.blocked?.status).toBe(403);
    const page = await guardRequest(new Request("https://site.example/"));
    expect(page.blocked).toBeNull();
    expect(page.headers["RateLimit-Limit"]).toBe("100");
  });

  it("staging uses the shared database store with the app's role, and fails open if it is down", async () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("RATE_LIMIT_SECRET", "s".repeat(32));
    vi.stubEnv("DATABASE_URL", "mysql://app:x@localhost:3306/ppidk");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const { guardRequest } = await load(app);
    expect((await guardRequest(new Request("https://site.example/"))).blocked).toBeNull();
    expect(getDatabaseForRole).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: roles[app],
        url: "mysql://app:x@localhost:3306/ppidk",
        connectionLimit: 5,
      }),
    );
    expect(createSqlRateLimitStore).toHaveBeenCalled();
    expect(stdout.mock.calls.join()).toContain("rate_limit_store_error");
    stdout.mockRestore();
  });

  it("refuses to run in production without RATE_LIMIT_SECRET", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("RATE_LIMIT_SECRET", "");
    const { guardRequest } = await load(app);
    expect(() => guardRequest(new Request("https://site.example/"))).toThrow(/RATE_LIMIT_SECRET/);
  });

  it("defaults to development under `next dev` when APP_ENV is unset", async () => {
    vi.stubEnv("APP_ENV", undefined);
    vi.stubEnv("NODE_ENV", "development");
    const { guardRequest } = await load(app);
    expect((await guardRequest(new Request("https://site.example/"))).blocked).toBeNull();
  });
});

describe("sign-in redirect before the page renders (proxy)", () => {
  const signedIn = { headers: { cookie: `theme=dark; ${SESSION_COOKIE}=token` } };

  it("web sends a visitor without a session cookie from /settings to /login", async () => {
    vi.stubEnv("APP_ENV", "test");
    const { signInRedirect } = await load("web");
    expect(signInRedirect(new Request("https://site.example/settings?tab=keys"))).toBe(
      `/login?next=${encodeURIComponent("/settings?tab=keys")}`,
    );
    expect(signInRedirect(new Request("https://site.example/settings/account"))).toBe(
      `/login?next=${encodeURIComponent("/settings/account")}`,
    );
    expect(signInRedirect(new Request("https://site.example/settings", signedIn))).toBeNull();
    for (const path of ["/", "/settingsx", "/login", "/api/session"]) {
      expect(signInRedirect(new Request(`https://site.example${path}`)), path).toBeNull();
    }
  });

  it("admin sends a visitor without a session cookie from any page to the web sign-in", async () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("WEB_URL", "https://web.example");
    vi.stubEnv("ADMIN_URL", "https://admin.example");
    const { signInRedirect } = await load("admin");
    expect(signInRedirect(new Request("https://admin.example/events?page=2"))).toBe(
      `https://web.example/login?next=${encodeURIComponent("https://admin.example/events?page=2")}`,
    );
    expect(signInRedirect(new Request("https://admin.example/events", signedIn))).toBeNull();
    expect(signInRedirect(new Request("https://admin.example/api/session"))).toBeNull();
    expect(signInRedirect(new Request("https://admin.example/health"))).toBeNull();
    expect(signInRedirect(new Request("https://admin.example/certificates/pickup?t=x"))).toBeNull();
    expect(signInRedirect(new Request("https://admin.example/cron/noop"))).toBeNull();
    expect(signInRedirect(new Request("https://admin.example/webhooks/zoom"))).toBeNull();
    expect(signInRedirect(new Request("https://admin.example/cronjobs"))).not.toBeNull();
    expect(signInRedirect(new Request("https://admin.example/calendar/uid.sig.ics"))).toBeNull();
    expect(signInRedirect(new Request("https://admin.example/calendar"))).not.toBeNull();
    expect(signInRedirect(new Request("https://admin.example/calendar/x"))).not.toBeNull();
  });

  it("admin leaves signed-out visitors to the page when WEB_URL/ADMIN_URL are not set", async () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("WEB_URL", "");
    vi.stubEnv("ADMIN_URL", "");
    const { signInRedirect } = await load("admin");
    expect(signInRedirect(new Request("https://admin.example/events"))).toBeNull();
  });
});

const adminSession = vi.hoisted(
  (): {
    cookie: string | undefined;
    principal: Principal | null;
    profileConsent: string | null;
  } => ({ cookie: undefined, principal: null, profileConsent: "2026-10-18" }),
);
vi.mock("../../apps/admin/node_modules/next/headers.js", () => ({
  cookies: () =>
    Promise.resolve({
      get: () => (adminSession.cookie ? { value: adminSession.cookie } : undefined),
    }),
}));
vi.mock("../../apps/admin/node_modules/next/navigation.js", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  forbidden: () => {
    throw new Error("forbidden");
  },
}));
vi.mock("@website/auth/firebase-admin", () => ({
  createFirebaseIdentityProvider: () => ({
    verifySessionCookie: () => Promise.resolve({ uid: "u", email: "u@example.org" }),
  }),
}));
vi.mock("../../apps/admin/src/server/env", () => ({
  getAdminEnv: () => ({ APP_ENV: "test" }),
  getAppUrls: () => ({ WEB_URL: "https://web.example", ADMIN_URL: "https://admin.example" }),
}));
vi.mock("../../apps/admin/src/server/stores", () => ({
  adminStores: () => ({
    memberProfiles: {
      findByUserId: () =>
        Promise.resolve(
          adminSession.profileConsent === null
            ? null
            : { consent: { privacyPolicyVersion: adminSession.profileConsent } },
        ),
    },
  }),
}));
vi.mock("../../apps/admin/src/server/user-directory", () => ({
  userDirectory: () => ({ findPrincipalByUid: () => Promise.resolve(adminSession.principal) }),
}));

describe("admin page gate (requireAdminViewer)", () => {
  const roles = new Map([
    [
      "writer",
      { id: "writer", name: "Writer", permissions: normalizePermissions(["articles.read"]) },
    ],
  ]);
  const asRole = (roleId: string): Principal => ({
    kind: "user",
    userId: "u",
    active: true,
    assignments: resolveAssignments([{ roleId, scope: { type: "global" } }], roles),
  });
  const gate = async () => {
    const { requireAdminViewer } = await import("../../apps/admin/src/server/context");
    return requireAdminViewer("/events", "events.read");
  };

  afterEach(() => {
    adminSession.cookie = undefined;
    adminSession.principal = null;
    adminSession.profileConsent = PRIVACY_POLICY_VERSION;
  });

  it("sends a signed-out visitor to the web sign-in page", async () => {
    await expect(gate()).rejects.toThrow(
      `redirect https://web.example/login?next=${encodeURIComponent("https://admin.example/events")}`,
    );
  });

  it("shows the restricted (403) page to a signed-in user without any admin role", async () => {
    adminSession.cookie = "token";
    await expect(gate()).rejects.toThrow("forbidden");
    adminSession.principal = asRole("visitor");
    await expect(gate()).rejects.toThrow("forbidden");
  });

  it("lets staff in, and shows the page message to staff without the page's permission", async () => {
    adminSession.cookie = "token";
    adminSession.principal = asRole("superadmin");
    expect(await gate()).toMatchObject({ principal: adminSession.principal });
    adminSession.principal = asRole("writer");
    expect(await gate()).toBe("no-access");
  });

  it("sends staff without a complete member profile to the web profile page first (B3)", async () => {
    adminSession.cookie = "token";
    adminSession.principal = asRole("superadmin");
    const { getPrincipal } = await import("../../apps/admin/src/server/context");
    for (const consent of [null, "2020-01-01"]) {
      adminSession.profileConsent = consent;
      await expect(gate()).rejects.toThrow(
        `redirect https://web.example/settings/profile?next=${encodeURIComponent("https://admin.example/events")}`,
      );
    }
    expect(await getPrincipal()).toBeNull();
  });
});

describe("web maintenance mode", () => {
  const proxyAt = async (url: string, maintenance: "true" | undefined) => {
    vi.stubEnv("APP_ENV", "test");
    if (maintenance) vi.stubEnv("MAINTENANCE_MODE", maintenance);
    vi.resetModules();
    const { proxy } = await import("../../apps/web/src/proxy");
    const { NextRequest } = await import("../../apps/web/node_modules/next/server.js");
    return proxy(new NextRequest(url));
  };

  it("answers a page with 503, Retry-After and no database call", async () => {
    const page = await proxyAt("https://site.example/events", "true");
    expect(page.status).toBe(503);
    expect(page.headers.get("Retry-After")).toBe("3600");
    expect(await page.text()).toContain("maintenance");
    const api = await proxyAt("https://site.example/api/account/profile", "true");
    expect(api.status).toBe(503);
  });

  it("keeps /health, /verify, /files and the session routes working", async () => {
    for (const path of [
      "/health",
      "/verify/ABCDE-FGHJK",
      "/files/documents/x.pdf",
      "/api/session",
    ]) {
      // The request guard may still answer (the session route wants a same-site call); never 503.
      expect((await proxyAt(`https://site.example${path}`, "true")).status).not.toBe(503);
    }
  });

  it("does nothing when the switch is off", async () => {
    expect((await proxyAt("https://site.example/events", undefined)).status).toBe(200);
  });
});
