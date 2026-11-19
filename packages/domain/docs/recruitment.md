# Recruitment (Oprec)

## What it does

The recruitment committee opens a recruitment for a board period: a window, the units that take
officers (seat quota per unit, portfolio rule per unit), how many ordered unit choices an
applicant makes, how long an offer stays valid, and the recruitment form whose questions
applicants answer. Members apply on the website with a complete member profile: they pick their
choices, upload a portfolio (PDF) when a chosen unit asks for one, answer the questions, save a
draft and submit. Each person has ONE application per recruitment, and the application page
shows ONE next action.

## Where it lives

- Rules: `packages/domain/src/recruitment/index.ts` (statuses and transitions, set-up schema,
  window, choices, portfolio rule, `nextAction`, offer expiry); `analysis.ts` (AI result schemas,
  `pickFiles`).
- Storage: `packages/db/src/sql/recruitment.ts` — admin store (`recruitments`,
  `seatCounters`) and web store (the applicant's own `applications/{recruitmentId}_{uid}`).
- Admin: `apps/admin/src/server/recruitment.ts` (set-up) and `applications.ts` (selection), pages
  `/recruitment` (`src/components/recruitment-page.tsx`, `recruitment-model.ts`) and
  `/recruitment/{id}/applications` (`applications-page.tsx`, `applications-model.ts`),
  `/recruitment/{id}/interviews` (`interviews-page.tsx`; actions `src/server/interviews.ts`) and
  `/interviews` ("My interview times", step 11.5; menu Organization, only with an interview scope).
- Web: `/recruitment`, `/recruitment/[id]` (status + next action), `/recruitment/[id]/apply` (four steps, below),
  `/recruitment` goes straight to the recruitment when exactly one is open (`soleOpen`);
  upload route `POST /api/recruitment/[id]/portfolio[?question=q_…]`; logic
  `apps/web/src/server/recruitment.ts`, wiring `recruitment-wiring.ts`.
- Tests: `tests/unit/recruitment.test.ts`, `tests/unit/admin-recruitment.test.ts`,
  `tests/integration/recruitment.test.ts`, `tests/integration/selection.test.ts`,
  `tests/integration/interviews.test.ts`, `tests/integration/ratification.test.ts`,
  `tests/unit/personality.test.ts`, `tests/integration/personality.test.ts`,
  `tests/integration/student-proof.test.ts`, `tests/security/student-proof.test.ts`,
  `tests/integration/ai-analysis.test.ts`.

## How to use it

```ts
import { nextAction } from "@website/domain/recruitment";

const action = nextAction(recruitment, ownApplication, new Date()); // "start" | "revise" | …
```

## Rules and assumptions

- **Statuses** (feature-spec C3): draft → submitted → (revision → submitted) | admin_rejected |
  interview → offered → accepted | declined → approved → pakta_review (→ approved) → confirmed;
  other ends rejected, withdrawn. `TRANSITIONS` is the only source; final statuses lead nowhere.
- **Set-up** (`recruitment.edit`): the period must exist and not be archived; units must be of
  that period; the form must be a recruitment form, and applicants answer its CURRENT version
  when the recruitment is saved (frozen once someone submits). Each unit has a counter
  `seatCounters/{recruitmentId}_{orgUnitId}` `{ quota, filled }`, written in the same
  transaction; a quota never goes below `filled`, and a unit with taken seats cannot be removed.
- **Applying** (`applications.read_own` / `applications.write_own`): always the session's uid;
  signed in and `isProfileComplete` required; submitting also needs a proof of student status
  (`proofSatisfied`, alumni exempt, see `members.md`): `submit` answers `error: "proof"` and the
  apply page says so before the form (drafts can still be saved). Drafts check answers without requiring them; submit
  needs the window open, 1..maxChoices distinct units of the recruitment, every required answer
  and a portfolio when a chosen unit is flagged. Withdrawing is possible until a seat is taken.
- **Apply wizard** (step 11.4): `/recruitment/[id]/apply?step=1..4` on one page: (1) personal data =
  the profile form of `/account/profile` (same component, same `saveProfileAction`), (2) student
  proof = `StudentProofForm` (same route as the profile page), (3) the application form (saves the
  draft when left), (4) review and send (`submitApplicationAction`). `applyStep` opens the first
  unfinished step (profile incomplete -> 1, proof missing -> 2, else 3) and refuses a step past what
  is done. The page is exempt from the "complete your profile" redirect; an applicant whose
  application is running is sent to the status page. Not built: a short code per recruitment in the URL.
- **Files**: portfolios and file-question answers are PDFs only (`%PDF-` magic bytes), at most
  5 MB, stored privately (no URL): `recruitment/{id}/{uid}/portfolio_…pdf` and
  `forms/{formId}/{uid}_…pdf`. File answers come only from the upload route; a file "answer" sent
  with a draft is ignored, so no path can point at another applicant's file.
- **Selection** (admin `/recruitment/{id}/applications`, tabs per step; `src/server/applications.ts`):
  `recruitment.review` requests a revision (a new round `applicationRevisions/{appId}_{n}` with
  the request; rounds are never overwritten, a resubmission sets `resubmittedAt`; only while the
  application window is open, because the applicant can only resubmit then; a revision left
  open when the window closes can still be failed), fails
  (`admin_rejected`), passes (`interview`) and rejects; `recruitment.offer` offers one unit of the
  recruitment, valid `offerDays` (a full unit cannot be offered). Each decision is one
  transaction with its audit entry. The queue page needs review, offer or confirm.
- **Seats**: taken only when the applicant ACCEPTS on the website: the accept transaction reads
  and writes `seatCounters/{recruitmentId}_{unitId}` and refuses when `filled >= quota`, so
  concurrent accepts never exceed the quota. Rejecting an accepted applicant gives the seat back
  in the same transaction. Declining takes nothing.
- **Interviews** (C3-I, admin `/recruitment/{id}/interviews`, `src/server/interviews.ts`,
  `recruitment.review`): a day plan (day, from/until, minutes per interview, minutes between,
  a break, people per time, link or room) on the committee's clock becomes `interviewSlots`
  in UTC (`slotTimes`, at most 100 per plan, past times skipped). The day view lists each time
  with who booked it. An applicant in `interview` books on the website, shown on the clock of
  their profile time zone: ONE transaction reads the application, the chosen slot
  (`booked < capacity`, future, same recruitment) and the old slot, so capacity holds under
  concurrency and a re-booking frees the old time. A time with bookings is never deleted.
- **Interviewers, own times, one interview per choice** (step 11.5; domain
  `packages/domain/src/recruitment/interviews.ts`):
  - _Who interviews_ — ONE function, `interviewScope({ seats, units, review, granted })` (server
    wrapper `interviewScopeOf(uid)` in `wiring.ts`): the seats `head`, `deputy_head`, `secretary` of
    `activeSeats(uid)` (a division: its applicants; a directorate or bureau: its applicants and every
    unit below, by the unit `path`), the extra `recruitment.interview` (the scope of the assignment;
    global = everyone) and `recruitment.review` (everyone). Treasurer and member seats give nothing.
    An applicant is in scope when a chosen unit is in the scope units, or when they booked that
    person's time (`applicantInScope`). Suggested role for the extra: none by default; the seats
    already give scope.
  - _Slots_ — `interviewerUid`, `orgUnitId` (offered to that unit and every unit below it;
    `null` = a committee time, offered for every choice), `timeZone`, `mode` + `location` (link or
    address), `note`, `capacity` (default 1), `bookingCutoffHours` (default 12), `version`.
    "My interview times" (`/interviews`): tab _My times_ (add a day, change, cancel own times; the
    unit must be one of the viewer's seat units or `recruitment.interview` units, refused on the
    server otherwise; `recruitment.review` may use any unit) and tab _Interviews_ (applicants on
    my times; `?scope=all` = everyone in scope). The committee page keeps all times.
  - _Booking_ — `application.interviews` is keyed by the chosen unit (it replaces `interview`; old
    documents read as the first choice). `bookInterview(recruitmentId, uid, choiceId, slotId)` locks
    application + slot + old slot, checks the time is offered for that choice and not past its
    cut-off. A booking is changed or cancelled ONCE per choice (`interviewChanged`; a cancel spends
    it), never after the cut-off and never after attendance was recorded. A cancel by the
    interviewer does not spend it.
  - _Rules of a booked time_ — time and length cannot change, capacity cannot go below the
    bookings, it cannot be removed; link, address, note and mode can change (only a real change is
    saved and sent). The interviewer (or the committee) cancels it: bookings are dropped and the
    applicants asked to pick again.
  - _Read-only application page_ — interviewers without `recruitment.read` open
    `/recruitment/{id}/applications` for the applicants in scope who passed the document check
    (`createInterviewReads`, status `passedReview`); they get no selection button, no AI panel.
  - _Attendance_ — the committee button "Record result" is now "Record attendance": attended or
    absent with a note (`markAttendance`, `recruitment.review` or the interviewer of that very
    time). Selection buttons (pass, offer, ratify) keep their own permissions.
  - _Notices_ — see `apps/admin/docs/messaging.md` (booked, cancelled, changed) and
    `apps/admin/docs/cron.md` (30 minutes before, inside `meeting-reminders`). The day-before
    reminder of `deadline-reminders` stays.
  - Tests: `tests/unit/recruitment.test.ts`, `tests/integration/interviews.test.ts`,
    `tests/security/interview-scope.test.ts`.
- **Placement, pact, ratification** (C3 steps 7-9): `recruitment.confirm` (give it only to the
  Sekjen's role) approves the placement (accepted → approved). The applicant downloads the pact
  template (the recruitment's "Integrity pact template" link — [OWNER] provides the file) and
  uploads the signed PDF (private) → `pakta_review`; `recruitment.review` may send it back with a
  note (→ approved); every uploaded pact is kept (`pacts`). Ratify (`recruitment.confirm`,
  recent sign-in) sets `confirmed` AND creates the appointment (member seat in the offered unit
  of the ACTIVE period) in ONE transaction through the step 3.7 functions
  (`prepareAppointment`/`writeAppointment`), so roles are derived the normal way; the ratifier
  must hold the roles' permissions (`canRatifyInto`), staff roles need the applicant's second
  sign-in method, nobody ratifies themselves, and the applicant's sessions are renewed.
  `confirmed` is final: the appointment is created once.
- **Personality test** (C5, `src/recruitment/personality.ts`, ported from PPIDK
  `TesKepribadian`): 60 IPIP-adapted statements (Indonesian and English), 5 axes, a 16-type
  label plus an A/T suffix; not a clinical tool, not affiliated with any brand. After submitting,
  the application page shows a signed 7-day link `/test/personality/{token}` (LINK_SIGNING_SECRET,
  purpose "personality"; no sign-in needed). The server scores the answers (-3..3, all 60
  required) and stores ONE result in `personalityResults/{uid}` (scores only, never
  overwritten). The committee sees it on the application.
- **Switches** (`recruitment.edit`, also on a closed recruitment): `personalityTest` (default
  true; off = no test link on the application page, no "not taken yet" line for the committee)
  and `documentDeadline` (optional, may be after the closing time). A file question marked
  `mayFollow` is not required at submit. After submit (also after the window closed) the
  applicant uploads it from the application page (`setLateFile`, upload route
  `?question=q_…`): no status change, no revision round, only for `mayFollow` file questions in
  `LATE_UPLOAD_STATUSES`; after `documentDeadline` it is refused with the date (no deadline = no
  limit of its own). `nextAction` returns `upload_later` instead of `wait_review` while files are
  missing; the committee sees "Waiting for: <question>". The 3-day reminder before the document
  deadline and the AI-analysis input (11.9) are not built.
- **Seats per unit** (step 11.1, seats from 10.2 `seatsFor`/`seatLabel`/role map): each unit entry of a
  recruitment has `seats` (default `[member]`; stored recruitments without it read as `[member]`),
  chosen on the set-up page; the quota stays per unit for all seats together. A core unit is its own
  seat: its seats are forced to `seatsFor` (head) and the applicant gets no choice. The applicant's
  choice carries a seat wish (`applications.choiceSeats`, `checkChoiceSeats`): a unit with one open seat
  is filled in silently, with several the wish is required at submit (a draft may leave it empty) and
  is not binding. The offer is unit + `seat` (`makeOffer`, must be open in that unit; an offer stored
  before this step has no seat and reads as member). `head` is refused while the unit has an active
  head or another application of the recruitment holds an accepted/approved/pakta-review head offer.
  Ratify appoints the OFFERED seat through the same appointment transaction, so roles come from
  `derivedAssignments(seat, ...)` (a head gets the unit-head role) and `canRatifyInto` checks those.
  The applicants list and application page show the seat with `seatLabel`. Not built: quota, seats
  and portfolio rule on the unit (PPIDK "Formasi" page); they stay per recruitment.
- **Offers** expire at read time (`offerExpired`): no job releases them; an expired offer cannot
  be answered and the committee may offer again.
- **Student proof review** (`recruitment.review`): on the application page the committee opens
  the applicant's proof files (15-minute links with a version, built from the applicant's profile,
  never from a request path) and marks "Proof OK" or "Ask for a fix" (note required). The
  applicants list shows one mark (OK green, fix asked red, fixed blue, not checked grey; date and
  note in the tooltip) and a filter. Rules and storage: `members.md`.
- **Files** are opened by the committee through 15-minute signed links, only for paths that
  belong to that application (`fileUrl`, `recruitment.review`).
- **Audit**: set-up changes (module `recruitment`, resource `recruitment`; CREATE and DELETE
  revertible). Applicant changes are logged with the member as actor (resource `application`):
  status, choices, round, offer and portfolio name — never the answers.

- **AI analysis and proof check** (step 11.9, extra `recruitment.ai` "Run and read AI analysis";
  suggested role: the recruitment coordinator; interviewers and other committee members do not
  get it and see nothing of it). `src/server/ai-analysis.ts`, store `packages/db/src/sql/analyses.ts`,
  panel `application-ai-panel.tsx` in the application detail. Both go through `callModel` (step 10.5:
  the `applicationAnalysis` and `proofCheck` model slots, one `aiUsage` row per request).
  - _Analysis_, one request per application, outside the request: "Run analysis" stores a
    `queued` row in `applicationAnalyses/{id}` (a new row per run, the latest is shown; one queued
    row per application); the cron job `ai-jobs` takes ONE queued row per call (`queued` →
    `running` in one transaction), sends study data (campus, level, programme, entry and
    graduation year), the chosen units, the text answers and the files, and stores the forced tool
    output (summary, supporting points and interview questions per chosen unit, things to check).
    A failure is kept with its error, is never retried and can be run again. The interview
    questions are read by hand for the rubric (11.5), never copied.
  - _Files_: PDF, JPEG, PNG or WebP; a file over 5 MB, another type, or a total over 20 MB is
    skipped; a "may follow" file that has not arrived is noted. Every skipped file is stored with
    its reason and shown ("Not read").
  - _Proof check_, on demand in the request: both proof files + name, campus, level, programme,
    entry year, chapter and today's date; answer per field "match / differs / unreadable" and
    "active status stated: yes / no / unreadable"; history in `proofChecks/{id}` (newest shown).
  - _Never sent_: gender, birth date, WhatsApp number, photo, address (the request is built from
    named fields, never from the whole profile). No score, no recommendation; the status of an
    application is never changed from here. Every queue, run and check writes an audit entry (the
    cron job as actor `system`/`ai-jobs`), with the status only, never the answer.

## Import from PPIDK (block J, step 5.8)

- Mapping: `packages/db/src/ppidk/recruitment.ts` (pure, tested in
  `tests/unit/ppidk-recruitment-import.test.ts`); script:
  `infrastructure/scripts/import-ppidk-recruitment.mjs --dir <tsv folder> [--files <PPIDK private
storage>] [--apply]` (dry run by default, writes `import-recruitment-report.json`). Run it after
  the people import (it refuses otherwise); accounts are matched the same way (e-mail, else
  `ppidk-<id>`). Ids come from PPIDK (`ppidk-form-<id>`, `ppidk-recruitment-<id>`, ...), so a
  second run writes the same documents.
- Forms keep their versions and responses; guest forms get two extra questions (name and e-mail
  of the respondent). PPIDK `url` fields become short answers.
- Only the latest application per person and recruitment is imported, with its ranked choices,
  revision rounds, the interview (one booking, for the booking's own choice) and pact; seat counters are rebuilt from the applications that hold
  a seat. Personality results keep the scores only.
- Files: only real PDFs (checked by their first bytes) found under `--files` are referenced and
  copied privately to `FILE_STORAGE_DIR`; other files are listed in the report as skipped.

## Configuration

`FILE_STORAGE_DIR` on web (portfolio uploads); `ANTHROPIC_API_KEY` and `CRON_SECRET` on admin (AI analysis, cron job `ai-jobs`); `LINK_SIGNING_SECRET` on web (the
personality test links; the same secret signs newsletter links, the purpose keeps them apart).
