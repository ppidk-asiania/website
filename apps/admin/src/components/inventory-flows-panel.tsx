"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { FINANCE_CURRENCIES } from "@website/domain/finance";
import { URGENCIES } from "@website/domain/inventory";
import { toMinor } from "@website/domain/shared";
import {
  approveContributionAction,
  decideProcurementAction,
  lendOutAction,
  rejectContributionAction,
  releaseReservationAction,
  requestProcurementAction,
  reserveItemAction,
  takeBackOutsideAction,
} from "@/app/(panel)/inventory/actions";
import { actionMessage, type ActionFailure } from "@/components/action-message";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Column } from "@/components/ui/data-table";
import { FieldError } from "@/components/ui/field-error";
import {
  ListCard,
  ListEmpty,
  MenuItem,
  RowMenu,
  SearchBox,
  SortMenu,
  useListTable,
} from "@/components/ui/list-controls";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";

/** What every tab draws first: the page header around its actions, and the tab bar. */
export type TabHeader = (actions: ReactNode) => ReactNode;

export const ownerInput = (value: string) => {
  const [kind, id] = value.split(":");
  return kind === "chapter"
    ? { kind: "chapter" as const, chapterId: id ?? "" }
    : kind === "unit"
      ? { kind: "unit" as const, orgUnitId: id ?? "" }
      : { kind: "region" as const };
};

/** Search box state shared by the list tabs: one query, filtered rows, and the cleared state. */
export function useTabList<T extends { id: string }, K extends string>(
  rows: T[],
  matches: (row: T, query: string) => boolean,
  sortValue: (row: T, key: K) => string | number,
  filterText?: (row: T, key: K) => string,
) {
  const [query, setQuery] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => !q || matches(row, q));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `matches` is a fixed rule of the tab
  }, [rows, query]);
  const table = useListTable(shown, sortValue, undefined, filterText);
  return {
    table,
    query,
    searchKey,
    search: (value: string) => {
      setQuery(value);
      table.setPage(1);
    },
    clear: () => {
      setQuery("");
      setSearchKey((k) => k + 1);
      table.clearFilters();
      table.setPage(1);
    },
  };
}

export interface ReservationRow {
  id: string;
  item: string;
  event: string;
  quantity: number;
  period: string;
  active: boolean;
  canEdit: boolean;
}
export interface ContributionRow {
  id: string;
  name: string;
  by: string;
  quantity: number;
  mode: "give" | "lend";
  returnOn: string | null;
  description: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
}
export interface ProcurementRow {
  id: string;
  name: string;
  owner: string;
  why: string;
  estimate: string;
  urgency: string;
  status: "pending" | "approved" | "rejected" | "fulfilled";
  note: string | null;
  canDecide: boolean;
  financeQuery: string;
}
export interface OutsideRow {
  id: string;
  item: string;
  borrower: string;
  contact: string;
  purpose: string;
  quantity: number;
  period: string;
  status: "out" | "returned";
  overdue: boolean;
  canDecide: boolean;
}

/** Everything the four N7.3 tabs need, read on the server in the scope of the viewer. */
export interface FlowsData {
  items: { id: string; name: string; canEdit: boolean; canApprove: boolean }[];
  owners: { value: string; label: string }[];
  events: { id: string; title: string }[];
  reservations: ReservationRow[];
  contributions: ContributionRow[];
  procurement: ProcurementRow[];
  outside: OutsideRow[];
  canApprove: boolean;
}

const TONE: Record<string, BadgeTone> = {
  pending: "warn",
  approved: "primary",
  rejected: "danger",
  fulfilled: "success",
  out: "primary",
  returned: "success",
};
const today = () => new Date().toISOString().slice(0, 10);

type Result = { ok: true } | ActionFailure;

/** The Back + Save row every popup of the admin ends with. */
const saveFooter = (onBack: () => void, onSave: () => void, busy = false) => (
  <div className="admin-modal__footer-row">
    <Button variant="outline" icon="chevronLeft" onClick={onBack}>
      Back
    </Button>
    <Button type="submit" variant="primary" icon="cloud" disabled={busy} onClick={onSave}>
      Save
    </Button>
  </div>
);

function Field(props: { id: string; label: string; full?: boolean; children: ReactNode }) {
  return (
    <div className={`admin-field${props.full ? " admin-form-grid__full" : ""}`}>
      <label className="admin-field__label" htmlFor={props.id}>
        {props.label}
      </label>
      {props.children}
    </div>
  );
}

/** One place for the run-an-action, refresh, toast cycle of the tabs. */
function useRunner() {
  const router = useRouter();
  const toast = useToastMessage();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Resolves true when it worked; a failure is shown in the popup (or the toast when there is none). */
  const run = async (
    action: (input: unknown) => Promise<Result>,
    input: unknown,
    done: string,
    inPopup = true,
  ) => {
    setBusy(true);
    const result = await action(input);
    setBusy(false);
    if (!result.ok) {
      if (inPopup) setMessage(actionMessage(result));
      else toast.show(actionMessage(result));
      return false;
    }
    setMessage(null);
    router.refresh();
    toast.show(done);
    return true;
  };
  return { run, toast, message, setMessage, busy };
}

/* ---- Reservations ---------------------------------------------------------------------------- */

type ReservationKey = "reserved" | "status";
const reservationSort = (r: ReservationRow, key: ReservationKey): string =>
  key === "reserved" ? r.item.toLowerCase() : r.active ? "Reserved" : "Released";

export function ReservationsTab(props: { flows: FlowsData; header: TabHeader }) {
  const { flows } = props;
  const { run, toast, message, setMessage, busy } = useRunner();
  const [dialog, setDialog] = useState<{
    itemId: string;
    eventId: string;
    quantity: string;
    from: string;
    to: string;
  } | null>(null);
  const editable = flows.items.filter((i) => i.canEdit);
  const list = useTabList(
    flows.reservations,
    (r, q) => [r.item, r.event].some((v) => v.toLowerCase().includes(q)),
    reservationSort,
    (r, key: ReservationKey) => (key === "reserved" ? r.item : r.active ? "Reserved" : "Released"),
  );
  const { table } = list;
  const canAdd = editable.length > 0 && flows.events.length > 0;
  const open = () => {
    setMessage(null);
    setDialog({
      itemId: editable[0]?.id ?? "",
      eventId: flows.events[0]?.id ?? "",
      quantity: "1",
      from: today(),
      to: today(),
    });
  };

  const columns: Column<ReservationRow>[] = [
    {
      key: "reserved",
      header: table.header("reserved", "Reserved"),
      render: (r) => (
        <>
          <span className="admin-table__title">
            {r.quantity} × {r.item}
          </span>
          <span className="admin-table__sub">
            {r.event} · {r.period}
          </span>
        </>
      ),
    },
    {
      key: "status",
      header: table.header("status", "Status"),
      render: (r) => (
        <Badge tone={r.active ? "primary" : "neutral"}>{r.active ? "Reserved" : "Released"}</Badge>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      render: (r) =>
        r.active && r.canEdit ? (
          <div className="admin-table__actions">
            <Button
              variant="ghost"
              size="icon"
              icon="undo"
              aria-label="Release"
              title="Release"
              onClick={() => void run(releaseReservationAction, { id: r.id }, "Released", false)}
            />
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      {props.header(
        <>
          {canAdd ? (
            <div className="admin-fab">
              <Button variant="primary" size="sm" icon="plus" onClick={open}>
                Add Reservation
              </Button>
            </div>
          ) : null}
          <SortMenu columns={columns} />
          <SearchBox
            key={list.searchKey}
            placeholder="Search by item or event..."
            label="Search reservations"
            onSearch={list.search}
          />
        </>,
      )}
      <ListCard
        table={table}
        noun="reservation"
        columns={columns}
        empty={
          <ListEmpty
            noun="reservation"
            query={list.query}
            filters={table.filterCount}
            emptyHint="Reserve equipment for the days of an event."
            onClear={list.clear}
            addLabel="Add Reservation"
            onAdd={canAdd ? open : null}
          />
        }
      />
      <Modal
        asForm
        open={dialog !== null}
        title="Reserve for an Event"
        subtitle="Other loans and reservations cannot use these units on those days."
        onClose={() => setDialog(null)}
        footer={saveFooter(
          () => setDialog(null),
          () =>
            dialog &&
            void run(
              reserveItemAction,
              { ...dialog, quantity: Number(dialog.quantity) },
              "Reserved",
            ).then((ok) => ok && setDialog(null)),
          busy,
        )}
      >
        {dialog ? (
          <div className="admin-form-grid">
            <Field id="reserve-item" label="Item" full>
              <Select
                id="reserve-item"
                value={dialog.itemId}
                onChange={(e) => setDialog({ ...dialog, itemId: e.target.value })}
              >
                {editable.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="reserve-event" label="Event" full>
              <Select
                id="reserve-event"
                value={dialog.eventId}
                onChange={(e) => setDialog({ ...dialog, eventId: e.target.value })}
              >
                {flows.events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="reserve-quantity" label="Quantity">
              <input
                id="reserve-quantity"
                className="admin-input"
                type="number"
                min={1}
                value={dialog.quantity}
                onChange={(e) => setDialog({ ...dialog, quantity: e.target.value })}
              />
            </Field>
            <Field id="reserve-from" label="From">
              <input
                id="reserve-from"
                className="admin-input"
                type="date"
                value={dialog.from}
                onChange={(e) => setDialog({ ...dialog, from: e.target.value })}
              />
            </Field>
            <Field id="reserve-to" label="To">
              <input
                id="reserve-to"
                className="admin-input"
                type="date"
                value={dialog.to}
                onChange={(e) => setDialog({ ...dialog, to: e.target.value })}
              />
            </Field>
            {message ? (
              <p className="admin-field__error admin-form-grid__full" role="alert">
                {message}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <ToastBanner message={toast.message} />
    </div>
  );
}

/* ---- Offered items ---------------------------------------------------------------------------- */

type OfferKey = "offer" | "status";
const offerSort = (r: ContributionRow, key: OfferKey): string =>
  key === "offer" ? r.name.toLowerCase() : r.status;

export function OffersTab(props: { flows: FlowsData; header: TabHeader }) {
  const { flows } = props;
  const { run, toast, message, setMessage, busy } = useRunner();
  const [adding, setAdding] = useState<{ id: string; owner: string } | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; note: string } | null>(null);
  const list = useTabList(
    flows.contributions,
    (r, q) => [r.name, r.by].some((v) => v.toLowerCase().includes(q)),
    offerSort,
    (r, key: OfferKey) => (key === "offer" ? r.name : r.status),
  );
  const { table } = list;

  const columns: Column<ContributionRow>[] = [
    {
      key: "offer",
      header: table.header("offer", "Offer"),
      render: (r) => (
        <>
          <span className="admin-table__title">
            {r.quantity} × {r.name}
          </span>
          <span className="admin-table__sub">
            {r.by} · {r.mode === "give" ? "gift" : `lent until ${r.returnOn ?? "?"}`}
            {r.description ? ` · ${r.description}` : ""}
          </span>
        </>
      ),
    },
    {
      key: "status",
      header: table.header("status", "Status"),
      render: (r) => (
        <>
          <Badge tone={TONE[r.status] ?? "neutral"}>{r.status}</Badge>
          {r.note ? <span className="admin-table__sub">{r.note}</span> : null}
        </>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      render: (r) =>
        flows.canApprove && r.status === "pending" ? (
          <div className="admin-table__actions">
            <Button
              variant="ghost"
              size="icon"
              icon="check"
              aria-label="Add to inventory"
              title="Add to inventory"
              onClick={() => {
                setMessage(null);
                setAdding({ id: r.id, owner: flows.owners[0]?.value ?? "region" });
              }}
            />
            <RowMenu>
              <MenuItem
                icon="x"
                danger
                onClick={() => {
                  setMessage(null);
                  setRejecting({ id: r.id, note: "" });
                }}
              >
                Reject
              </MenuItem>
            </RowMenu>
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      {props.header(
        <>
          <SortMenu columns={columns} />
          <SearchBox
            key={list.searchKey}
            placeholder="Search by item or person..."
            label="Search offers"
            onSearch={list.search}
          />
        </>,
      )}
      <ListCard
        table={table}
        noun="offer"
        columns={columns}
        empty={
          <ListEmpty
            noun="offer"
            query={list.query}
            filters={table.filterCount}
            emptyHint="Members offer items to give or lend from the public Inventory page."
            onClear={list.clear}
          />
        }
      />
      <Modal
        asForm
        open={adding !== null}
        title="Add the Offered Item"
        subtitle="It becomes one new item of the owner you choose."
        onClose={() => setAdding(null)}
        footer={saveFooter(
          () => setAdding(null),
          () =>
            adding &&
            void run(
              approveContributionAction,
              { id: adding.id, owner: ownerInput(adding.owner) },
              "Added to the inventory",
            ).then((ok) => ok && setAdding(null)),
          busy,
        )}
      >
        {adding ? (
          <div className="admin-form-grid">
            <Field id="offer-owner" label="Owner" full>
              <Select
                id="offer-owner"
                value={adding.owner}
                onChange={(e) => setAdding({ ...adding, owner: e.target.value })}
              >
                {flows.owners.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            {message ? (
              <p className="admin-field__error admin-form-grid__full" role="alert">
                {message}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <ConfirmDialog
        open={rejecting !== null}
        title="Reject this offer?"
        confirmLabel="Reject"
        icon="x"
        pending={busy}
        onConfirm={() =>
          rejecting &&
          void run(rejectContributionAction, rejecting, "Rejected").then(
            (ok) => ok && setRejecting(null),
          )
        }
        onCancel={() => setRejecting(null)}
      >
        <p>The member sees the reason on the public Inventory page.</p>
        <label className="admin-field__label" htmlFor="offer-reason">
          Reason *
        </label>
        <textarea
          id="offer-reason"
          className="admin-input admin-textarea"
          rows={3}
          maxLength={300}
          value={rejecting?.note ?? ""}
          onChange={(e) => rejecting && setRejecting({ ...rejecting, note: e.target.value })}
        />
        <FieldError id="offer-reason-error" message={message ?? undefined} />
      </ConfirmDialog>
      <ToastBanner message={toast.message} />
    </div>
  );
}

/* ---- Purchase requests ------------------------------------------------------------------------- */

type PurchaseKey = "item" | "status";
const purchaseSort = (r: ProcurementRow, key: PurchaseKey): string =>
  key === "item" ? r.name.toLowerCase() : r.status;

export function PurchasesTab(props: { flows: FlowsData; header: TabHeader }) {
  const { flows } = props;
  const router = useRouter();
  const { run, toast, message, setMessage, busy } = useRunner();
  const [dialog, setDialog] = useState<{
    owner: string;
    name: string;
    why: string;
    amount: string;
    currency: string;
    urgency: string;
  } | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; note: string } | null>(null);
  const list = useTabList(
    flows.procurement,
    (r, q) => [r.name, r.owner, r.why].some((v) => v.toLowerCase().includes(q)),
    purchaseSort,
    (r, key: PurchaseKey) => (key === "item" ? r.name : r.status),
  );
  const { table } = list;
  const canAdd = flows.owners.length > 0;
  const open = () => {
    setMessage(null);
    setDialog({
      owner: flows.owners[0]?.value ?? "region",
      name: "",
      why: "",
      amount: "",
      currency: "IDR",
      urgency: "normal",
    });
  };

  const save = () => {
    if (!dialog) return;
    const estimatedMinor = dialog.amount.trim() ? toMinor(dialog.amount, dialog.currency) : 0;
    if (estimatedMinor === null) return setMessage("Type the estimate as a number, e.g. 1500000.");
    void run(
      requestProcurementAction,
      {
        owner: ownerInput(dialog.owner),
        name: dialog.name,
        category: "",
        why: dialog.why,
        estimatedMinor,
        currency: dialog.currency,
        urgency: dialog.urgency,
      },
      "Request sent",
    ).then((ok) => ok && setDialog(null));
  };

  const columns: Column<ProcurementRow>[] = [
    {
      key: "item",
      header: table.header("item", "Item"),
      render: (r) => (
        <>
          <span className="admin-table__title">{r.name}</span>
          <span className="admin-table__sub">
            {r.owner} · {r.estimate} · {r.urgency} · {r.why}
          </span>
        </>
      ),
    },
    {
      key: "status",
      header: table.header("status", "Status"),
      render: (r) => (
        <>
          <Badge tone={TONE[r.status] ?? "neutral"}>{r.status}</Badge>
          {r.note ? <span className="admin-table__sub">{r.note}</span> : null}
        </>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      render: (r) =>
        r.canDecide && (r.status === "pending" || r.status === "approved") ? (
          <div className="admin-table__actions">
            <Button
              variant="ghost"
              size="icon"
              icon="check"
              aria-label={r.status === "pending" ? "Approve" : "Mark as bought"}
              title={r.status === "pending" ? "Approve" : "Mark as bought"}
              onClick={() =>
                void run(
                  decideProcurementAction,
                  { id: r.id, step: r.status === "pending" ? "approve" : "fulfil", note: "" },
                  r.status === "pending" ? "Approved" : "Recorded",
                  false,
                )
              }
            />
            <RowMenu>
              {r.status === "approved" ? (
                <MenuItem icon="external" onClick={() => router.push(`/finance?${r.financeQuery}`)}>
                  Ask<span className="admin-long"> Finance</span>
                </MenuItem>
              ) : (
                <MenuItem
                  icon="x"
                  danger
                  onClick={() => {
                    setMessage(null);
                    setRejecting({ id: r.id, note: "" });
                  }}
                >
                  Reject
                </MenuItem>
              )}
            </RowMenu>
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      {props.header(
        <>
          {canAdd ? (
            <div className="admin-fab">
              <Button variant="primary" size="sm" icon="plus" onClick={open}>
                Ask to Buy
              </Button>
            </div>
          ) : null}
          <SortMenu columns={columns} />
          <SearchBox
            key={list.searchKey}
            placeholder="Search by item..."
            label="Search purchase requests"
            onSearch={list.search}
          />
        </>,
      )}
      <ListCard
        table={table}
        noun="request"
        columns={columns}
        empty={
          <ListEmpty
            noun="request"
            query={list.query}
            filters={table.filterCount}
            emptyHint="Ask to buy an item the organisation needs."
            onClear={list.clear}
            addLabel="Ask to Buy"
            onAdd={canAdd ? open : null}
          />
        }
      />
      <Modal
        asForm
        open={dialog !== null}
        title="Ask to Buy an Item"
        subtitle="Buying happens outside the platform; an approved request opens a Finance request."
        onClose={() => setDialog(null)}
        footer={saveFooter(() => setDialog(null), save, busy)}
      >
        {dialog ? (
          <div className="admin-form-grid">
            <Field id="purchase-owner" label="Owner" full>
              <Select
                id="purchase-owner"
                value={dialog.owner}
                onChange={(e) => setDialog({ ...dialog, owner: e.target.value })}
              >
                {flows.owners.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="purchase-name" label="Item *" full>
              <input
                id="purchase-name"
                className="admin-input"
                required
                minLength={2}
                maxLength={120}
                value={dialog.name}
                onChange={(e) => setDialog({ ...dialog, name: e.target.value })}
              />
            </Field>
            <Field id="purchase-why" label="Why it is needed *" full>
              <textarea
                id="purchase-why"
                className="admin-input admin-textarea"
                rows={3}
                required
                minLength={3}
                maxLength={500}
                value={dialog.why}
                onChange={(e) => setDialog({ ...dialog, why: e.target.value })}
              />
            </Field>
            <Field id="purchase-amount" label="Estimate">
              <input
                id="purchase-amount"
                className="admin-input"
                inputMode="decimal"
                value={dialog.amount}
                onChange={(e) => setDialog({ ...dialog, amount: e.target.value })}
              />
            </Field>
            <Field id="purchase-currency" label="Currency">
              <Select
                id="purchase-currency"
                value={dialog.currency}
                onChange={(e) => setDialog({ ...dialog, currency: e.target.value })}
              >
                {FINANCE_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="purchase-urgency" label="Urgency">
              <Select
                id="purchase-urgency"
                value={dialog.urgency}
                onChange={(e) => setDialog({ ...dialog, urgency: e.target.value })}
              >
                {URGENCIES.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </Field>
            {message ? (
              <p className="admin-field__error admin-form-grid__full" role="alert">
                {message}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <ConfirmDialog
        open={rejecting !== null}
        title="Reject this request?"
        confirmLabel="Reject"
        icon="x"
        pending={busy}
        onConfirm={() =>
          rejecting &&
          void run(
            decideProcurementAction,
            { id: rejecting.id, step: "reject", note: rejecting.note },
            "Rejected",
          ).then((ok) => ok && setRejecting(null))
        }
        onCancel={() => setRejecting(null)}
      >
        <p>The person who asked sees the reason.</p>
        <label className="admin-field__label" htmlFor="purchase-reason">
          Reason *
        </label>
        <textarea
          id="purchase-reason"
          className="admin-input admin-textarea"
          rows={3}
          maxLength={300}
          value={rejecting?.note ?? ""}
          onChange={(e) => rejecting && setRejecting({ ...rejecting, note: e.target.value })}
        />
        <FieldError id="purchase-reason-error" message={message ?? undefined} />
      </ConfirmDialog>
      <ToastBanner message={toast.message} />
    </div>
  );
}

/* ---- Loans to outside bodies ------------------------------------------------------------------- */

type OutsideKey = "loan" | "status";
const outsideSort = (r: OutsideRow, key: OutsideKey): string =>
  key === "loan" ? r.item.toLowerCase() : r.overdue ? "Overdue" : r.status;

export function OutsideTab(props: { flows: FlowsData; header: TabHeader }) {
  const { flows } = props;
  const { run, toast, message, setMessage, busy } = useRunner();
  const [lending, setLending] = useState<{
    itemId: string;
    borrower: string;
    contact: string;
    purpose: string;
    quantity: string;
    conditionOut: string;
    expectedBack: string;
  } | null>(null);
  const [taking, setTaking] = useState<{ id: string; conditionIn: string } | null>(null);
  const approvable = flows.items.filter((i) => i.canApprove);
  const list = useTabList(
    flows.outside,
    (r, q) => [r.item, r.borrower, r.contact].some((v) => v.toLowerCase().includes(q)),
    outsideSort,
    (r, key: OutsideKey) => (key === "loan" ? r.item : r.overdue ? "Overdue" : r.status),
  );
  const { table } = list;
  const open = () => {
    setMessage(null);
    setLending({
      itemId: approvable[0]?.id ?? "",
      borrower: "",
      contact: "",
      purpose: "",
      quantity: "1",
      conditionOut: "",
      expectedBack: today(),
    });
  };

  const columns: Column<OutsideRow>[] = [
    {
      key: "loan",
      header: table.header("loan", "Loan"),
      render: (r) => (
        <>
          <span className="admin-table__title">
            {r.quantity} × {r.item} → {r.borrower}
          </span>
          <span className="admin-table__sub">
            {r.contact} · {r.period} · {r.purpose}
          </span>
        </>
      ),
    },
    {
      key: "status",
      header: table.header("status", "Status"),
      render: (r) =>
        r.overdue ? (
          <Badge tone="danger">Overdue</Badge>
        ) : (
          <Badge tone={TONE[r.status] ?? "neutral"}>{r.status}</Badge>
        ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      render: (r) =>
        r.status === "out" && r.canDecide ? (
          <div className="admin-table__actions">
            <Button
              variant="ghost"
              size="icon"
              icon="undo"
              aria-label="Take back"
              title="Take back"
              onClick={() => {
                setMessage(null);
                setTaking({ id: r.id, conditionIn: "" });
              }}
            />
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      {props.header(
        <>
          {approvable.length > 0 ? (
            <div className="admin-fab">
              <Button variant="primary" size="sm" icon="plus" onClick={open}>
                Lend Item
              </Button>
            </div>
          ) : null}
          <SortMenu columns={columns} />
          <SearchBox
            key={list.searchKey}
            placeholder="Search by item or borrower..."
            label="Search outside loans"
            onSearch={list.search}
          />
        </>,
      )}
      <ListCard
        table={table}
        noun="loan"
        columns={columns}
        empty={
          <ListEmpty
            noun="loan"
            query={list.query}
            filters={table.filterCount}
            emptyHint="Lend an item to another organisation."
            onClear={list.clear}
            addLabel="Lend Item"
            onAdd={approvable.length > 0 ? open : null}
          />
        }
      />
      <Modal
        asForm
        open={lending !== null}
        title="Lend to an Outside Body"
        onClose={() => setLending(null)}
        footer={saveFooter(
          () => setLending(null),
          () =>
            lending &&
            void run(
              lendOutAction,
              { ...lending, quantity: Number(lending.quantity) },
              "Lent out",
            ).then((ok) => ok && setLending(null)),
          busy,
        )}
      >
        {lending ? (
          <div className="admin-form-grid">
            <Field id="lend-item" label="Item" full>
              <Select
                id="lend-item"
                value={lending.itemId}
                onChange={(e) => setLending({ ...lending, itemId: e.target.value })}
              >
                {approvable.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="lend-borrower" label="Borrower *" full>
              <input
                id="lend-borrower"
                className="admin-input"
                required
                minLength={2}
                maxLength={120}
                value={lending.borrower}
                onChange={(e) => setLending({ ...lending, borrower: e.target.value })}
              />
            </Field>
            <Field id="lend-contact" label="Contact *" full>
              <input
                id="lend-contact"
                className="admin-input"
                required
                minLength={3}
                maxLength={200}
                value={lending.contact}
                onChange={(e) => setLending({ ...lending, contact: e.target.value })}
              />
            </Field>
            <Field id="lend-purpose" label="Purpose *" full>
              <input
                id="lend-purpose"
                className="admin-input"
                required
                minLength={3}
                maxLength={300}
                value={lending.purpose}
                onChange={(e) => setLending({ ...lending, purpose: e.target.value })}
              />
            </Field>
            <Field id="lend-quantity" label="Quantity">
              <input
                id="lend-quantity"
                className="admin-input"
                type="number"
                min={1}
                value={lending.quantity}
                onChange={(e) => setLending({ ...lending, quantity: e.target.value })}
              />
            </Field>
            <Field id="lend-back" label="Back by">
              <input
                id="lend-back"
                className="admin-input"
                type="date"
                value={lending.expectedBack}
                onChange={(e) => setLending({ ...lending, expectedBack: e.target.value })}
              />
            </Field>
            <Field id="lend-condition" label="Condition now" full>
              <input
                id="lend-condition"
                className="admin-input"
                maxLength={120}
                value={lending.conditionOut}
                onChange={(e) => setLending({ ...lending, conditionOut: e.target.value })}
              />
            </Field>
            {message ? (
              <p className="admin-field__error admin-form-grid__full" role="alert">
                {message}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <Modal
        asForm
        open={taking !== null}
        title="Take the Item Back"
        onClose={() => setTaking(null)}
        footer={saveFooter(
          () => setTaking(null),
          () =>
            taking &&
            void run(takeBackOutsideAction, taking, "Taken back").then(
              (ok) => ok && setTaking(null),
            ),
          busy,
        )}
      >
        {taking ? (
          <div className="admin-form-grid">
            <Field id="back-condition" label="Condition now" full>
              <input
                id="back-condition"
                className="admin-input"
                maxLength={120}
                value={taking.conditionIn}
                onChange={(e) => setTaking({ ...taking, conditionIn: e.target.value })}
              />
            </Field>
            {message ? (
              <p className="admin-field__error admin-form-grid__full" role="alert">
                {message}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <ToastBanner message={toast.message} />
    </div>
  );
}
