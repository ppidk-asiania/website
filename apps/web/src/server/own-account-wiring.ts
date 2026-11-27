import "server-only";
import { createHash, randomInt } from "node:crypto";
import { lazyEnv } from "@website/config/env";
import {
  createSqlAccountEmailStore,
  createSqlMemberProfileStore,
  createSqlSignatureStore,
} from "@website/db/sql";
import { webDb, webStorage } from "./db";
import { messenger } from "./messaging";
import { createOwnAccount } from "./own-account";
import { accountAdmin, passkeyStore } from "./passkeys";
import { users } from "./session";

export const ownAccount = lazyEnv(() =>
  createOwnAccount({
    admin: accountAdmin(),
    emails: createSqlAccountEmailStore(webDb()),
    passkeys: passkeyStore(),
    profiles: createSqlMemberProfileStore(webDb()),
    signatures: createSqlSignatureStore(webDb()),
    users: users(),
    storage: webStorage(),
    send: (message, key) => messenger().send(message, key),
    // a 4-digit code lives 15 minutes and allows 5 tries; the hash only keeps it out of plain sight
    hash: (uid, code) => createHash("sha256").update(`email-code:${uid}:${code}`).digest("hex"),
    randomInt,
    now: () => new Date(),
  }),
);
