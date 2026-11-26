"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { FINANCE_CURRENCIES } from "@website/domain/finance";
import { URGENCIES } from "@website/domain/inventory";
import { toMinor, type CurrencyCode } from "@website/domain/shared";
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
import { ownerInput } from "@/components/inventory-page";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";

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

const TONE: Record<string, BadgeTone> = {
  pending: "warn",
  approved: "primary",
  rejected: "danger",
  fulfilled: "success",
  out: "primary",
  returned: "success",
};

type Result = { ok: true } | ActionFailure;

/** A dialog with a Back and a Save; every N7.3 form is one of these. */
function FormModal(props: {
  title: string;
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      asForm
      open
      title={props.title}
      onClose={props.onClose}
      footer={
        <div className="admin-modal__footer-row">
          <Button variant="outline" icon="chevronLeft" onClick={props.onClose}>
            Back
          </Button>
          <Button type="submit" variant="primary" onClick={props.onSave}>
            Save
          </Button>
        </div>
      }
    >
      <div className="admin-form-grid">{props.children}</div>
    </Modal>
  );
}

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

type Dialog =
  | { kind: "reserve"; itemId: string; eventId: string; quantity: string; from: string; to: string }
  | { kind: "approve-offer"; id: string; owner: string }
  | { kind: "reject-offer"; id: string; note: string }
  | { kind: "reject-purchase"; id: string; note: string }
  | {
      kind: "purchase";
      owner: string;
      name: string;
      category: string;
      why: string;
      amount: string;
      currency: CurrencyCode;
      urgency: string;
    }
  | {
      kind: "lend";
      itemId: string;
      borrower: string;
      contact: string;
      purpose: string;
      quantity: string;
      conditionOut: string;
      expectedBack: string;
    }
  | { kind: "take-back"; id: string; conditionIn: string };

/** Event reservations, offered items, purchase requests and loans to outside bodies (N7.3). */
export function InventoryFlowsPanel(props: {
  items: { id: string; name: string; canEdit: boolean; canApprove: boolean }[];
  owners: { value: string; label: string }[];
  events: { id: string; title: string }[];
  reservations: ReservationRow[];
  contributions: ContributionRow[];
  procurement: ProcurementRow[];
  outside: OutsideRow[];
  canApprove: boolean;
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (action: (input: unknown) => Promise<Result>, input: unknown, done: string) => {
    const result = await action(input);
    if (!result.ok) return setMessage(actionMessage(result));
    setDialog(null);
    setMessage(null);
    router.refresh();
    toast.show(done);
  };
  const show = (next: Dialog) => {
    setMessage(null);
    setDialog(next);
  };
  const editable = props.items.filter((i) => i.canEdit);
  const approvable = props.items.filter((i) => i.canApprove);
  const firstItem = (list: typeof editable) => list[0]?.id ?? "";
  const today = new Date().toISOString().slice(0, 10);
  const err = message ? (
    <p className="admin-field__error admin-form-grid__full" role="alert">
      {message}
    </p>
  ) : null;

  return (
    <div>
      <h2 className="admin-section-title">Event reservations</h2>
      <Card className="admin-list-card">
        <CardBody flush>
          <DataTable
            rowKey={(r) => r.id}
            rows={props.reservations}
            emptyText="No equipment is reserved for an event"
            columns={[
              {
                key: "item",
                header: "Reserved",
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
                header: "Status",
                render: (r) => (
                  <Badge tone={r.active ? "primary" : "neutral"}>
                    {r.active ? "Reserved" : "Released"}
                  </Badge>
                ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (r) =>
                  r.active && r.canEdit ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void run(releaseReservationAction, { id: r.id }, "Released")}
                    >
                      Release
                    </Button>
                  ) : null,
              },
            ]}
          />
        </CardBody>
      </Card>
      {editable.length > 0 && props.events.length > 0 ? (
        <Button
          variant="primary"
          icon="plus"
          onClick={() =>
            show({
              kind: "reserve",
              itemId: firstItem(editable),
              eventId: props.events[0]?.id ?? "",
              quantity: "1",
              from: today,
              to: today,
            })
          }
        >
          Reserve for an event
        </Button>
      ) : null}

      <h2 className="admin-section-title">Offered items</h2>
      <Card className="admin-list-card">
        <CardBody flush>
          <DataTable
            rowKey={(r) => r.id}
            rows={props.contributions}
            emptyText="Nobody has offered an item"
            columns={[
              {
                key: "name",
                header: "Offer",
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
                header: "Status",
                render: (r) => (
                  <Badge tone={TONE[r.status] ?? "neutral"}>
                    {r.status}
                    {r.note ? ` · ${r.note}` : ""}
                  </Badge>
                ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (r) =>
                  props.canApprove && r.status === "pending" ? (
                    <div className="admin-table__actions">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() =>
                          show({
                            kind: "approve-offer",
                            id: r.id,
                            owner: props.owners[0]?.value ?? "region",
                          })
                        }
                      >
                        Add to inventory
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => show({ kind: "reject-offer", id: r.id, note: "" })}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : null,
              },
            ]}
          />
        </CardBody>
      </Card>

      <h2 className="admin-section-title">Purchase requests</h2>
      <Card className="admin-list-card">
        <CardBody flush>
          <DataTable
            rowKey={(r) => r.id}
            rows={props.procurement}
            emptyText="No purchase has been asked for"
            columns={[
              {
                key: "name",
                header: "Item",
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
                header: "Status",
                render: (r) => (
                  <Badge tone={TONE[r.status] ?? "neutral"}>
                    {r.status}
                    {r.note ? ` · ${r.note}` : ""}
                  </Badge>
                ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (r) =>
                  r.canDecide ? (
                    <div className="admin-table__actions">
                      {r.status === "pending" ? (
                        <>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() =>
                              void run(
                                decideProcurementAction,
                                { id: r.id, step: "approve", note: "" },
                                "Approved",
                              )
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => show({ kind: "reject-purchase", id: r.id, note: "" })}
                          >
                            Reject
                          </Button>
                        </>
                      ) : null}
                      {r.status === "approved" ? (
                        <>
                          <Link
                            className="admin-btn admin-btn--sm admin-btn--outline"
                            href={`/finance?${r.financeQuery}`}
                          >
                            Ask Finance
                          </Link>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() =>
                              void run(
                                decideProcurementAction,
                                { id: r.id, step: "fulfil", note: "" },
                                "Recorded",
                              )
                            }
                          >
                            Bought
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ) : null,
              },
            ]}
          />
        </CardBody>
      </Card>
      {props.owners.length > 0 ? (
        <Button
          variant="primary"
          icon="plus"
          onClick={() =>
            show({
              kind: "purchase",
              owner: props.owners[0]?.value ?? "region",
              name: "",
              category: "",
              why: "",
              amount: "",
              currency: "IDR",
              urgency: "normal",
            })
          }
        >
          Ask to buy an item
        </Button>
      ) : null}

      <h2 className="admin-section-title">Loans to outside bodies</h2>
      <Card className="admin-list-card">
        <CardBody flush>
          <DataTable
            rowKey={(r) => r.id}
            rows={props.outside}
            emptyText="Nothing is lent to an outside body"
            columns={[
              {
                key: "item",
                header: "Loan",
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
                header: "Status",
                render: (r) =>
                  r.overdue ? (
                    <Badge tone="danger">Overdue</Badge>
                  ) : (
                    <Badge tone={TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                  ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (r) =>
                  r.status === "out" && r.canDecide ? (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => show({ kind: "take-back", id: r.id, conditionIn: "" })}
                    >
                      Take back
                    </Button>
                  ) : null,
              },
            ]}
          />
        </CardBody>
      </Card>
      {approvable.length > 0 ? (
        <Button
          variant="primary"
          icon="plus"
          onClick={() =>
            show({
              kind: "lend",
              itemId: firstItem(approvable),
              borrower: "",
              contact: "",
              purpose: "",
              quantity: "1",
              conditionOut: "",
              expectedBack: today,
            })
          }
        >
          Lend to an outside body
        </Button>
      ) : null}

      {dialog?.kind === "reserve" ? (
        <FormModal
          title="Reserve for an event"
          onClose={() => setDialog(null)}
          onSave={() =>
            void run(
              reserveItemAction,
              { ...dialog, kind: undefined, quantity: Number(dialog.quantity) },
              "Reserved",
            )
          }
        >
          <Field id="flow-item" label="Item" full>
            <Select
              id="flow-item"
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
          <Field id="flow-event" label="Event" full>
            <Select
              id="flow-event"
              value={dialog.eventId}
              onChange={(e) => setDialog({ ...dialog, eventId: e.target.value })}
            >
              {props.events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="flow-quantity" label="Quantity">
            <input
              id="flow-quantity"
              className="admin-input"
              type="number"
              min={1}
              value={dialog.quantity}
              onChange={(e) => setDialog({ ...dialog, quantity: e.target.value })}
            />
          </Field>
          <Field id="flow-from" label="From">
            <input
              id="flow-from"
              className="admin-input"
              type="date"
              value={dialog.from}
              onChange={(e) => setDialog({ ...dialog, from: e.target.value })}
            />
          </Field>
          <Field id="flow-to" label="To">
            <input
              id="flow-to"
              className="admin-input"
              type="date"
              value={dialog.to}
              onChange={(e) => setDialog({ ...dialog, to: e.target.value })}
            />
          </Field>
          {err}
        </FormModal>
      ) : null}

      {dialog?.kind === "approve-offer" ? (
        <FormModal
          title="Add the offered item to the inventory"
          onClose={() => setDialog(null)}
          onSave={() =>
            void run(
              approveContributionAction,
              { id: dialog.id, owner: ownerInput(dialog.owner) },
              "Added to the inventory",
            )
          }
        >
          <Field id="flow-owner" label="Owner" full>
            <Select
              id="flow-owner"
              value={dialog.owner}
              onChange={(e) => setDialog({ ...dialog, owner: e.target.value })}
            >
              {props.owners.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          {err}
        </FormModal>
      ) : null}

      {dialog?.kind === "reject-offer" || dialog?.kind === "reject-purchase" ? (
        <FormModal
          title="Reject"
          onClose={() => setDialog(null)}
          onSave={() =>
            void run(
              dialog.kind === "reject-offer" ? rejectContributionAction : decideProcurementAction,
              dialog.kind === "reject-offer"
                ? { id: dialog.id, note: dialog.note }
                : { id: dialog.id, step: "reject", note: dialog.note },
              "Rejected",
            )
          }
        >
          <Field id="flow-reason" label="Reason *" full>
            <input
              id="flow-reason"
              className="admin-input"
              maxLength={300}
              value={dialog.note}
              onChange={(e) => setDialog({ ...dialog, note: e.target.value })}
            />
          </Field>
          {err}
        </FormModal>
      ) : null}

      {dialog?.kind === "purchase" ? (
        <FormModal
          title="Ask to buy an item"
          onClose={() => setDialog(null)}
          onSave={() => {
            const estimatedMinor = dialog.amount.trim()
              ? toMinor(dialog.amount, dialog.currency)
              : 0;
            if (estimatedMinor === null)
              return setMessage("Type the estimate as a number, e.g. 1500000.");
            void run(
              requestProcurementAction,
              {
                owner: ownerInput(dialog.owner),
                name: dialog.name,
                category: dialog.category,
                why: dialog.why,
                estimatedMinor,
                currency: dialog.currency,
                urgency: dialog.urgency,
              },
              "Request sent",
            );
          }}
        >
          <Field id="flow-owner" label="Owner" full>
            <Select
              id="flow-owner"
              value={dialog.owner}
              onChange={(e) => setDialog({ ...dialog, owner: e.target.value })}
            >
              {props.owners.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="flow-item" label="Item *" full>
            <input
              id="flow-item"
              className="admin-input"
              maxLength={120}
              value={dialog.name}
              onChange={(e) => setDialog({ ...dialog, name: e.target.value })}
            />
          </Field>
          <Field id="flow-why-it-is-needed" label="Why it is needed *" full>
            <textarea
              id="flow-why-it-is-needed"
              className="admin-input"
              rows={3}
              maxLength={500}
              value={dialog.why}
              onChange={(e) => setDialog({ ...dialog, why: e.target.value })}
            />
          </Field>
          <Field id="flow-estimate" label="Estimate">
            <input
              id="flow-estimate"
              className="admin-input"
              inputMode="decimal"
              value={dialog.amount}
              onChange={(e) => setDialog({ ...dialog, amount: e.target.value })}
            />
          </Field>
          <Field id="flow-currency" label="Currency">
            <Select
              id="flow-currency"
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
          <Field id="flow-urgency" label="Urgency">
            <Select
              id="flow-urgency"
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
          {err}
        </FormModal>
      ) : null}

      {dialog?.kind === "lend" ? (
        <FormModal
          title="Lend to an outside body"
          onClose={() => setDialog(null)}
          onSave={() =>
            void run(
              lendOutAction,
              { ...dialog, kind: undefined, quantity: Number(dialog.quantity) },
              "Lent out",
            )
          }
        >
          <Field id="flow-item" label="Item" full>
            <Select
              id="flow-item"
              value={dialog.itemId}
              onChange={(e) => setDialog({ ...dialog, itemId: e.target.value })}
            >
              {approvable.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="flow-borrower" label="Borrower *" full>
            <input
              id="flow-borrower"
              className="admin-input"
              maxLength={120}
              value={dialog.borrower}
              onChange={(e) => setDialog({ ...dialog, borrower: e.target.value })}
            />
          </Field>
          <Field id="flow-contact" label="Contact *" full>
            <input
              id="flow-contact"
              className="admin-input"
              maxLength={200}
              value={dialog.contact}
              onChange={(e) => setDialog({ ...dialog, contact: e.target.value })}
            />
          </Field>
          <Field id="flow-purpose" label="Purpose *" full>
            <input
              id="flow-purpose"
              className="admin-input"
              maxLength={300}
              value={dialog.purpose}
              onChange={(e) => setDialog({ ...dialog, purpose: e.target.value })}
            />
          </Field>
          <Field id="flow-quantity" label="Quantity">
            <input
              id="flow-quantity"
              className="admin-input"
              type="number"
              min={1}
              value={dialog.quantity}
              onChange={(e) => setDialog({ ...dialog, quantity: e.target.value })}
            />
          </Field>
          <Field id="flow-back-by" label="Back by">
            <input
              id="flow-back-by"
              className="admin-input"
              type="date"
              value={dialog.expectedBack}
              onChange={(e) => setDialog({ ...dialog, expectedBack: e.target.value })}
            />
          </Field>
          <Field id="flow-condition-now" label="Condition now" full>
            <input
              id="flow-condition-now"
              className="admin-input"
              maxLength={120}
              value={dialog.conditionOut}
              onChange={(e) => setDialog({ ...dialog, conditionOut: e.target.value })}
            />
          </Field>
          {err}
        </FormModal>
      ) : null}

      {dialog?.kind === "take-back" ? (
        <FormModal
          title="Take the item back"
          onClose={() => setDialog(null)}
          onSave={() =>
            void run(
              takeBackOutsideAction,
              { id: dialog.id, conditionIn: dialog.conditionIn },
              "Taken back",
            )
          }
        >
          <Field id="flow-condition-now" label="Condition now" full>
            <input
              id="flow-condition-now"
              className="admin-input"
              maxLength={120}
              value={dialog.conditionIn}
              onChange={(e) => setDialog({ ...dialog, conditionIn: e.target.value })}
            />
          </Field>
          {err}
        </FormModal>
      ) : null}
      <ToastBanner message={toast.message} />
    </div>
  );
}
