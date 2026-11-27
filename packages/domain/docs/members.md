# Member profiles

Collected once per user in `memberProfiles/{uid}` and reused for event registrations
(registrations reference the user; they do not copy personal data).
Schema and validation: `packages/domain/src/members/profile.ts` (Zod, shared by every app).

| Field                        | Stored as                 | Validation                                                                                       | Class      |
| ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ | ---------- |
| Full Name                    | `fullName`                | 1–200 chars                                                                                      | basic      |
| Gender                       | `gender`                  | `male` \| `female`                                                                               | restricted |
| Date of Birth                | `dateOfBirth`             | `YYYY-MM-DD`, age 15–100                                                                         | restricted |
| PPI Country                  | `ppiCountry`              | ISO 3166-1 alpha-2 (matches `countries`)                                                         | basic      |
| University                   | `university`              | 1–200 chars (reference list later)                                                               | basic      |
| Education Level              | `educationLevel`          | `diploma` (D3/D4), `bachelor` (S1), `master` (S2), `doctoral` (S3), `postdoctoral`, `non_degree` | basic      |
| Majors                       | `majors`                  | 1–3 entries                                                                                      | basic      |
| Year of Entry                | `yearOfEntry`             | 1950 … next year                                                                                 | basic      |
| Estimated Year of Graduation | `estimatedGraduationYear` | ≥ entry, ≤ entry + 15                                                                            | basic      |
| Detail Address Abroad        | `addressAbroad`           | line1, line2?, city, stateOrProvince?, postalCode?, countryCode                                  | restricted |
| Detail Address in Indonesia  | `addressIndonesia`        | line1, line2? (kelurahan/kecamatan), city, province, postalCode? (5 digits)                      | restricted |
| WhatsApp Number              | `whatsappNumber`          | E.164 (`+62…`), spaces/dashes stripped                                                           | restricted |
| WhatsApp verified at         | `whatsappVerifiedAt`      | Set only by linking through the bot (below); typing another number clears it                     | —          |
| Emergency Contact Number     | `emergencyContact`        | `phone` E.164 (required), `name`?, `relationship`?                                               | restricted |
| Timezone                     | `timezone`                | IANA (`Asia/Tokyo`)                                                                              | basic      |
| Email                        | `email`                   | Copied from the verified sign-in account; not typed by the user                                  | restricted |
| Consent                      | `consent`                 | privacy-policy version + timestamp, required                                                     | —          |

## Profile page and completeness gate (B3, A4)

- Members fill in `/settings/profile` on the website (`apps/web/src/app/settings/profile/…`,
  rules in `apps/web/src/server/profile.ts`). The owner always comes from the session (never the
  form); saving needs a verified e-mail, which is copied into the profile. A stale version is
  refused ("changed elsewhere").
- Consent: the form agrees to `PRIVACY_POLICY_VERSION` (= the date on the Privacy and Terms
  pages, `LEGAL_VERSION`). The first consent date is kept until the policy changes.
- `isProfileComplete(profile)`: a saved profile that agreed to the current policy. Until it is
  complete, admin pages send staff to `/settings/profile?next=<admin page>` and admin actions are
  refused (`apps/admin/src/server/context.ts`), and event registration answers "complete your
  profile" (member-only). Bumping `PRIVACY_POLICY_VERSION` asks everyone to agree again.
- Saving also writes `users/{uid}.chapterId` (the active chapter whose `countryCode` is
  `ppiCountry`, or null) so chapter-scoped staff lists are one query; no personal data goes to
  `users`. Database: `packages/db/src/sql/member-profiles.ts`.
- Address in Indonesia: province → regency/city pick-lists from
  `packages/domain/src/members/indonesia-regions.ts` (38 provinces, 514 regencies, Kepmendagri;
  generated once from the npm package `idn-area-data@4.0.1`, Open Database License — keep the
  attribution in that file). The names are stored as text; the schema is unchanged.
- Tests: `tests/integration/member-profile.test.ts`, `tests/security/app-guards.test.ts`,
  `tests/integration/web-registration.test.ts`.

## Data changes and graduation (B5)

- Rules: `packages/domain/src/members/verification.ts` (guarded fields, graduation); database
  `packages/db/src/sql/member-profiles.ts` (`memberProfiles/{uid}` fields `graduatedOn`,
  `graduationMarkedBy`, `chapterId`); web `apps/web/src/server/profile.ts` (`/settings/profile`).
- There is no profile verification (removed 2026-10-24 together with the admin Members page).
  Every change the member saves applies at once. Changes of the guarded fields (PPIDK §63: full
  name, gender, date of birth, PPI country, campus) are audited (actor `member`, module
  `members`, restricted values redacted, not revertible). A new PPI country moves the member's
  chapter (`chapterId` on the profile and on `users/{uid}`) in the same transaction.
- Old documents may still have `verificationStatus`, `verifiedBy`, `verifiedAt`; they are ignored
  when read and dropped on the next save. `profileChangeRequests` is no longer read or written.
- Graduation (§67): only the date is stored; `studyStatus` computes student / graduating
  (date ahead) / alumni. The member marks or corrects it at once and may cancel only a mark they
  set themselves (a mark imported from PPIDK and set by an officer stays). The date is refused
  before the year of entry or more than 10 years ahead. Graduation never ends an appointment:
  graduated officers of the active period appear on the admin dashboard for `appointments.edit`.
- The student card (KTM) is now the optional supporting file of the student proof (next section).
- Tests: `tests/integration/profile-graduation.test.ts`.

## WhatsApp number linked by message (step 10.4)

- Rules: `packages/domain/src/members/whatsapp-link.ts` (code alphabet and length, 30 minutes,
  `/asiania CODE` parsing, chat id to E.164); `ownProfile` clears `whatsappVerifiedAt` when the
  typed number differs from the stored one.
- Database: `issueWhatsappCode` and `linkWhatsapp` in `packages/db/src/sql/member-profiles.ts`
  (`whatsappLinkCodes/{HMAC(code)}`, `memberProfiles/{uid}.whatsappVerifiedAt`); the link is audited
  (actor `member`, number redacted). A number verified on another account is refused.
- Web: "Link my WhatsApp" on `/settings/profile` (`apps/web/src/server/whatsapp-link.ts`); admin:
  the `message` event of `/webhooks/waha` (`apps/admin/src/server/whatsapp-link.ts`, see
  `apps/admin/docs/messaging.md`). The Role Manager popup shows verified / not verified only.
- Not built: staff typing someone else's number (`profile.update_any`; no staff profile editor
  exists). The PPIDK import of `phone_wa_verified_at` is finished in step 16.4.
- Tests: `tests/security/whatsapp-webhook.test.ts`, `tests/integration/whatsapp-link.test.ts`.

## Student status proof (DEC-21, step 11.3)

- Needed only to apply to a recruitment (`proofSatisfied` in `packages/domain/src/members/student-proof.ts`):
  a student (or one graduating soon) needs a **main** file; alumni are never asked. Institutional
  accounts (step 15.1) will be exempt too; that account type does not exist yet.
- Stored on `memberProfiles/{uid}` (no new collection): `studentProof` `{ main, supporting,
confirmedActive, uploadedAt }` (each file `{ path, type }`) and `proofReview` `{ state: ok | fix |
fixed, note, by, at }`. Only `updateProof` / `proofsOf` (`packages/db/src/sql/member-profiles.ts`)
  change them: one transaction, the profile version is NOT bumped (an open profile form stays valid),
  and a profile save keeps them.
- Main = a document that STATES active status (certificate of enrolment, official transcript,
  LoA/CoE); supporting = student card, optional. PDF, JPEG, PNG or WebP by magic bytes, at most
  5 MB, stored privately (not re-encoded, not encrypted: the committee opens them through the
  normal 15-minute signed link): `members/proofs/{uid}/{main|supporting}_{id}.{ext}`.
- Web: upload on `/settings/profile` and as step 2 of the apply wizard (same component), (`apps/web/src/server/student-proof.ts`, route
  `/api/account/student-proof?file=main|supporting[&confirmed=1]`). A new main file needs the
  confirmation "this document states my active status" (`confirmed=1`, checked on the server); a
  supporting file needs a main file first. `GET ?file=…&v=<version>` shows the owner's own file only
  (the path comes from the stored profile, never from the request); responses are
  `private, no-store`.
- A new upload after "Ask for a fix" sets the review to `fixed`; a new main file after "Proof OK"
  clears the review (a different document is not checked yet).
- Review (`recruitment.review`, admin application page, `apps/admin/src/server/student-proofs.ts`):
  open both files, "Proof OK" or "Ask for a fix" with a note. The applicant is told by WhatsApp /
  e-mail; the notice key holds the decision time, so a second fix request is sent too (PPIDK bug,
  s.118). The decision is audited (module `recruitment`, resource `proof`, not revertible).
- Not built: verification status, change requests, a banner on every page for accounts without
  proof, merging requests (PPIDK s.117).
- Tests: `tests/integration/student-proof.test.ts`, `tests/security/student-proof.test.ts`,
  `tests/integration/recruitment.test.ts` (submit refused without proof).

## Import from PPIDK (block J)

- Mapping: `packages/db/src/ppidk/people.ts` (pure, tested in `tests/unit/ppidk-import.test.ts`);
  script: `infrastructure/scripts/import-ppidk-people.mjs` (standard library only for the TSV;
  dry run unless `--apply`; writes `import-report.json` with counts and every
  skipped row). Ids come from PPIDK (`ppidk-<table>-<id>`; ROR campuses keep `{rorKey}_{country}`),
  so running it again writes the same documents.
- Accounts: matched by e-mail to an existing sign-in account (`authAccounts`; its roles are kept
  and the imported ones added), otherwise created as `ppidk-<id>` without a password — people sign in
  with Google or reset the password, and register passkeys again.
- Profiles are imported as answers but count as incomplete (the consent is not the current
  policy, and PPIDK did not ask e.g. the emergency contact): each member completes and agrees on
  the first visit (the profile gate). Accounts get the default role (Visitor);
  PPIDK verification is not imported. A profile that already exists is never replaced, and an
  existing account keeps its chapter: platform answers and consent always win over PPIDK, also
  when the import runs again.
- Active appointments of the active period get their roles from `settings/appointmentRoles`
  (set it before importing). Manual PPIDK role assignments are NOT imported (roles are data
  here): the report lists them for Role Manager. Chapters staff already added are reused by
  country; the import refuses to run when periods were already created here.

## Universities (A3)

- Master `universities/{id}` (`packages/domain/src/members/universities.ts`,
  `packages/db/src/sql/universities.ts`): campuses from the ROR dump (`approved`, id
  `{rorKey}_{country}`) and campuses members propose (`pending`).
- Import (owner, once, and again when chapters are added):
  `infrastructure/scripts/import-ror-universities.mjs` reads the official ROR dump (CC0, from
  Zenodo — the ROR API pages are incomplete, PPIDK §7) for the countries of the active chapters;
  one row per country (§7b). Dry run unless `--apply`; safe to run again. It imports the domain
  code with Node type stripping (`--import ./infrastructure/scripts/ts-register.mjs`).
- Profile: the picker lists the approved campuses of the chosen PPI country (cached for minutes)
  plus the member's own pending proposals, filtered in the browser on the name and aliases.
  `memberProfiles/{uid}.universityId` points at the campus and `university` holds its name; a
  pick must be approved (or the member's own proposal) in the PPI country. Without a pick the
  typed name is kept (`universityId` null).
- "My campus is not listed" proposes one. Obvious duplicates are refused in the same country:
  the same `normalizeUniversityName` (deliberately conservative, PPIDK §6) of a listed or
  proposed campus, or of an alias of a listed one. ALL CAPS / lower case names are tidied.
- Admin: **Organizations → Universities** tab (`organizations.read` to open the page, then
  `universities.read` / `universities.edit`). It lists the approved campuses of one PPI country
  (`?view=universities&country=JP`). **Add University** lists a campus right away (`approved`,
  `source: "manual"`, same duplicate check; audited `CREATE`, not revertible).
- Review queue: the tab's **Requested** button opens it in a popup. Accept;
  merge into a listed campus of the same country (the proposal is kept as `rejected` with
  `mergedInto`, and every profile pointing at it moves to that campus); or reject with a reason
  (profiles lose the pick and choose again). Merge suggestions share a distinctive word
  (`mergeCandidates`). Audited (module `universities`), not revertible. At most 400 profiles per
  decision.
- Tests: `tests/unit/universities.test.ts`, `tests/integration/universities.test.ts`.

## Access

- **The member**: reads/edits their own profile (`profile.read_own` / `profile.write_own`).
- **Staff with `members.read`**: basic fields only (`toBasicView`).
- **Staff with `members.pii`**: all fields — `chapter_admin` only for their chapter.
- **Exports**: `members.export` (only roles given it in Role Manager), logged as a security event.
- **Never**: the third-party gateway (lint-enforced), public pages, audit snapshots (restricted
  values are replaced with `[changed]`/`[unchanged]`; such changes are not revertible from the log).

## Personal data protection (UU PDP, Law 27/2022)

- Consent is recorded with the policy version; the privacy policy page must exist before launch.
- Collect only the fields above. Gender and date of birth are collected — confirm the purpose
  is stated in the privacy policy.
- Members can request a copy or deletion of their data (self-service export/delete in a later phase).
- Retention: define how long alumni profiles are kept after `estimatedGraduationYear`
  (proposal: 2 years, then delete or anonymize). **Decision needed.**
- Breach handling: notify affected members and the authority within 3×24 hours (UU PDP Art. 46).
