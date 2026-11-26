# Events (admin Event page)

## What it does

Staff create events on the admin **Event** page: title, type, date and time, registration
deadline, location, URL, description, optional external registration link, banner, guest
speakers, rundown and sponsors. **Save draft** keeps it hidden (shown as **Private**), **Publish**
shows it on the site (**Public**); the row menu and the bulk bar publish / **Make private** at
once, the row menu copies the public link (`/events/<slug>`), and Delete moves events to the trash.

The list (the shared dark admin look, "Dark admin pages" in `apps/admin/src/app/globals.css`) has
the tabs All / Upcoming / Past / Drafts, a title search, a sort-and-filter menu on each sortable column, and
the columns Event, Event Date ("14 Nov 2026" on the event's clock + "In N days"), Location,
Status and **Last Modified** ("2 hours ago" + the author: the staff member of the event's newest
change, from the newest 500 `events` audit entries and `users/{uid}`, mapped by
`apps/admin/src/components/authors.ts`; nothing when no entry is in that window).

## Where it lives

- Rules and form schema: `packages/domain/src/events/index.ts` (`EventEntity`, `EVENT_TYPES`,
  `EventInputSchema`, `randomEventSlug`, `sortedSponsors`, `isRegistrationOpen`)
- Time zone helpers: `packages/domain/src/shared/time.ts` (`wallTimeToUtc`, `utcToWallTime`)
- Database: `packages/db/src/sql/events.ts` (`events/{id}`, slug index `eventSlugs/{slug}`,
  built on `slugged.ts`)
- Admin actions: `apps/admin/src/server/events.ts`; page `apps/admin/src/app/(panel)/events/`
  (`src/components/events-page.tsx`, rows mapped in `events-model.ts`)
- List cells (author, "In N days"): `apps/admin/src/components/authors.ts`, `events-model.ts`
- Tests: `tests/unit/events-cms.test.ts`, `tests/unit/time.test.ts`,
  `tests/unit/admin-events.test.ts`, `tests/integration/events-cms.test.ts`

## Rules and assumptions

- Required: title (3–200), type (fixed list; labels in `apps/admin/src/labels.ts`), date and time,
  location, description, banner (preset `banner`). The date, time and deadline are entered on the
  event's own clock and stored in UTC. The time zone (IANA, e.g. `Asia/Tokyo`) is not shown in the
  form: a new event takes the editor's browser zone, an edited event keeps its own.
- The registration deadline must be on or before the event date. Empty = registration closes when
  the event starts.
- The URL slug is unique; when left empty the server picks `event-` + 8 random hex characters.
- Registration link: http(s) only; empty = the site's own registration (step 2.5).
- Sponsors keep the order of the list (`order` 1, 2, 3 …); the site shows them in that order.
  Speaker photos and sponsor logos use the `speaker` upload preset.
- Permission `events.edit` for every change except making an event public, which needs the extra
  `events.publish` or an approval (DEC-25, "Life cycle" below); `events.read` to see the page.
- Every change is one transaction with a version check and an audit entry (module `events`,
  resource `event`): CREATE / UPDATE / PUBLISH / UNPUBLISH / DELETE. Delete is a soft delete;
  registrations (`eventRegistrations`) are kept. Revertible for 14 days except edits that changed
  the URL.
- The admin list loads the 500 most recently changed events and filters them in the browser.

## Life cycle (N1.1, DEC-25)

Rules live in `packages/domain/src/events/lifecycle.ts`; actions in `apps/admin/src/server/events.ts`.

- **Approval**: Ask for approval (`events.edit`) → holders of `events.publish` are told (notice
  `eventApprovalAsked`) → **Approve**, or **Reject** with a reason (kept on the event and in the audit
  entry; the event is a draft again) → the asker is told. Only an approved event can be published or
  scheduled; a holder of `events.publish` who publishes approves by doing so (the PUBLISH entry holds
  `approvedBy`). While a request waits, publishing is closed to everyone. Editing after approval needs
  no second approval. An event that was public before this step stays public; making it private and
  public again asks like any other.
- **Schedule**: `publishAt` (optional, must be before the start). A published event with a future
  `publishAt` is hidden by the readers until then (`isLive`, read-time like news, no cron job); the
  web cache lets it appear within a few minutes of that time. Unpublishing clears it.
- **Cancel**: reason required, `cancelledAt`; the public page stays reachable and says "cancelled",
  registration closes (`isRegistrationOpen`), and each registrant with a place or a waitlist spot is told
  once (message key `event:{id}:cancelled:{uid}`, no version). A second cancel is refused; the Audit Log
  revert is the only undo.
- **Stage**, computed by `eventStage`: preparing → public → running → after → locked (14 days after the
  end). "Past" (`isPast`) = ended, or started when no end is set (the form does not set an end yet, so
  an event is past once it starts). The admin form shows the five stages with their dates.
- **After the event**: `finalAttendance` (typed number), `attendanceNote` ("80 online, 40 on site") and
  `recapUrl` (http(s) link, opens outside) are saved with "Save results" once the event is past. The
  public page then shows "This event has ended" instead of the register button, these facts and the
  gallery album's first photos.
- **Dashboard**: the queue "Events waiting for approval" (holders of `events.publish`, in the event's
  chapter), `apps/admin/src/server/dashboard.ts`.

## Registration form (N1.2)

An event may link a **public Form answered with an account** (`events.registration`: `formId`,
`attendanceModes` online/on site, `showOnTicket` note, `shortUrl`). Rules in
`packages/domain/src/events/registration.ts`; admin actions in `apps/admin/src/server/event-registration.ts`.

- **Setup** (`events.edit`): the form must be public, account-only and not deleted. Unlinking returns to
  one-click registration. While a form is linked, the one-click `register` is refused ("register on its
  form page"), and the form page refuses an event with no form.
- **One submit, one transaction**: `/events/{slug}/register` saves the form response (the Forms engine:
  token, version check, validation) and the registration (capacity, deadline, attendance mode) together;
  if the event closed or filled in the meantime nothing is saved. The registration keeps `attendanceMode`,
  `responseId` and `formVersion`.
- **Try the form**: `?practice=1` runs the whole check and stores nothing (the event must be public).
- **Short link and QR**: one link per event through the existing short-link service (made once, reused);
  the QR is drawn in the browser.
- **Registrants** (`registrants.read`): name, email, status, mode and the form's answers next to each
  person (for example T-shirt size), from `listForEvent` and the form responses.
- Known limits: changing the linked form after people registered leaves their answers on the old form;
  a re-submit updates the answers but not the attendance mode.

## Paid events (N1.3, DEC-26)

Rules in `packages/domain/src/events/payment.ts`; store in `packages/db/src/sql/events.ts`; admin in
`apps/admin/src/server/event-registration.ts`; web in `apps/web/src/server/event-proof.ts` and the page
`/events/[slug]/ticket`. Money moves outside the platform; there is no gateway.

- **Fee** (`events.fee`, `events.edit`): `paid`, currency, categories (name, price, optional early price,
  optional places), `earlyUntil`, instructions and a public image (QR or account details). "Paid" is
  separate from the prices: with no category yet nobody can register ("price not set"). A paid event needs
  the registration form (N1.2), because the category is chosen there. The public page shows the prices,
  never the instructions; those are on the ticket page of a registered person.
- **Registration**: the amount is the early price when registered on or before `earlyUntil`, else the
  normal one. The seat is held as status `pending` (payment `unpaid`) and counts against the event capacity
  and the category's places (`eventCounters/{id}.categories`); a full event waitlists with no payment.
  A category holds one place per registration that was not cancelled, including a rejected one, which may
  send a new proof.
- **Proof**: the member sends an image or PDF (first bytes checked, up to 5 MB) on the ticket page; it is
  stored privately and the payment becomes `submitted`. A new proof is accepted while unpaid or after a
  rejection.
- **Check** (`events.payments`, in the registrants list; the dashboard queue "Payments waiting for a check"
  counts them): **Verify** → registration `confirmed`, payment `verified`, amount frozen, one cash book entry,
  all in one transaction; a second verify changes nothing. **Reject** needs a reason, keeps the seat and the
  member is told. The checker is never the payer. Who checked and when is on the registration and in the
  Audit Log.
- Not built: group payment, automatic refunds, bank statement matching, payment links, notice to checkers
  when a proof arrives (the web app has no checker list; the dashboard queue is the signal).
- Changing the fee: a category people registered for cannot be removed, and the fee cannot be turned off
  while someone still owes or waits for a check; amounts frozen at verification never change.

## Ticket QR and door scanner (N1.4)

- Ticket: `/events/[slug]/ticket` (web) shows, for a registration that may enter (confirmed; on a paid event
  also verified), the name, category, the organiser's `showOnTicket` text and a QR code. The QR holds a token
  derived with a keyed hash (`keyedHash("event-ticket", registrationId, SUBSCRIBER_HASH_SECRET)`), so it can be
  shown again at any time and never contains the registration id; only its SHA-256 is stored
  (`eventRegistrations.ticketHash`, written when the page is opened). Without the secret the page says the QR is
  not available and the door staff use the name search. Rotating the secret makes every open ticket page store
  a new hash on its next view; printed or saved tickets of the old token stop working.
- Scanner: admin `/events/[id]/scan` (link "Door scanner" in the event's registration panel). Allowed for the
  extra `events.checkin`, `registrants.edit` or a committee seat of this event (N1.5). Present / registered is on top; the camera (getUserMedia +
  `jsqr`; the Permissions-Policy of this route alone allows `camera=(self)`) or a name search gives one card:
  checked in, already checked in at (time), not paid, on the waiting list, cancelled, or "not a ticket for this
  event" (one neutral answer for a wrong, old or other-event token).
- One field for every way in: `checkedIn`, `checkedInAt`, `checkedInBy`, `checkInMethod` = `self | scan |
manual` (self check-in, main plan 9.4/2, is not built yet). Manual check-in shows the state first; an unpaid,
  waiting or cancelled registration has no button.
- Undo: the person who checked someone in, for 10 minutes; a holder of `registrants.edit` at any time. Check-in
  and undo are in the Audit Log ("Check-in", "Check-in undone").
- Practice: before the event day (in the event's time zone) a scan shows its result and stores nothing.
- Sponsorship reach uses `finalAttendance`, else the number checked in.
- Not built: separate committee tickets, the check-in notice to the registrant (N4.1),
  an offline mode of the scanner.
- Code: `packages/domain/src/events/checkin.ts`, `packages/db/src/sql/events.ts`,
  `apps/admin/src/server/event-checkin.ts`, `apps/admin/src/components/event-scan-page.tsx`. Tests:
  `tests/unit/event-checkin.test.ts`, `tests/integration/events-checkin.test.ts`.

## Event committee (N1.5)

- One document per event, `eventCommittees/{eventId}`: divisions (name, one level under a top-level division,
  people wanted, short description) and people with a seat (`head | deputy | secretary | treasurer | member`)
  in one division. The first division is the event board. A person is on a committee once; a helper without an
  account is typed in by name. Three templates (small, seminar, festival) fill the divisions.
- Edited in the event's form in the admin (button "Open the committee"), only with `events.edit`; saves are
  versioned and audited ("Event committee").
- Rights come from the seat, for THIS event only, and are recomputed on every request (removed today = no
  access today): any seat may scan tickets and see the short list of registrants (name, status, attendance
  mode; no e-mail, answers or payment); a seat in the event board sees the full registrant list. Nothing else
  (no edit, no payment check). The seat gives no `events.read`; the page and the scanner link need the extra
  `events.checkin`, `registrants.edit` or a seat (the guarded action decides, see `orIf` in
  `apps/admin/src/server/guarded-action.ts`).
- Lock: 14 days after the event ends (its start when it has no end), the seat gives no rights any more.
- Not built: the board managing its own committee, board editing the event, album upload, responsible units of
  an event, the SK draft from this list, the registrants table with column filters.

### Volunteers and committee applications (N1.6)

- No new form builder: the committee links up to four ordinary public forms (Forms page) in its "Applications"
  block. Kind `volunteer` = a sign-up form (usually `guest`); kind `committee` = an application answered with an
  account (`account` or `officers`). While a linked form is open, the public event page shows a button to it
  ("Volunteer for this event", "Apply for the committee") unless the event is past or cancelled.
- Placement: "Show applicants" lists the answers of each linked form (the newest 200: name, e-mail, answers).
  Per answer the event board or an `events.edit` holder picks a division and a seat and presses Place, or
  Reject. Place writes the seat into the committee and a decision row (`eventApplicants/{eventId}_{responseId}`)
  in one transaction, so an answer is decided once and a person holds one seat. A volunteer whose e-mail is an
  account gets a real seat; otherwise a typed helper with the name from the form.
- Rules: nobody places themselves; the 14-day lock refuses everyone; the applicant (when an account) is told
  "accepted as <seat> of <division>" or that the application was not accepted (one notice per answer).
- Not built: a system question "division, first and second choice" built from the divisions (the form asks the
  question as an ordinary choice question), one volunteer e-mail per event as a rule of its own (a guest form can
  be linked once per event; a repeat answer is refused as a second seat), the invite e-mail for a volunteer
  without an account, after-submit text and group link per form, a "my placement" page (N3.2).
- Code: `apps/admin/src/server/event-committee.ts` (`applicants`, `place`), `packages/db/src/sql/event-committees.ts`
  (`decide`, `decisionsOf`), `apps/web/src/server/events.ts` (`eventCommitteeCalls`). Tests:
  `tests/integration/events-committee.test.ts`.
- Code: `packages/domain/src/events/committee.ts`, `packages/db/src/sql/event-committees.ts`,
  `apps/admin/src/server/event-committee.ts`, `apps/admin/src/components/event-committee-panel.tsx`. Tests:
  `tests/unit/events-committee.test.ts`, `tests/integration/events-committee.test.ts`, seat cases in
  `tests/integration/events-checkin.test.ts` and `tests/integration/event-registration-admin.test.ts`.

### Evaluation and certificates (N1.7)

- Settings sit on the committee document (block "Evaluation" in the event's committee panel): the participant
  evaluation form, `certificateNeedsAttendance` (default on), the committee evaluation form and its window.
  Both forms are ordinary public forms of the Forms page. The participant form is anonymous when its own mode
  is `anonymous` or `guest`; then it cannot be a condition for a certificate (nobody knows who answered), so
  "anonymous" and "needed for the certificate" exclude each other by construction.
- Public event page: "Fill in the evaluation" once the event is past; "Committee evaluation" while the window
  is open (computed when read: not set / before / open / closed; set with +3, +7 or +14 days after the start).
- Committee evaluation: only an account with a seat in this event's committee may answer, inside the window.
  The check runs in the answer's own transaction (`refuseCommitteeAnswer`); a refused answer writes nothing and
  the form says so. One answer per account (a later answer replaces the first, the rule of every account form).
- Certificates: ONE function `entitledToCertificate` (confirmed registration; attended when the switch is on;
  evaluation answered with the account when the form is in `account` or `officers` mode). On a certificate
  batch (Letters > participants) "Add registrants" adds those people and lists who was left out and why (not
  confirmed, did not attend, evaluation not answered, account without a name, already on the batch). It needs
  `letters.edit` on the batch and `events.edit` or `registrants.read`.
- Not built: the standard question set ("Start from the standard questions"), the evaluator's division stored
  with the answer, the split of committee results (board sees answers, other members only the count; the Forms
  responses page applies as usual), a typed time window (only the three buttons), reading the evaluation in the
  officer assessment (9.3).
- Code: `packages/domain/src/events/evaluation.ts`, `apps/admin/src/server/event-certificates.ts`,
  `packages/db/src/sql/event-committees.ts`, `apps/web/src/server/forms-wiring.ts`. Tests:
  `tests/unit/events-evaluation.test.ts`, `tests/integration/event-certificates.test.ts`,
  `tests/integration/events-committee.test.ts`, `tests/integration/public-forms.test.ts`.

### Committee certificates (N1.8)

- Certificates: on a batch (Letters > participants) "Add committee" adds one sheet per committee member of the
  chosen event. The role text comes from ONE function, `committeeTitle` ("Head of Logistics, <event>"), and is
  printed as the sheet's note. Accounts keep their e-mail for pickup, typed helpers get a sheet without one; a
  person already on the batch with the same role is skipped. Same rights as "Add registrants".
- Not built: the officer assessment input (9.3), My Tasks "events I serve on".
- Code: `packages/domain/src/events/committee-title.ts`, `apps/admin/src/server/event-certificates.ts`
  (`addCommittee`). Tests: `tests/unit/events-committee.test.ts`, `tests/integration/event-certificates.test.ts`.

## Public pages and registration

`toPublicEvent` is what the website shows (no version or capacity). The web reader
(`createSqlEventReader`) lists published, live events; `createSqlRegistrationStore`
registers a member in one transaction: event open (`isRegistrationOpen`, closes exactly at the
deadline) → no existing `eventRegistrations/{eventId}_{uid}` → status by
`nextRegistrationStatus` and the counter `eventCounters/{eventId}`. Pages and captcha:
`apps/web/docs/public-site.md`.

## Configuration

Uploads need `FILE_STORAGE_DIR`.
