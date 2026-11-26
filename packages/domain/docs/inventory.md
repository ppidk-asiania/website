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
