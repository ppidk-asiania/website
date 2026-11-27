"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FeaturedImage } from "@website/domain/content";
import { ITEM_CONDITIONS, type ItemCondition, type LoanState } from "@website/domain/inventory";
import {
  approveLoanAction,
  createItemAction,
  deleteItemAction,
  handOverLoanAction,
  rejectLoanAction,
  setItemTotalAction,
  takeBackLoanAction,
  updateItemAction,
} from "@/app/(panel)/inventory/actions";
import { actionMessage, type ActionFailure } from "@/components/action-message";
import { publicImage, useImageUpload } from "@/components/image-upload";
import {
  OffersTab,
  ownerInput,
  OutsideTab,
  PurchasesTab,
  ReservationsTab,
  useTabList,
  type FlowsData,
  type TabHeader,
} from "@/components/inventory-flows-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Column } from "@/components/ui/data-table";
import {
  ListCard,
  ListEmpty,
  MenuItem,
  RowMenu,
  SearchBox,
  SortMenu,
  Tabs,
} from "@/components/ui/list-controls";
import { Modal } from "@/components/ui/modal";
import { PhotoDrop } from "@/components/ui/photo-drop";
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { UploadBar } from "@/components/ui/upload-bar";

export interface ItemRow {
  id: string;
  version: number;
  owner: string;
  name: string;
  category: string;
  description: string;
  image: FeaturedImage | null;
  total: number;
  available: number;
  condition: ItemCondition;
  location: string;
  custodianName: string;
  published: boolean;
  lentBy: string | null;
  canEdit: boolean;
}

export interface LoanRow {
  id: string;
  item: string;
  quantity: number;
  borrower: string;
  own: boolean;
  outsider: boolean;
  purpose: string;
  place: string;
  period: string;
  status: LoanState;
  overdue: boolean;
  note: string | null;
  canDecide: boolean;
}

const LOAN_LABELS: Record<LoanState, string> = {
  pending: "Waiting",
  approved: "Approved",
  rejected: "Rejected",
  handed_over: "Out",
  return_asked: "Return asked",
  returned: "Returned",
  cancelled: "Cancelled",
};

export interface LogRow {
  id: string;
  item: string;
  action: string;
  change: number;
  note: string | null;
  by: string;
  at: string;
}

const CONDITION_LABELS: Record<ItemCondition, string> = {
  good: "Good",
  damaged: "Damaged",
  retired: "Retired",
};

type Form = {
  owner: string;
  name: string;
  category: string;
  description: string;
  image: FeaturedImage | null;
  condition: ItemCondition;
  location: string;
  custodianName: string;
  published: boolean;
  total: string;
};

const emptyForm = (owner: string): Form => ({
  owner,
  name: "",
  category: "",
  description: "",
  image: null,
  condition: "good",
  location: "",
  custodianName: "",
  published: true,
  total: "1",
});

type View = "items" | "requests" | "reservations" | "offers" | "purchases" | "outside" | "log";

/** Items of the organisation with their stock, how they are lent and the log of every change (N7). */
export function InventoryPage(props: {
  rows: ItemRow[];
  owners: { value: string; label: string }[];
  loans: LoanRow[];
  log: LogRow[];
  flows: FlowsData;
}) {
  const [view, setView] = useState<View>("items");
  const { flows } = props;

  const header: TabHeader = (actions) => (
    <>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Inventory</h1>
          <p className="admin-page-header__desc">
            Equipment the region, a chapter or a unit owns. Published items appear on the public
            catalogue with the number available; retired items leave it and keep their history.
          </p>
        </div>
        <div className="admin-page-header__actions">{actions}</div>
      </div>
      <Tabs
        label="Inventory lists"
        tabs={[
          { key: "items", label: "Items", count: props.rows.length },
          { key: "requests", label: "Requests", count: props.loans.length },
          { key: "reservations", label: "Reservations", count: flows.reservations.length },
          { key: "offers", label: "Offers", count: flows.contributions.length },
          { key: "purchases", label: "Purchases", count: flows.procurement.length },
          { key: "outside", label: "Outside loans", count: flows.outside.length },
          { key: "log", label: "Log", count: props.log.length },
        ]}
        active={view}
        onSelect={setView}
      />
    </>
  );

  return view === "items" ? (
    <ItemsTab rows={props.rows} owners={props.owners} header={header} />
  ) : view === "requests" ? (
    <RequestsTab loans={props.loans} header={header} />
  ) : view === "reservations" ? (
    <ReservationsTab flows={flows} header={header} />
  ) : view === "offers" ? (
    <OffersTab flows={flows} header={header} />
  ) : view === "purchases" ? (
    <PurchasesTab flows={flows} header={header} />
  ) : view === "outside" ? (
    <OutsideTab flows={flows} header={header} />
  ) : (
    <LogTab log={props.log} header={header} />
  );
}

type ItemKey = "name" | "stock" | "condition" | "catalogue";
const itemSort = (r: ItemRow, key: ItemKey): string | number =>
  key === "name"
    ? r.name.toLowerCase()
    : key === "stock"
      ? r.available
      : key === "condition"
        ? r.condition
        : String(r.published);
const itemText = (r: ItemRow, key: ItemKey): string =>
  key === "name"
    ? r.name
    : key === "stock"
      ? `${r.available} of ${r.total}`
      : key === "condition"
        ? CONDITION_LABELS[r.condition]
        : r.published
          ? "Public"
          : "Private";

function ItemsTab(props: {
  rows: ItemRow[];
  owners: { value: string; label: string }[];
  header: TabHeader;
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const upload = useImageUpload("banner");
  const [editing, setEditing] = useState<ItemRow | "new" | null>(null);
  const [form, setForm] = useState<Form>(emptyForm(props.owners[0]?.value ?? "region"));
  const [stock, setStock] = useState<{ row: ItemRow; total: string; note: string } | null>(null);
  const [deleting, setDeleting] = useState<ItemRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const list = useTabList(
    props.rows,
    (r, q) => [r.name, r.category, r.location].some((v) => v.toLowerCase().includes(q)),
    itemSort,
    itemText,
  );
  const { table } = list;

  const open = (row: ItemRow | "new") => {
    setForm(
      row === "new"
        ? emptyForm(props.owners[0]?.value ?? "region")
        : { ...row, owner: "", total: String(row.total) },
    );
    setMessage(null);
    setEditing(row);
  };

  const finish = (text: string) => {
    setEditing(null);
    setStock(null);
    router.refresh();
    toast.show(text);
  };

  const save = async () => {
    if (editing === null) return;
    setBusy(true);
    const details = {
      name: form.name,
      category: form.category,
      description: form.description,
      image: form.image,
      condition: form.condition,
      location: form.location,
      custodianUserId: null,
      custodianName: form.custodianName,
      published: form.published,
    };
    const result =
      editing === "new"
        ? await createItemAction({
            ...details,
            owner: ownerInput(form.owner),
            total: Number(form.total),
          })
        : await updateItemAction({ ...details, id: editing.id, version: editing.version });
    setBusy(false);
    if (!result.ok) return setMessage(actionMessage(result));
    finish("Item saved");
  };

  const saveStock = async () => {
    if (!stock) return;
    setBusy(true);
    const result = await setItemTotalAction({
      id: stock.row.id,
      version: stock.row.version,
      total: Number(stock.total),
      note: stock.note,
    });
    setBusy(false);
    if (!result.ok) return setMessage(actionMessage(result));
    finish("Stock changed");
  };

  const remove = async () => {
    if (!deleting) return;
    const result = await deleteItemAction({ id: deleting.id, version: deleting.version });
    setDeleting(null);
    if (!result.ok) return toast.show(actionMessage(result));
    router.refresh();
    toast.show("Item deleted");
  };

  const columns: Column<ItemRow>[] = [
    {
      key: "name",
      header: table.header("name", "Item"),
      render: (row) => (
        <>
          <span className="admin-table__title">{row.name}</span>
          <span className="admin-table__sub">
            {row.owner}
            {row.category ? ` · ${row.category}` : ""}
            {row.location ? ` · ${row.location}` : ""}
            {row.lentBy ? ` · lent by ${row.lentBy}` : ""}
          </span>
        </>
      ),
    },
    {
      key: "stock",
      header: table.header("stock", "Available"),
      render: (row) => `${row.available} of ${row.total}`,
    },
    {
      key: "condition",
      header: table.header("condition", "Condition"),
      render: (row) => (
        <Badge
          tone={
            row.condition === "good" ? "success" : row.condition === "damaged" ? "warn" : "neutral"
          }
        >
          {CONDITION_LABELS[row.condition]}
        </Badge>
      ),
    },
    {
      key: "catalogue",
      header: table.header("catalogue", "Catalogue"),
      render: (row) => (
        <Badge tone={row.published ? "success" : "neutral"}>
          {row.published ? "Public" : "Private"}
        </Badge>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      render: (row) =>
        row.canEdit ? (
          <div className="admin-table__actions">
            <Button
              variant="ghost"
              size="icon"
              icon="edit"
              aria-label="Edit"
              title="Edit"
              onClick={() => open(row)}
            />
            <RowMenu>
              <MenuItem
                icon="chart"
                onClick={() => {
                  setMessage(null);
                  setStock({ row, total: String(row.total), note: "" });
                }}
              >
                Stock
              </MenuItem>
              <MenuItem icon="trash" danger onClick={() => setDeleting(row)}>
                Delete<span className="admin-long"> Item</span>
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
          {props.owners.length > 0 ? (
            <div className="admin-fab">
              <Button variant="primary" size="sm" icon="plus" onClick={() => open("new")}>
                Add Item
              </Button>
            </div>
          ) : null}
          <SortMenu columns={columns} />
          <SearchBox
            key={list.searchKey}
            placeholder="Search by name..."
            label="Search items"
            onSearch={list.search}
          />
        </>,
      )}
      <ListCard
        table={table}
        noun="item"
        columns={columns}
        empty={
          <ListEmpty
            noun="item"
            query={list.query}
            filters={table.filterCount}
            emptyHint="Add the first item."
            onClear={list.clear}
            addLabel="Add Item"
            onAdd={props.owners.length > 0 ? () => open("new") : null}
          />
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete Item?"
        confirmLabel="Delete Item"
        icon="trash"
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      >
        {deleting?.name} leaves the inventory and the public catalogue. An item that is lent out
        cannot be deleted.
      </ConfirmDialog>

      <Modal
        asForm
        open={editing !== null}
        title={editing === "new" ? "Add item" : "Edit item"}
        onClose={() => setEditing(null)}
        footer={
          <div className="admin-modal__footer-row">
            <Button variant="outline" icon="chevronLeft" onClick={() => setEditing(null)}>
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              icon="cloud"
              disabled={busy || upload.busy}
              onClick={() => void save()}
            >
              Save
            </Button>
          </div>
        }
      >
        <div className="admin-form-grid">
          {editing === "new" ? (
            <>
              <div className="admin-field">
                <label className="admin-field__label" htmlFor="item-owner">
                  Owner
                </label>
                <Select
                  id="item-owner"
                  value={form.owner}
                  onChange={(e) => setForm({ ...form, owner: e.target.value })}
                >
                  {props.owners.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="admin-field">
                <label className="admin-field__label" htmlFor="item-total">
                  How many
                </label>
                <input
                  id="item-total"
                  className="admin-input"
                  type="number"
                  min={0}
                  value={form.total}
                  onChange={(e) => setForm({ ...form, total: e.target.value })}
                />
              </div>
            </>
          ) : null}
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="item-name">
              Name *
            </label>
            <input
              id="item-name"
              className="admin-input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="item-category">
              Category
            </label>
            <input
              id="item-category"
              className="admin-input"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="item-location">
              Where it is kept
            </label>
            <input
              id="item-location"
              className="admin-input"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="item-custodian">
              Kept by
            </label>
            <input
              id="item-custodian"
              className="admin-input"
              value={form.custodianName}
              onChange={(e) => setForm({ ...form, custodianName: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="item-condition">
              Condition
            </label>
            <Select
              id="item-condition"
              value={form.condition}
              onChange={(e) => setForm({ ...form, condition: e.target.value as ItemCondition })}
            >
              {ITEM_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABELS[c]}
                </option>
              ))}
            </Select>
          </div>
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="item-description">
              Description
            </label>
            <textarea
              id="item-description"
              className="admin-input"
              rows={3}
              maxLength={1000}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="item-status">
              Catalogue
            </label>
            <Select
              id="item-status"
              value={form.published ? "public" : "private"}
              onChange={(e) => setForm({ ...form, published: e.target.value === "public" })}
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
            </Select>
          </div>
          <div className="admin-form-grid__full">
            <PhotoDrop
              value={form.image?.thumbUrl ?? null}
              label="Photo"
              onFile={(file) =>
                void upload.upload(file).then((image) => {
                  const next = image ? publicImage(image) : null;
                  if (next) setForm((f) => ({ ...f, image: next }));
                })
              }
              onClear={() => setForm({ ...form, image: null })}
            />
            <UploadBar upload={upload} />
          </div>
          {(message ?? upload.error) ? (
            <p className="admin-field__error admin-form-grid__full" role="alert">
              {message ?? upload.error}
            </p>
          ) : null}
        </div>
      </Modal>

      <Modal
        asForm
        open={stock !== null}
        title={stock ? `Stock of ${stock.row.name}` : "Stock"}
        onClose={() => setStock(null)}
        footer={
          <div className="admin-modal__footer-row">
            <Button variant="outline" icon="chevronLeft" onClick={() => setStock(null)}>
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy}
              onClick={() => void saveStock()}
            >
              Save
            </Button>
          </div>
        }
      >
        {stock ? (
          <div className="admin-form-grid">
            <p className="admin-form-grid__full">
              {stock.row.total - stock.row.available} out on loan; they stay out when the total
              changes.
            </p>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="stock-total">
                New total
              </label>
              <input
                id="stock-total"
                className="admin-input"
                type="number"
                min={0}
                value={stock.total}
                onChange={(e) => setStock({ ...stock, total: e.target.value })}
              />
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="stock-note">
                Why
              </label>
              <input
                id="stock-note"
                className="admin-input"
                maxLength={200}
                value={stock.note}
                onChange={(e) => setStock({ ...stock, note: e.target.value })}
              />
            </div>
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

type RequestKey = "request" | "status";
const requestSort = (r: LoanRow, key: RequestKey): string =>
  key === "request" ? r.item.toLowerCase() : r.overdue ? "Overdue" : LOAN_LABELS[r.status];

function RequestsTab(props: { loans: LoanRow[]; header: TabHeader }) {
  const router = useRouter();
  const toast = useToastMessage();
  // The one dialog of a request step that needs a text: a reason, or the condition on return.
  const [step, setStep] = useState<{
    loan: LoanRow;
    kind: "reject" | "return";
    note: string;
    condition: "good" | "damaged";
  } | null>(null);
  const list = useTabList(
    props.loans,
    (r, q) => [r.item, r.borrower, r.purpose].some((v) => v.toLowerCase().includes(q)),
    requestSort,
  );
  const { table } = list;

  const run = async (
    action: (input: unknown) => Promise<{ ok: true } | ActionFailure>,
    input: unknown,
    done: string,
  ) => {
    const result = await action(input);
    if (!result.ok) return toast.show(actionMessage(result));
    setStep(null);
    router.refresh();
    toast.show(done);
  };

  const columns: Column<LoanRow>[] = [
    {
      key: "request",
      header: table.header("request", "Request"),
      render: (row) => (
        <>
          <span className="admin-table__title">
            {row.quantity} × {row.item}
          </span>
          <span className="admin-table__sub">
            {row.borrower} · {row.period} · {row.place}
          </span>
          <span className="admin-table__sub">{row.purpose}</span>
          {row.note ? <span className="admin-table__sub">Note: {row.note}</span> : null}
        </>
      ),
    },
    {
      key: "status",
      header: table.header("status", "Status"),
      render: (row) => (
        <Badge
          tone={
            row.overdue
              ? "danger"
              : row.status === "pending" || row.status === "return_asked"
                ? "warn"
                : row.status === "handed_over" || row.status === "approved"
                  ? "primary"
                  : row.status === "returned"
                    ? "success"
                    : "neutral"
          }
        >
          {row.overdue ? "Overdue" : LOAN_LABELS[row.status]}
        </Badge>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      render: (row) => {
        const waiting = row.canDecide && !row.own && row.status === "pending";
        const out =
          row.canDecide && (row.status === "handed_over" || row.status === "return_asked");
        return (
          <div className="admin-table__actions">
            {waiting ? (
              <Button
                variant="ghost"
                size="icon"
                icon="check"
                aria-label="Approve"
                title="Approve"
                onClick={() => void run(approveLoanAction, { id: row.id }, "Approved")}
              />
            ) : null}
            {row.canDecide && row.status === "approved" ? (
              <Button
                variant="ghost"
                size="icon"
                icon="send"
                aria-label="Hand over"
                title="Hand over"
                onClick={() => void run(handOverLoanAction, { id: row.id }, "Handed over")}
              />
            ) : null}
            {out ? (
              <Button
                variant="ghost"
                size="icon"
                icon="undo"
                aria-label="Take back"
                title="Take back"
                onClick={() => setStep({ loan: row, kind: "return", note: "", condition: "good" })}
              />
            ) : null}
            <RowMenu>
              {row.outsider ? (
                <MenuItem
                  icon="eye"
                  onClick={() => window.open(`/api/loan-statements/${row.id}`, "_blank")}
                >
                  Statement
                </MenuItem>
              ) : null}
              {waiting ? (
                <MenuItem
                  icon="x"
                  danger
                  onClick={() =>
                    setStep({ loan: row, kind: "reject", note: "", condition: "good" })
                  }
                >
                  Reject
                </MenuItem>
              ) : null}
            </RowMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      {props.header(
        <>
          <SortMenu columns={columns} />
          <SearchBox
            key={list.searchKey}
            placeholder="Search requests..."
            label="Search requests"
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
            emptyHint="Requests to borrow an item appear here."
            onClear={list.clear}
          />
        }
      />
      <Modal
        asForm
        open={step !== null}
        title={step?.kind === "reject" ? "Reject request" : "Take the item back"}
        onClose={() => setStep(null)}
        footer={
          <div className="admin-modal__footer-row">
            <Button variant="outline" icon="chevronLeft" onClick={() => setStep(null)}>
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              onClick={() =>
                step &&
                void run(
                  step.kind === "reject" ? rejectLoanAction : takeBackLoanAction,
                  step.kind === "reject"
                    ? { id: step.loan.id, note: step.note }
                    : { id: step.loan.id, condition: step.condition, note: step.note },
                  step.kind === "reject" ? "Rejected" : "Taken back",
                )
              }
            >
              Save
            </Button>
          </div>
        }
      >
        {step ? (
          <div className="admin-form-grid">
            {step.kind === "return" ? (
              <div className="admin-field">
                <label className="admin-field__label" htmlFor="return-condition">
                  Condition
                </label>
                <Select
                  id="return-condition"
                  value={step.condition}
                  onChange={(e) =>
                    setStep({ ...step, condition: e.target.value as "good" | "damaged" })
                  }
                >
                  <option value="good">Good</option>
                  <option value="damaged">Damaged</option>
                </Select>
              </div>
            ) : null}
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="step-note">
                {step.kind === "reject" ? "Reason *" : "Note"}
              </label>
              <input
                id="step-note"
                className="admin-input"
                maxLength={300}
                value={step.note}
                onChange={(e) => setStep({ ...step, note: e.target.value })}
              />
            </div>
          </div>
        ) : null}
      </Modal>
      <ToastBanner message={toast.message} />
    </div>
  );
}

type LogKey = "item" | "by" | "when";
const logSort = (r: LogRow, key: LogKey): string =>
  key === "item" ? r.item.toLowerCase() : key === "by" ? r.by : r.at;

function LogTab(props: { log: LogRow[]; header: TabHeader }) {
  const list = useTabList(
    props.log,
    (r, q) => [r.item, r.by, r.action].some((v) => v.toLowerCase().includes(q)),
    logSort,
    (r, key: LogKey) => (key === "item" ? r.item : key === "by" ? r.by : r.at.slice(0, 10)),
  );
  const { table } = list;
  const columns: Column<LogRow>[] = [
    {
      key: "item",
      header: table.header("item", "Item"),
      render: (row) => (
        <>
          <span className="admin-table__title">{row.item}</span>
          <span className="admin-table__sub">
            {row.action.replace("_", " ")}
            {row.change !== 0 ? ` (${row.change > 0 ? "+" : ""}${row.change})` : ""}
            {row.note ? ` · ${row.note}` : ""}
          </span>
        </>
      ),
    },
    { key: "by", header: table.header("by", "By"), render: (row) => row.by },
    { key: "when", header: table.header("when", "When"), render: (row) => row.at },
  ];
  return (
    <div>
      {props.header(
        <>
          <SortMenu columns={columns} />
          <SearchBox
            key={list.searchKey}
            placeholder="Search the log..."
            label="Search the log"
            onSearch={list.search}
          />
        </>,
      )}
      <ListCard
        table={table}
        noun="entry"
        columns={columns}
        empty={
          <ListEmpty
            noun="entry"
            query={list.query}
            filters={table.filterCount}
            emptyHint="Every stock change and loan step is logged here."
            onClear={list.clear}
          />
        }
      />
    </div>
  );
}
