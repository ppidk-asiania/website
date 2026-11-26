# Inventory

Equipment the region, a chapter or a unit owns and others may borrow (DEC-31). Code:
`packages/domain/src/inventory`, stores `packages/db/src/sql/inventory.ts`, admin actions
`apps/admin/src/server/inventory.ts`, page `/inventory`.

## Rules and assumptions

- **One owner per item:** the region (global scope), a chapter or an org unit. The holders of
  `inventory.edit` in that scope manage the item; `inventory.read` lets them see it. The owner is
  fixed when the item is created. A unit's path is read on the server, never taken from the request.
- **Stock:** `total` and `available`, with `0 <= available <= total`. A new total moves `available`
  by the same amount, so what is out on loan stays out and the total can never go below it.
- **Log:** every change of the total, the condition or (from N7.2) a loan step writes one
  `inventoryLog` row in the same transaction as the change. A refused change writes nothing.
- **Condition:** good, damaged, retired. A retired or hidden item leaves the public catalogue and
  keeps its history. A damaged one stays listed with a note.
- **Delete** is soft and only when nothing is out on loan (retire an item to keep its history).
- **Public catalogue** (`/inventory`): published, not retired, not deleted items with "N available".

## Borrowing (N7.2)

- **Who asks:** a member with a complete profile (a small JSON request), or an outsider with a name,
  an e-mail, a phone number and a signed statement (a PDF, up to 5 MB, checked by its first bytes;
  reCAPTCHA). The statement stays on the private file store and an approver opens it by a short-lived link.
- **Flow:** pending -> approved or rejected (with a reason) -> handed over -> return asked by the
  borrower (optional) -> returned. A member may cancel while it is pending or approved. Only the owner's
  `inventory.approve` holders decide; the approver is never the borrower.
- **Stock:** the hand-over reads and writes the item in ONE transaction with its log row and refuses
  when `available` is too low, so two hand-overs for the last unit cannot both go out. A return puts the
  quantity back (never above `total`); a damaged return also marks the item damaged.
- **Checks at the request:** the start day is not in the past, the item is listed, and the quantity is
  not more than the item's total.
- **Overdue** is a read-time rule (`to` passed and still out). The daily `deadline-reminders` job sends
  ONE reminder per loan (`reminder:loan:{id}`); the dashboard queue "Loans waiting or overdue" counts
  requests waiting for a decision and loans out past their day.
- **Notices:** approved, rejected, handed over and returned go to the borrower (an outsider by the
  e-mail they gave); the request itself is acknowledged by e-mail. Approvers are not messaged on a new
  request: they see the dashboard queue.

## Reservations, contributions, procurement and outside loans (N7.3)

- **Reservations:** `inventory.edit` holders of the item's owner scope, or the BOARD of the event
  (`orIf`), block units of an item for an event's days. A reservation, a loan request, a hand-over and an
  outside loan all check the units other ACTIVE reservations hold on overlapping days
  (`reservedDuring` / `assertNotReserved`, inside the same transaction as the stock). A loan out already
  is not counted against a new reservation (only against `total`). Deleting the event releases its
  reservations; a reservation can also be released by hand.
- **Contributions:** a signed-in member with a complete profile offers an item to GIVE (a gift) or to LEND
  (needs a return date). An approver of the chosen owner scope adds it as ONE new item (a lent item keeps
  `lentBy {name, returnOn}`), with an "added" log row, in the same transaction. Nobody decides on their
  own offer; a rejection needs a reason. The member sees the state on `/inventory`.
- **Procurement:** `inventory.edit` of the owner asks to buy (`name`, `why`, estimate, urgency);
  `inventory.approve` approves or rejects (reason); an approved one is marked fulfilled after the
  purchase. The requester never decides their own request. Buying and money stay in Finance: "Ask Finance"
  opens `/finance?title=&description=&amount=&currency=` with the form filled in (`financePrefill`).
- **Outside loans:** `inventory.approve` lends units to a named body (contact, purpose, back-by day) and
  takes them back. Stock and the log row move in one transaction; units reserved for an event on those
  days cannot go. Overdue is read-time (`isOutsideOverdue`).
- **Not built:** the event board reserves through the action only (no board screen yet); the offer
  sender and the requester are not messaged about a decision.
