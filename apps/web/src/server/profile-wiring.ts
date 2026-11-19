import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import {
  createSqlMemberProfileStore,
  createSqlSignatureStore,
  createSqlUniversityStore,
} from "@website/db/sql";
import { isProfileComplete, WHATSAPP_LINK_PURPOSE } from "@website/domain/members";
import { keyedHash } from "@website/security";
import { webDb, webStorage } from "./db";
import { getWebEnv } from "./env";
import { createOwnProfile, type ProfileOwner } from "./profile";
import { createOwnSignature } from "./signature";
import { createUniversityPicker, type UniversityChoice } from "./universities";
import { createWhatsappLink } from "./whatsapp-link";

const memberProfiles = lazyEnv(() => createSqlMemberProfileStore(webDb()));
const universities = lazyEnv(() => createSqlUniversityStore(webDb()));

export const ownProfile = lazyEnv(() =>
  createOwnProfile({
    profiles: memberProfiles(),
    universities: universities(),
    now: () => new Date(),
  }),
);

export const whatsappLink = lazyEnv(() => {
  const env = getWebEnv();
  return createWhatsappLink({
    profiles: memberProfiles(),
    hash: (code) => {
      if (!env.SUBSCRIBER_HASH_SECRET) {
        throw new Error("SUBSCRIBER_HASH_SECRET is required to link WhatsApp numbers.");
      }
      return keyedHash(WHATSAPP_LINK_PURPOSE, code, env.SUBSCRIBER_HASH_SECRET);
    },
    randomInt,
    botNumber: env.WAHA_BOT_NUMBER ?? null,
    now: () => new Date(),
  });
});

export const ownSignature = lazyEnv(() =>
  createOwnSignature({
    store: createSqlSignatureStore(webDb()),
    storage: webStorage(),
    key: () => getWebEnv().FIELD_ENCRYPTION_KEY ?? null,
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

export const hasCompleteProfile = async (uid: string): Promise<boolean> =>
  isProfileComplete(await memberProfiles().findByUserId(uid));

export const ownTimezone = async (uid: string): Promise<string> =>
  (await memberProfiles().findByUserId(uid))?.timezone ?? "Asia/Jakarta";

export const universityPicker = lazyEnv(() =>
  createUniversityPicker({ universities: universities(), now: () => new Date() }),
);

async function approvedCampuses(countryCode: string): Promise<UniversityChoice[]> {
  "use cache";
  cacheTag("universities");
  cacheLife("minutes");
  return universityPicker().approved(countryCode);
}

export async function campusChoices(
  owner: ProfileOwner | null,
  countryCode: string,
): Promise<UniversityChoice[]> {
  const [approved, mine] = await Promise.all([
    approvedCampuses(countryCode),
    universityPicker().ownPending(owner, countryCode),
  ]);
  return [...approved, ...mine];
}
