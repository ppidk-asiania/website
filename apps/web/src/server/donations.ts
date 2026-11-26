import "server-only";
import { randomUUID } from "node:crypto";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createSqlDonationWebStore } from "@website/db/sql";
import type { PublicDonationChannel, Supporter } from "@website/domain/organizations";
import { webDb, webStorage } from "./db";
import { createDonationUpload } from "./donation-upload";
import { messenger } from "./messaging";

const store = lazyEnv(() => createSqlDonationWebStore(webDb()));

/** Verified donations as names (or null = "Anonymous"), never amounts. Cached for minutes. */
export async function supporters(): Promise<Supporter[]> {
  "use cache";
  cacheTag("supporters");
  cacheLife("minutes");
  return store().supporters();
}

/** The payment details are for signed-in members: this is read per request, never cached. */
export const donationChannels = (): Promise<PublicDonationChannel[]> => store().channels();

export const uploadDonation = lazyEnv(() =>
  createDonationUpload({
    donations: store(),
    storage: webStorage(),
    send: (message, key) => messenger().send(message, key),
    now: () => new Date(),
    uuid: randomUUID,
  }),
);
