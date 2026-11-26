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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
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

const ownerInput = (value: string) => {
  const [kind, id] = value.split(":");
  return kind === "chapter"
    ? { kind: "chapter" as const, chapterId: id ?? "" }
    : kind === "unit"
      ? { kind: "unit" as const, orgUnitId: id ?? "" }
      : { kind: "region" as const };
};

/** Items of the organisation with their stock, and the log of every change (N7.1). */
export function InventoryPage(props: {
  rows: ItemRow[];
  owners: { value: string; label: string }[];
  loans: LoanRow[];
  log: LogRow[];
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const upload = useImageUpload("banner");
  const [editing, setEditing] = useState<ItemRow | "new" | null>(null);
  const [form, setForm] = useState<Form>(emptyForm(props.owners[0]?.value ?? "region"));
  const [stock, setStock] = useState<{ row: ItemRow; total: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // The one dialog of a request step that needs a text: a reason, or the condition on return.
  const [step, setStep] = useState<{
    loan: LoanRow;
    kind: "reject" | "return";
    note: string;
    condition: "good" | "damaged";
  } | null>(null);

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

  const remove = async (row: ItemRow) => {
    const result = await deleteItemAction({ id: row.id, version: row.version });
    if (!result.ok) return toast.show(actionMessage(result));
    router.refresh();
    toast.show("Item deleted");
  };

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

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Inventory</h1>
          <p className="admin-page-header__desc">
            Equipment the region, a chapter or a unit owns. Published items appear on the public
            catalogue with the number available; retired items leave it and keep their history.
          </p>
        </div>
      </div>
      <Card className="admin-list-card">
        <CardBody flush>
          <DataTable
            rowKey={(row) => row.id}
            rows={props.rows}
            emptyText="No items yet"
            columns={[
              {
                key: "name",
                header: "Item",
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
                header: "Available",
                render: (row) => `${row.available} of ${row.total}`,
              },
              {
                key: "condition",
                header: "Condition",
                render: (row) => (
                  <Badge
                    tone={
                      row.condition === "good"
                        ? "success"
                        : row.condition === "damaged"
                          ? "warn"
                          : "neutral"
                    }
                  >
                    {CONDITION_LABELS[row.condition]}
                  </Badge>
                ),
              },
              {
                key: "published",
                header: "Catalogue",
                render: (row) => (
                  <Badge tone={row.published ? "success" : "neutral"}>
                    {row.published ? "Public" : "Private"}
                  </Badge>
                ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (row) =>
                  row.canEdit ? (
                    <div className="admin-table__actions">
                      <Button size="sm" variant="outline" icon="edit" onClick={() => open(row)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setMessage(null);
                          setStock({ row, total: String(row.total), note: "" });
                        }}
                      >
                        Stock
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        icon="trash"
                        onClick={() => void remove(row)}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : null,
              },
            ]}
          />
        </CardBody>
      </Card>
      {props.owners.length > 0 ? (
        <Button variant="primary" icon="plus" onClick={() => open("new")}>
          Add item
        </Button>
      ) : null}

      <h2 className="admin-section-title">Requests</h2>
      <Card className="admin-list-card">
        <CardBody flush>
          <DataTable
            rowKey={(row) => row.id}
            rows={props.loans}
            emptyText="No borrowing requests"
            columns={[
              {
                key: "item",
                header: "Request",
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
                header: "Status",
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
                key: "actions",
                header: "",
                align: "right",
                render: (row) => (
                  <div className="admin-table__actions">
                    {row.outsider ? (
                      <a
                        className="admin-button admin-button--outline admin-button--sm"
                        href={`/api/loan-statements/${row.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Statement
                      </a>
                    ) : null}
                    {row.canDecide && !row.own && row.status === "pending" ? (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => void run(approveLoanAction, { id: row.id }, "Approved")}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setStep({ loan: row, kind: "reject", note: "", condition: "good" })
                          }
                        >
                          Reject
                        </Button>
                      </>
                    ) : null}
                    {row.canDecide && row.status === "approved" ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => void run(handOverLoanAction, { id: row.id }, "Handed over")}
                      >
                        Hand over
                      </Button>
                    ) : null}
                    {row.canDecide &&
                    (row.status === "handed_over" || row.status === "return_asked") ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() =>
                          setStep({ loan: row, kind: "return", note: "", condition: "good" })
                        }
                      >
                        Take back
                      </Button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        </CardBody>
      </Card>

      <h2 className="admin-section-title">Log</h2>
      <Card className="admin-list-card">
        <CardBody flush>
          <DataTable
            rowKey={(row) => row.id}
            rows={props.log}
            emptyText="Nothing logged yet"
            columns={[
              {
                key: "item",
                header: "Item",
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
              { key: "by", header: "By", render: (row) => row.by },
              { key: "at", header: "When", render: (row) => row.at },
            ]}
          />
        </CardBody>
      </Card>

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
