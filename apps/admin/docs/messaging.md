# Messaging (e-mail, WhatsApp), notifications and the Email page

## What it does

Every outgoing message goes through one port with an **idempotency key** and is written to a
message log (outbox) first, so the same message is never sent twice — not on a double click,
not on a retry. Channels: e-mail (Resend) and WhatsApp (WAHA, proactive messages; chatbot
replies through the Meta Cloud API come with step 7.11). Staff see the messages that failed on the admin **Email** page (`/emails`, side panel) and can retry
them. It replaced the separate Messages page and the mock Emails page of the account menu.

## Where it lives

- Rules and orchestration: `packages/domain/src/messaging` (`createMessenger`,
  `deliveryDecision`, `isValidMessageKey`, `MessageChannel` and `MessageLogStore` ports).
- Log: `packages/db/src/sql/messages.ts` (`createSqlMessageLog`, collection
  `messageLog/{sha256(key)}`).
- E-mail channel: `packages/email/src/channel.ts` (`emailChannel`, shared by admin and web).
- WhatsApp channel: `packages/email/src/whatsapp.ts` (`wahaChannel`, re-exported by admin
  `src/server/whatsapp.ts`: `POST {WAHA_BASE_URL}/api/sendText` with `X-Api-Key`, chat id
  `6281…@c.us` from the E.164 number, the subject in bold above the text, 10 s timeout; errors
  `not_configured`, `waha_<status>`, `waha_unreachable`). Recipient kind **group** (step 11.8): a `to`
  that is a chat id (`…@g.us`) is used as it is; plain text only (WAHA cannot send list messages to
  groups). `Message.mentions` (E.164 numbers) are appended to the SENT text as `@number` and sent
  as WAHA `mentions`; the stored/logged text never holds a number. The website has the channel too
  (needs `WAHA_BASE_URL`, `WAHA_API_KEY`, `WAHA_SESSION`), used only for the group notices.
- Notifications (J2): `src/server/notices.ts` (`createNotices`), recipients from
  `createSqlContactReader` (`packages/db/src/sql/messages.ts`).
- Admin: `src/server/messaging.ts` (retry action), `src/server/wiring.ts` (`messenger()`), page
  `src/app/(panel)/emails/**` (`messages.read` / `messages.edit`).
- Web: `apps/web/src/server/messaging.ts` (`messenger()` for confirmation e-mails, same log, so
  failed ones show up on the admin Email page).
- Tests: `tests/integration/messaging.test.ts`, `tests/integration/notices.test.ts`.

## How to use it

```ts
// inside a server action, AFTER the transaction that caused the message has committed
await messenger().send(
  { channel: "email", to: user.email, subject, text, html },
  `event:${eventId}:registered:${uid}`,
);
// → "sent" | "failed" | "skipped" | "logged" | "blocked" | "duplicate"
```

Keys are meaningful and stable: `<topic>:<id>:<event>[:…]` (letters, digits, `_ - . @`). The
same key always means the same message. Web server code (newsletter, step 2.8) uses the same
`createMessenger` + `createSqlMessageLog` once its dependency matrix allows
`domain/messaging`.

## Who gets which channel

`messageTo(contact, content)`: WhatsApp when the person's member profile has a WhatsApp number
(`memberProfiles.whatsappNumber`, E.164), else the account e-mail, else `skipped`. The number is
read by the system only to deliver; the Email page shows only its last four digits.

`Contact` also carries `active` (false = inactive account: callers skip the person) and
`timeZone` (the profile's own zone, for texts that show a time); both are optional.

Meeting notices (step 12.1) use this: `meeting:{id}:invite:{uid}`,
`meeting:{id}:start:{uid}:{startsAtMs}`, `meeting:{id}:end:{uid}`,
`meeting:{id}:change:{uid}:{version}`, `meeting:{id}:cancel:{uid}`
(`packages/domain/docs/meetings.md` → Notices).

Interview notices (step 11.5; `createInterviewNotices`, `createInterviewReminders` in
`src/server/interviews.ts`, `apps/web/src/server/interview-notice.ts`), one message per person in
the recipient's own time zone: `interview:{applicationId}:booked:{slotId}` (to the interviewer, sent
by the website by e-mail when an applicant books), `interview:{applicationId}:cancelled:{slotId}`
(to the applicant when the interviewer cancels a time),
`interview:{applicationId}:changed:{slotVersion}` (to each booked applicant) and
`interview:{slotId}:changed:{slotVersion}` (to the interviewer when someone else changed the time,
mode, link, address or note), `interview:{applicationId}:start:{uid}:{startsAtMs}` (30 minutes
before, both sides, cron `meeting-reminders`). A save without a real change sends nothing.

## Notification sources (J2)

Sent after the action's transaction committed; a failure is logged (`notice failed`) and never
undoes the decision. Texts are Indonesian then English, with a link.

| Event                                                                                                                           | To                                                                                           | Key                                              |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Application → revision, admin_rejected, interview, offered, rejected, approved (incl. a returned pact with its note), confirmed | the applicant                                                                                | `recruitment:{applicationId}:{status}:{version}` |
| Letter submitted (`review`)                                                                                                     | holders of `letters.review`                                                                  | `letter:{id}:{status}:{version}:{uid}`           |
| Letter passed (`corrected`, no desk signed yet)                                                                                 | holders of `letters.sign` (+ `letters.sign_coordinator` when the type needs the Coordinator) | same                                             |
| Letter `approved`                                                                                                               | holders of `letters.issue`                                                                   | same                                             |
| Letter returned to draft                                                                                                        | its author, with the note                                                                    | same                                             |
| Finance request `submitted` / `reviewed` / `authorized`                                                                         | holders of `finance.review` / `finance.authorize` / `finance.pay`                            | `finance:{id}:{status}:{version}:{uid}`          |
| Finance request returned (`revision`), `rejected` or `paid`                                                                     | the requester (with the note)                                                                | same                                             |

Desk holders = active accounts whose CUSTOM role holds the permission and whose assignment
covers the letter's unit (scope, active period, not revoked); superadmins are not desk holders.
LPJ desks (`notices.lpj`, key `lpj:{id}:{status}:{version}:{uid}`): programme finished → its
PICs with the due date; submitted → holders of `lpj.review_secretariat` and
`lpj.review_treasurer`; both reviews in → holders of `lpj.approve`; returned (with the note) or
approved → the PICs. Finance desks: see the finance rows above.
Programmes (`notices.program`, key `program:{id}:{status}:{version}:{uid}`): proposed → holders
of `programs.approve` covering the unit; approved, or returned to draft (with the note) → the
proposer and the PICs. Plan revisions (`notices.programRevision`, key
`programRevision:{id}:{status}:{uid}`): requested → the same approvers; approved or rejected →
the requester. Both are sent after the commit; a failure is logged and never undoes the decision.

## Satisfaction polls (J3)

After LPJ `approved` (the PICs), finance `paid` (the requester) and recruitment `confirmed`
(the applicant), people with a WhatsApp number get a single-answer WAHA poll (1-5 stars,
`src/server/polls.ts`): once per event and person (`surveys/{sha256(source:id:uid)}` claimed
first), the options frozen on the survey (label → stars), the same delivery rules as messages
(`log` never sends; outside production only to test recipients). Votes arrive at
`POST /webhooks/waha` (HMAC-SHA512 of the body in `X-Webhook-Hmac` with `WAHA_WEBHOOK_SECRET`;
de-duplicated per vote, choice and time, so a changed vote counts and a retry does not) and are
stored by the poll's message id. The Email page shows asked / answered / average / 1-5 counts
per source for the last 12 months. [OWNER] WAHA dashboard → webhook URL
`https://<admin domain>/webhooks/waha`, events `poll.vote` and `message`, HMAC key = `WAHA_WEBHOOK_SECRET`.

## Linking a WhatsApp number by message (step 10.4)

The member opens `/account/profile` → **Link my WhatsApp**: the website makes a code (8 characters
without look-alikes `I L O 0 1`, 30 minutes, single use; a new code cancels the old one; stored as
`whatsappLinkCodes/{HMAC(code)}` with `SUBSCRIBER_HASH_SECRET`, the same value on web and admin;
never in clear, deleted by cron `expire`) and shows a `wa.me`
link and QR with the text `/asiania CODE` to the bot number (`WAHA_BOT_NUMBER`, web).

`POST /webhooks/waha` also takes the `message` event (`src/server/whatsapp-link.ts`). Only a text
starting with `/asiania ` from a private chat counts: the SENDER's number is saved on the profile
with `whatsappVerifiedAt` (`linkWhatsapp` in `packages/db/src/sql/member-profiles.ts`, audited with
the number redacted). A LID sender is resolved through WAHA first
(`GET /api/{session}/lids/{lid}`, `wahaResolveLid`); an unresolved LID, a group, our own message
and any other text are ignored. The reply (Indonesian, then English; sent through the messenger
so `MESSAGING_MODE=log` only records it) never repeats the code.

Rules: the webhook is processed ONLY when `WAHA_WEBHOOK_SECRET` is set and the HMAC matches
(otherwise anyone could fake a sender); a number already verified on another account is refused;
the code is used up even when refused; a replayed event is answered once (`webhookEvents`).
Typing a number by hand on the profile keeps working, clears `whatsappVerifiedAt`, and messages
still go to an unverified number. The profile and the Role Manager person popup show "verified" /
"not verified" (the popup never shows the number). [OWNER] WAHA dashboard → webhook events =
`poll.vote` + `message`; set `WAHA_BOT_NUMBER` on the website.
Tests: `tests/security/whatsapp-webhook.test.ts`, `tests/integration/whatsapp-link.test.ts`.

## Recruitment WhatsApp group (step 11.8)

The committee saves `recruitments.waGroup` `{ id, name }` on the recap page (group id like
`120363041@g.us`, pasted from WAHA; **Send test message** posts one line to it). Not built: choosing
the group from a list read from WAHA.

- Notices (web, `apps/web/src/server/group-notice.ts`, hooked into `createApplying` submit, booking
  and cancel): application submitted (`group:{applicationId}:submitted:{version}`), interview booked
  (`group:{applicationId}:booked:{slotId}`) and cancelled by the applicant
  (`group:{applicationId}:cancelled:{choiceId}:{version}`). Text: name (only while the application
  still runs), campus, choices, link to the application (sign-in needed). The head of each chosen
  unit and of its parent are mentioned by their VERIFIED numbers (`createSqlGroupNoticeReader`). Sent
  after the commit; a failure is swallowed and never undoes it.
- Keywords: `POST /webhooks/waha` `message` from the configured group (`src/server/whatsapp-group.ts`,
  the same route as the link code; the signature is checked first) answers `/rekap /posisi /ppin
/kampus /jenjang /wawancara /antrean /tren /bantuan` from `recruitmentRecap()` through
  `loadRecap(ids, scope)`. The sender is the group `participant` (a LID is resolved through WAHA),
  recognised by the VERIFIED number (`uidByVerifiedNumber`). Scope = the recap page (`recapScopeOf`):
  global `recruitment.read` sees all; head / deputy / secretary seats see their unit tree; anyone
  else gets a short refusal. `/bantuan` is answered to everyone. Group text is counts only: never a
  phone number, e-mail, score or (outside the notices) a name. At most 20 answers a minute per
  group (`rateLimits`, key `wagroup-{hash}`); a replayed event is answered once. One group on
  several recruitments: the one accepting applications, else the one opened last. `/tren` is the
  entry-year spread.
- [OWNER] Add the WAHA number to the group, copy the group id into the recap page, set `WAHA_*` on
  the website too, and keep the webhook events `message` (and `poll.vote`) on.
- Tests: `tests/integration/whatsapp-group.test.ts`, `tests/unit/recruitment-group.test.ts`,
  `tests/security/whatsapp-webhook.test.ts` (unsigned group message ignored).

## WhatsApp chatbot (C4)

`/webhooks/whatsapp` (`src/server/chatbot.ts`): GET answers Meta's verify-token handshake
(`WHATSAPP_CLOUD_VERIFY_TOKEN`); POST checks `X-Hub-Signature-256` (HMAC-SHA256 of the body with
`WHATSAPP_CLOUD_APP_SECRET`), de-duplicates each message by its id (`webhookEvents`) and replies
through the Meta Cloud API (`WHATSAPP_CLOUD_PHONE_NUMBER_ID`, `WHATSAPP_CLOUD_TOKEN`; replies only,
inside the free 24-hour window; anything proactive stays on WAHA).

- Keywords: `menu` (also halo/hai), `bantuan`, `batal`, `daftar` (sign-up), `oprec`.
- Sign-up: name → e-mail → chapter (numbered list) → campus (approved universities of the
  chapter's country, matched on the normalised name; the optional Gemini matcher
  (`GEMINI_API_KEY`, X4) only when nothing matched) → pick → confirm `ya` → the Firebase account
  is found or created (unverified, no password; `createFirebaseAccountCreator`) and its
  `users/{uid}` record made as on a first sign-in; the reply links `/login` (Google or "forgot
  password") to complete the profile on the website.
- Oprec: numbered open recruitments → the website's apply link (signed-in apply; the
  personality test link is on the application page).
- State: `whatsappConversations/{keyedHash(phone)}` (SUBSCRIBER_HASH_SECRET) with a 30-minute
  life (`expiresAt`, deleted by the `expire` job); the number itself is never stored.
- Not built: WhatsApp Flows for the Oprec questions (X5). Applying stays on the website until the
  Meta Flow set-up exists; the chatbot sends the link instead.

## Rules and assumptions

- The key is claimed in a transaction (create-if-absent); a second call with the same key
  returns `duplicate` and sends nothing. The provider also gets the key (`Idempotency-Key`).
- No address → `skipped`. Provider error or timeout → `failed` with the reason; staff retry
  from the Email page (only failed entries; the entry is set back to `queued` atomically).
- Every environment works on the live data, so `MESSAGING_MODE=log` (default) only records.
  `live` sends in production; in any other environment it sends only to
  `MESSAGING_TEST_RECIPIENTS` and records everyone else as `blocked`.
- The log stores the recipient and the content (needed to retry). Do not put secrets in
  messages.

## Configuration

`MESSAGING_MODE` (`log` | `live`), `MESSAGING_TEST_RECIPIENTS` (comma-separated e-mails and/or
E.164 numbers), `RESEND_API_KEY`, `EMAIL_FROM_TRANSACTIONAL`, `WAHA_BASE_URL`, `WAHA_API_KEY`,
`WAHA_SESSION` (default `default`), `WAHA_WEBHOOK_SECRET` (poll votes and link messages),
`WAHA_BOT_NUMBER` (web: the bot's number for the link) — see `docs/environment.md`. Without a Resend key
or sender, live sends fail with `not_configured` (visible on the Email page).
