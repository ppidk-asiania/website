# Opportunities

A board of jobs, internships, volunteer work and scholarships that the region or a chapter posts
(DEC-30). Code: `packages/domain/src/opportunities`, store `packages/db/src/sql/opportunities.ts`,
admin actions `apps/admin/src/server/opportunities.ts`, pages `/opportunities` (web and admin).

## Rules and assumptions

- **Who manages a posting:** holders of `opportunities.edit` in its scope. A posting made for a
  chapter is that chapter's; one for the region needs a global holder. The chapter is fixed when the
  posting is created and is never taken from an edit. Company accounts cannot post by themselves.
- **Phases** (one function, `opportunityPhase`): `open` until the deadline day is over, then `past`
  (still on the board, greyed, no apply button); `closed` postings are `archived`; deleted ones are
  `hidden`. No deadline means open until closed.
- **Board and archive:** `/opportunities` lists open and past postings (open first, nearest deadline
  first) with filters by type and country. `/opportunities/archive` lists the closed ones.
- **Texts:** the description and the requirements are article HTML, sanitised when saved and again when shown.
- **Apply link:** an https link, or empty = apply on the platform (see Applications). The browser never
  receives the link: the button goes to `/opportunities/{id}/apply`, which needs a signed-in account,
  refuses a posting that is closed, past its deadline or without a link, counts one click and redirects.
  The counter (`opportunityClicks`) stores a number only, never who clicked.
- **Guides:** news articles of the category `career` are listed under "Career guides" on the board.
- **Delete** is soft; the audit log keeps the short fields of every change (not the long texts).

## Applications and mentorship (N6.2)

- **Apply on the platform:** a posting with no link. A signed-in member with a complete profile sends a
  cover letter (20-3000 characters) and a CV (PDF, 5 MB at most, private) to
  `POST /api/opportunities/{id}/applications`. One application per account per posting
  (`opportunityApplications/{opportunityId}_{uid}`); none after the deadline or when closed. A refused
  second try never touches the first CV. A receipt e-mail is sent.
- **Statuses:** `submitted` → `under_review` → `interview` → `offered`; `rejected` from any open step;
  `offered` and `rejected` are final (`nextStatuses`). The applicant sees the status on the board
  (and later on My submissions) and is told by e-mail and notice when it changes.
- **Admin:** Opportunities → row menu → Applicants (postings without a link). Open the CV (a 15-minute link,
  only for people who can read the posting's scope), change the status, write an internal note,
  delete one application (audited, the CV file is removed). The note is never sent to the applicant's
  browser (`toMyApplication` has no note and no CV path).
- **Mentorship:** an account form (respondents "account") chosen in `settings/opportunities.mentorshipFormId`
  by a global editor ("Mentorship Form" button). The board links to its `/f/{token}`. No new store.

## Not built

Company accounts posting by themselves; mentor matching.
