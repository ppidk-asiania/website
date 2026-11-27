#!/usr/bin/env node
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    email: { type: "string", multiple: true },
    apply: { type: "boolean", default: false },
  },
});
if (!values.email?.length) {
  console.error("Usage: seed-dummy-profile.mjs --email <address> [--email <address>] [--apply]");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("Missing environment variables: DATABASE_URL");
  process.exit(2);
}

// The store's own imports leave out ".ts"; this lets plain `node` load them.
await import("./ts-register.mjs");
const { getDatabase } = await import("../../packages/db/src/sql/store.ts");
const { createSqlMemberProfileStore } =
  await import("../../packages/db/src/sql/member-profiles.ts");
const { isProfileComplete, memberProfileInputSchema, ownProfile, PRIVACY_POLICY_VERSION } =
  await import("../../packages/domain/src/members/index.ts");
const db = getDatabase({ url: process.env.DATABASE_URL });
const users = db.collection("users");
const profiles = createSqlMemberProfileStore(db);

// Placeholder data for test/admin accounts; it passes the same schema a member's own form does.
const dummy = (name) => ({
  fullName: name,
  gender: "male",
  dateOfBirth: "2000-01-01",
  ppiCountry: "JP",
  university: "Dummy University",
  universityId: null,
  educationLevel: "master",
  majors: ["Computer Science"],
  yearOfEntry: 2024,
  estimatedGraduationYear: 2026,
  addressAbroad: { line1: "1-1 Dummy Street", city: "Tokyo", countryCode: "JP" },
  addressIndonesia: { line1: "Jl. Dummy No. 1", city: "Jakarta Pusat", province: "DKI Jakarta" },
  whatsappNumber: "+6281200000000",
  emergencyContact: { phone: "+6281200000001", name: "Dummy Contact", relationship: "Parent" },
  timezone: "Asia/Tokyo",
  consent: { privacyPolicyVersion: PRIVACY_POLICY_VERSION, accepted: true },
});

async function seed(email) {
  const found = await users.where("email", "==", email).limit(1).get();
  const doc = found.docs[0];
  if (!doc) return { uid: "-", result: "no-record" };
  const current = await profiles.findByUserId(doc.id);
  // Never overwrite a real, complete profile with placeholder data.
  if (isProfileComplete(current)) return { uid: doc.id, result: "already" };
  if (!values.apply) return { uid: doc.id, result: "would-seed" };
  const now = new Date();
  const input = memberProfileInputSchema(now).parse(dummy(doc.get("name") || "Dummy Admin"));
  await profiles.save(
    ownProfile(input, { userId: doc.id, email }, current, now),
    current?.version ?? null,
  );
  return { uid: doc.id, result: "seeded" };
}

const messages = {
  "no-record": "No account with this e-mail yet: sign in on the web app once, then run this again.",
  already: "Already has a complete profile. Nothing changed.",
  "would-seed": "Dry run: would write the dummy profile. Re-run with --apply.",
  seeded: "Dummy profile written.",
};
let failed = false;
for (const raw of values.email) {
  const email = raw.trim().toLowerCase();
  const { uid, result } = await seed(email);
  console.log(`${email} (${uid}): ${messages[result]}`);
  if (result === "no-record") failed = true;
}
await db.close();
process.exit(failed ? 1 : 0);
