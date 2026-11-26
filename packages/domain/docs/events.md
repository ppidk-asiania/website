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

## Public pages and registration

`toPublicEvent` is what the website shows (no version or capacity). The web reader
(`createSqlEventReader`) lists published, live events; `createSqlRegistrationStore`
registers a member in one transaction: event open (`isRegistrationOpen`, closes exactly at the
deadline) → no existing `eventRegistrations/{eventId}_{uid}` → status by
`nextRegistrationStatus` and the counter `eventCounters/{eventId}`. Pages and captcha:
`apps/web/docs/public-site.md`.

## Configuration

Uploads need `FILE_STORAGE_DIR`.
