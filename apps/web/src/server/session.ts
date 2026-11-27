import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import {
  createIdentityProvider,
  createSessionRoutes,
  createSignIn,
  hasTwoSignInMethods,
  SESSION_COOKIE,
  type LinkKind,
  type VerifiedIdentity,
} from "@website/auth";
import { lazyEnv } from "@website/config/env";
import { createSqlAuthAccountStore, createSqlUserStore } from "@website/db/sql";
import { deliveryDecision } from "@website/domain/messaging";
import { createLogger, logSecurityEvent } from "@website/observability";
import { webDb } from "./db";
import { getWebEnv } from "./env";
import { email } from "./messaging";
import { ownSignInMethods } from "./passkeys";

export const authAccounts = lazyEnv(() => createSqlAuthAccountStore(webDb()));

export const identity = lazyEnv(() =>
  createIdentityProvider({ secret: getWebEnv().SESSION_SECRET, accounts: authAccounts() }),
);

export const logger = lazyEnv(() => createLogger({ service: "web", level: getWebEnv().LOG_LEVEL }));

export const users = lazyEnv(() => createSqlUserStore(webDb()));

const LINKS: Record<LinkKind, { path: string; subject: string; id: string; en: string }> = {
  verify: {
    path: "/verify-email",
    subject: "Konfirmasi e-mail / Confirm your e-mail",
    id: "Buka tautan ini untuk mengonfirmasi e-mail akun PPIDK Asia-Oseania (berlaku 3 hari):",
    en: "Open this link to confirm the e-mail of your PPIDK Asia-Oseania account (valid 3 days):",
  },
  reset: {
    path: "/reset-password",
    subject: "Atur ulang kata sandi / Reset your password",
    id: "Buka tautan ini untuk membuat kata sandi baru (berlaku 1 jam):",
    en: "Open this link to choose a new password (valid 1 hour):",
  },
};

/**
 * Sign-in links go straight to the e-mail channel, not through the messenger: its log would keep
 * a working reset link in the database. MESSAGING_MODE and test recipients still apply.
 */
async function sendLink(kind: LinkKind, to: string, token: string): Promise<void> {
  const env = getWebEnv();
  const link = LINKS[kind];
  const url = `${env.WEB_URL ?? ""}${link.path}?token=${encodeURIComponent(token)}`;
  const decision = deliveryDecision({
    mode: env.MESSAGING_MODE,
    appEnv: env.APP_ENV,
    recipient: to,
    testRecipients: env.MESSAGING_TEST_RECIPIENTS,
  });
  if (decision !== "send") {
    // only on a development machine is the link itself printed, to finish the flow by hand
    logger().info("auth_link_not_sent", {
      kind,
      decision,
      ...(env.APP_ENV === "development" ? { url } : {}),
    });
    return;
  }
  const text = `${link.id}\n${url}\n\n${link.en}\n${url}\n\nAbaikan e-mail ini bila kamu tidak memintanya. / Ignore this e-mail if you did not ask for it.`;
  const key = `auth-${kind}:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`;
  const result = await email().send(
    {
      to,
      subject: link.subject,
      text,
      // the text is fixed apart from the URL, which is base64url and percent-encoded
      html: `<p>${text.replace(/\n/g, "<br>")}</p>`,
    },
    key,
  );
  if (!result.ok) logger().error("auth_link_failed", { kind, error: result.error });
}

const signIn = lazyEnv(() => {
  const env = getWebEnv();
  return createSignIn({
    accounts: authAccounts(),
    secret: env.SESSION_SECRET,
    googleClientId: env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    sendLink,
  });
});

/** The link in the confirmation e-mail sent at sign-up (`/verify-email`). */
export function verifyEmail(token: string): Promise<boolean> {
  return signIn().verifyEmail(token);
}

export const sessionRoutes = lazyEnv(() => {
  const env = getWebEnv();
  return createSessionRoutes({
    identity: identity(),
    maxAgeHours: env.SESSION_MAX_AGE_HOURS,
    cookieDomain: env.SESSION_COOKIE_DOMAIN,
    signIn: signIn(),
    onSignIn: async (signedIn) => {
      const { roleIds } = await users().recordSignIn(signedIn, new Date(), async () =>
        hasTwoSignInMethods(await ownSignInMethods(signedIn.uid)),
      );
      if (roleIds.some((id) => id !== "visitor")) {
        logSecurityEvent(logger(), { type: "staff.login", actorId: signedIn.uid });
      }
    },
  });
});

export async function getSignedInUser(): Promise<VerifiedIdentity | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  return cookie ? identity().verifySessionCookie(cookie) : null;
}
