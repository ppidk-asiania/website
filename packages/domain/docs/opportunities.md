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
- **Apply link:** an https link, or empty = apply on the platform (built in N6.2). The browser never
  receives the link: the button goes to `/opportunities/{id}/apply`, which needs a signed-in account,
  refuses a posting that is closed, past its deadline or without a link, counts one click and redirects.
  The counter (`opportunityClicks`) stores a number only, never who clicked.
- **Guides:** news articles of the category `career` are listed under "Career guides" on the board.
- **Delete** is soft; the audit log keeps the short fields of every change (not the long texts).

## Not built

Company accounts posting by themselves; applications and mentorship (N6.2).
