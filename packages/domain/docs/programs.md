# Programmes (OKR, work programmes, LPJ, report card)

Phase 6 of the plan (features E1-E5), ported from PPIDK `app/Support/Proker` and DECISIONS
§23-27 (rules and edge cases, not the PHP structure). This doc grows with each step.

```text
period vision + mission → objectives → key results → programmes → milestones
                                                          ↓
                                                   weekly check-in → LPJ
```

## OKR (E1)

Code: `src/programs/okr.ts` (rules), `packages/db/src/sql/programs.ts`
(`createSqlObjectiveStore`), `apps/admin/src/server/okr.ts` (guarded actions), admin page
`/okr` (`okr.read` / `okr.edit`). Tests: `tests/unit/programs.test.ts`,
`tests/integration/okr.test.ts`.

- **Vision and mission** live on the period (`periods/{id}.vision`, `.mission`): they change
  with the board and there are never two at once. They are edited on the OKR page (global
  `okr.edit`); the period form keeps them as they are.
- **Objectives** (`objectives/{id}`): `periodId`, `orgUnitId` (a unit of that period, or `null`
  for an objective of the whole region), `orgUnitPath` (scope), title, description, sort, and
  their **key results** inside the document (at most 20): title, unit ("people", "%"),
  baseline, target, current value, direction (`up` / `down`: some results are reached by
  shrinking, e.g. days to process a letter), sort, `measuredAt` (moves only when the value
  changes). A key result is a number, always; a goal that is not a number belongs in the
  objective's description. Objectives are deleted softly.
- **Achievement** (computed, never stored): a key result is where the current value sits between
  baseline and target, the same formula for both directions, clamped to 0-100 (a negative or
  180% value would distort averages); target = baseline means "keep it" (100 unless it moved the
  wrong way). An objective is the plain average of its key results (no weights: none were ever
  agreed), 0 without any.
- **Period scoping**: the page shows one period (`?period=`, default the active one). Every write
  reads the period in its transaction and refuses a missing or **archived** period (history is
  read-only); the unit must be a live unit of the same period.
- **Scope**: an `orgUnit` assignment of `okr.edit` covers that unit's objectives and the units
  below it; region objectives and the vision/mission need a global assignment. Moving an
  objective to another unit also needs `okr.edit` there.
- Audit: module `okr`, resource `objective` (key result changes are updates of their objective)
  or `period` (vision/mission); not revertible.

## Work programmes (E2) and weekly check-ins (E3)

Code: `src/programs/programs.ts` (rules), `packages/db/src/sql/programs.ts`
(`createSqlProgramStore`), `apps/admin/src/server/programs.ts` (guarded actions,
`canManageProgram`), admin pages `/programs` (list per period) and `/programs/[id]`. Tests:
`tests/unit/programs-workflow.test.ts`, `tests/integration/programs.test.ts`.

```text
draft ──submit──→ proposed ──approve──→ approved ──→ running ──→ finished
  ↑                  │
  └─ return (note) / withdraw (the proposer) ─┘
cancelled ← from proposed, approved or running, with a reason
```

- **Draft first** (step 13.1): a new programme is a `draft`. **Submit** (`programs.edit` of the
  unit) makes it a proposal. **Return** (`programs.approve`, with a note) sends a proposal back to
  draft; the **proposer** (`createdBy`) may **withdraw** a proposal before it is decided. The
  proposer may also **delete** their own draft or undecided proposal (soft delete, audit
  `DELETE`).
- **A programme that was ever approved is never returned and never deleted**: it is cancelled
  with a reason. (Return and delete only exist for `draft` and `proposed`, and nothing moves a
  programme back to them once approved.)

- **Plan** (`programs/{id}`, `programs.edit` of the unit, scope `orgUnit`): name, goal,
  background, the proposing unit (of the period), the **key results** it serves (`keyResultIds`:
  0-10, each once, all of the programme's period; none while it is a draft), planned dates, **budget lines** (`Money`: integer minor units +
  ISO 4217, one line per currency, never converted — DECISIONS §27) and the **PICs** (named by
  account e-mail, stored as uids). A draft or proposal is edited freely; **after approval the plan
  core is locked** (see "Plan revisions"). Nothing is edited once the programme is finished or
  cancelled; a new programme cannot be added to an archived period.
- **Approve** (`programs.approve`) needs at least one PIC; **return** needs a note; **cancel**
  needs a reason. **Start** needs at least one milestone; **finish**
  does not need every milestone done (what was not done is what the LPJ explains).
- **Running it** (start, finish, milestones, health, check-ins): `canManageProgram` — a PIC
  listed on the programme, or someone with `programs.edit` of its unit. Being a PIC is not a
  role (DECISIONS §24). **Opening** their own programme (and its LPJ) needs no `programs.read`:
  the page gate is `canOpenProgram` = the permission in the programme's scope OR being a listed
  PIC. Lists, the menu and exports still need the permission, and the PIC's actions on the page
  (milestones, check-ins) still pass the guarded action, i.e. need `programs.read` (the suggested
  `officer` role has it).
- **Milestones** live in the programme (at most 50): title, due date, **weight** (1-100), sort,
  completed at / by. `progressPercent` = weight done ÷ total weight, rounded, recomputed in the
  same write as every milestone change (add, edit weight, remove, done, opened again); there is
  no input field. No milestones = 0%.
- **Health** (`on_track` / `at_risk` / `off_track`, approved or running only) always needs a
  reason — also "on track" — and records who and when.
- **Weekly check-in**: `programCheckins/{programId}_{weekStartUtc}` (Monday 00:00 UTC: one
  week line for the whole region, UTC+5:30 to UTC+13). What was done (required), blockers,
  next week. Sending again in the same week updates that week's check-in; approved or running
  programmes only.
- Audit: module `programs`, resources `program` and `checkin`; not revertible.

## Plan revisions (step 13.1)

Code: `src/programs/programs.ts` (`CORE_FIELDS`, `assertPlanEditable`, `RevisionChangesSchema`),
`src/programs/revisions.ts` (`applyRevision`, `decideRevision`), `packages/db/src/sql/programs.ts`
(`requestRevision`, `decideRevision`, `listRevisions`, `listPendingRevisions`),
`apps/admin/src/server/programs.ts` (`requestRevision`, `decideRevision`). Tests:
`tests/unit/programs-workflow.test.ts`, `tests/integration/programs.test.ts`.

- **Locked after approval** (approved or running): name, unit, goal, planned dates, budget lines
  and key results. Saving the plan with one of them changed is refused ("ask for a revision").
  PICs, milestones, background, health and check-ins stay free.
- **A revision is a row** `programRevisions/{id}`: `programId`, `periodId`, `orgUnitPath`,
  `changes` (only the locked fields, at least one, same rules as the plan form), `reason`,
  `requestedBy`, `status` (`pending` | `approved` | `rejected`), `decidedBy`, `decidedAt`.
  Rejected revisions are kept and shown on the programme page.
- **Request**: a PIC or the unit's `programs.edit` holder, on an approved or running programme,
  with a reason; moving the programme to another unit also needs `programs.edit` there. The
  revised plan is validated like a new plan (unit and key results of the period). **One open
  revision per programme.**
- **Decide**: `programs.approve` in the programme's scope, and **never the requester** (also
  refused for a superadmin or someone who holds both). **Approving rewrites the plan, the
  revision and both audit entries in one transaction** (programme version +1); rejecting
  changes only the revision. A revision cannot be approved once the programme is finished or
  cancelled (it can be rejected).
- **Where it shows**: the programme page (Request revision, the revision list with Approve /
  Reject), My Tasks ("Decide the revision of ..." for approvers, in their scope, not their own)
  and the dashboard queue "Programme plan revisions to decide". The LPJ plan snapshot is taken at
  finish, so it shows the revised plan. Audit: module `programs`, resource `programRevision`.

## LPJ (E4) and its PDF (D9)

Code: `src/programs/lpj.ts` (rules), `packages/db/src/sql/programs.ts`
(`createSqlProgramStore().finish`, `createSqlLpjStore`), `apps/admin/src/server/lpj.ts`
(guarded actions, `lpjSheet`, `createLpjFileRoute`), `packages/pdf/src/report.ts`
(`renderReportPdf`), admin pages `/lpj` (`lpj.read`, list per period) and `/lpj/[id]`
(`lpj.read`, or `programs.read` of the programme's unit), PDF `GET /api/lpj/<id>/pdf`. Tests:
`tests/unit/lpj.test.ts`, `tests/integration/lpj.test.ts`.

```text
draft ──→ submitted ──┬─ secretariat review ─┐
  ↑                   └─ treasurer review  ──┴─→ approval ─→ approved
  └── returned (note; every desk cleared) ←─ any desk
```

- **Opened by finishing the programme**, in the same transaction: `lpjReports/{programId}`
  (one LPJ per programme; a second `create` fails the transaction) with a **frozen plan**
  (name, goal, background, unit name, dates, budgets, PICs, progress, milestones with their
  final state, started/finished) and `dueOn` = the finish day (UTC) + `period.lpjDeadlineDays`
  (14 when the period has none), **never later than the period's end date** (`endsOn`). The plan
  is a copy: nothing later changes it. Extending the due date later is not capped.
- **PICs write and submit** (`canManageProgram`): realization, participants, money spent per
  currency (`realized`, `null` = not filled in, `[]` = nothing spent), obstacles,
  recommendations. Completeness is checked at submit, not at save.
- **Three desks** (named extras of the `lpj` page): `lpj.review_secretariat` (the Secretariat
  bureau, global — not a directorate secretary, who writes LPJs), `lpj.review_treasurer` and
  `lpj.approve`. The two reviews come in any order; the approval needs both. **Three different
  people**, and **neither the submitter nor any PIC of the programme signs** any desk. The treasurer refuses an LPJ without
  money spent.
- **Return** (any desk holder, with a note) clears all three desks and counts the revision
  round; the PICs edit and submit again.
- **Overdue** is a read-time rule (`isOverdue`: not approved and today (UTC) > `dueOn`). The due
  date is extended with `programs.approve` (a deadline the PIC can move is no deadline), never
  after approval.
- **PDF** rendered at download time from the record (`lpjSheet` → `renderReportPdf`, never
  stored): the frozen plan, the PICs' report, budgets per currency, and the desks with name and
  date — a desk that has not signed prints "Belum diperiksa / not yet reviewed".
- **Notices** (J2, `notices.lpj`, `apps/admin/docs/messaging.md`): opened → PICs (with the due
  date); submitted → both review desks; both reviews in → the approval desk; returned /
  approved → PICs. The LPJ sheet prints the approval desk under the period's desk title
  (`deskTitle`, step 10.1).
- **Programme notices** (13.2, `notices.program`, `notices.programRevision`): proposed → approvers
  of the unit; approved / returned → proposer and PICs; revision requested → approvers; revision
  decided → the requester.
- **Weekly check-in reminder**: part of `deadline-reminders`; on Thursday (UTC) the PICs of
  running programmes without a check-in for the current UTC week get one message. Finished and
  cancelled programmes are never reminded of check-ins.
- **Deadline reminders** (M6, cron `deadline-reminders`, `apps/admin/docs/cron.md`): PICs get
  one reminder per due date for open milestones and draft/returned LPJs due within 3 days, and
  one when a draft/returned LPJ is past due. Applicants get one the day before their interview.
- **Dashboard**: a warning when no account holds `lpj.review_secretariat` globally (shown to
  `roles.edit`, LPJ desks and programme approvers).
- Audit: module `lpj`, resource `lpj`; not revertible. LPJs are never deleted.

## Period report card (E5)

Code: `src/programs/report.ts` (pure maths), `packages/db/src/sql/programs.ts`
(`createSqlPeriodReport().card(periodId, now)`), admin page `/programs/report?period=`
(`programs.read`; linked from the Programmes header), its PDF at `/api/programs/report?period=`
(`reportCardSheet` in `apps/admin/src/server/exports.ts`, M8). Tests: `tests/unit/report-card.test.ts`,
`tests/integration/lpj.test.ts` (report card).

- **Computed on every request, nothing stored** (a stored report goes stale and is then read as
  the truth).
- Programme numbers are COUNT queries: per status, "at risk" (approved or running with health
  at risk / off track), and **completion** = finished ÷ (approved + running + finished) —
  drafts, proposals and cancelled programmes were never promises and are left out.
- LPJ numbers are COUNT queries: waiting for review (submitted), approved, **overdue** (not
  approved and `dueOn` before today, UTC — the same read-time rule as `isOverdue`).
- **OKR achievement** = average of the objectives' achievement (each the plain average of its
  key results).
- **Budget absorption per currency, never converted**: planned = budget lines of approved,
  running and finished programmes; spent = money spent of **approved** LPJs only (checked by
  the treasurer); absorption = spent ÷ planned (none when nothing was planned in that
  currency). Totals use `addMoney`, which refuses to add two currencies.
- Shortcut: the budget totals read the documents (the store has COUNT, not SUM); fine for a few
  hundred programmes per period.
- The card shows the whole period's totals to anyone with `programs.read` (programmes are open
  to every officer, DECISIONS §24).

## Import from PPIDK (block J, step 6.7, DEC-10)

- Mapping: `packages/db/src/ppidk/programs.ts` (pure, one mapper for OKR, programmes, LPJ and
  finance; tested in `tests/unit/ppidk-programs-import.test.ts`, which reads the plan back through
  the objective, programme, LPJ and finance stores and the period report card); script:
  `infrastructure/scripts/import-ppidk-programs.mjs --dir <tsv folder> [--files <downloaded PPIDK
PDFs>] [--apply]` (dry run by default, writes `import-programs-report.json`). Run it after the
  people import (it refuses otherwise) and after freezing the PPIDK proker and finance screens.
  Tables: `users`, `org_units`, `objectives`, `key_results`, `programs`, `program_members`,
  `program_milestones`, `program_checkins`, `program_reports`, `keuangan_pengajuan`,
  `keuangan_transaksi`. Ids come from PPIDK (`ppidk-objective-<id>`, `ppidk-keyresult-<id>`,
  `ppidk-program-<id>`, `ppidk-milestone-<id>`; check-ins `{programId}_{weekStartUtc}`; the LPJ
  is `lpjReports/{programId}`).
- Step 13.1 changes to the programme import are only partly done here: `draf` → draft and the
  single `key_result_id` → `keyResultIds: [id]`. The `key_result_program` table,
  `program_revisions` and `programs.created_by_user_id` are left for step 16.4.
- Statuses: `draf` → draft, `usulan` → proposed, `disetujui` → approved, `berjalan` → running, `selesai` →
  finished, `dibatalkan` → cancelled; key result direction `naik` → up, `turun` → down; LPJ
  `diajukan` → submitted, `revisi` → returned, `disetujui` → approved.
- PICs: the PPIDK PIC first, then the programme members (their role label is not kept). Budgets:
  `budget_estimate` + `budget_currency` → one budget line, in the currency's minor digits
  (`50000.00` JPY → 50000; a value with more decimals than the currency has is reported).
- Progress is recomputed with the platform rule (`withProgress`); a programme whose stored PPIDK
  percentage differs is reported. Milestone weights outside 1-100 are clamped (reported). Who set
  the health and who created a programme were not recorded in PPIDK (`ppidk`). Plan fields the
  platform has no own field for (target audience, indicator, activity, location, partners,
  risks) become lines of the description; `category`, `level` and `is_online` are not imported.
- Check-ins: the week is re-computed as the UTC Monday; a second report for the same week is
  reported and left out.
- LPJ: opened with the platform's `openLpj` (the plan frozen from the imported programme, not
  PPIDK's `plan_snapshot`), due on PPIDK's `lpj_deadline` (else 14 days after the finish), the
  three desks (secretariat, treasurer, approval) with who and when. Testimonials and
  documentation links (PPIDK had no LPJ files) are added to the realization text. Only LPJs of
  finished, imported programmes are imported.

## Suggested roles (data, Role Manager)

Roles are data (DEC-11): create these in Role Manager → Edit Role (nothing is seeded in code).

| Role (suggested id)          | Permissions                                                        |
| ---------------------------- | ------------------------------------------------------------------ |
| `officer` (every officer)    | `okr.read`, `programs.read` (enough to be a PIC and to act as one) |
| `director` (unit head, unit) | `okr.edit`, `programs.edit` (scoped to the unit by appointment)    |
| `secretary_general`          | `okr.edit`, `programs.approve` (global: region objectives, vision) |
| `coordinator`                | `programs.approve`                                                 |
| `secretariat` (bureau)       | `lpj.review_secretariat` (global), `programs.read`                 |
| `treasurer`                  | `lpj.review_treasurer`, `programs.read`                            |

`secretary_general` and `coordinator` also get `lpj.approve`. No suggested role holds two LPJ
desks (separation of duties; the rule in code holds anyway, also for a superadmin).
