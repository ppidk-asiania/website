"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FINANCE_CURRENCIES } from "@website/domain/finance";
import {
  majorText,
  minorDigits,
  toMinor,
  utcToWallTime,
  wallTimeToUtc,
} from "@website/domain/shared";
import { saveEventFeeAction } from "@/app/(panel)/events/actions";
import { actionMessage } from "@/components/action-message";
import { publicImage, useImageUpload } from "@/components/image-upload";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { PhotoDrop } from "@/components/ui/photo-drop";
import { Select } from "@/components/ui/select";
import { UploadBar } from "@/components/ui/upload-bar";
import type { EventItem } from "./events-model";

interface CategoryRow {
  id: string;
  label: string;
  amount: string;
  early: string;
  quota: string;
}

const EMPTY_ROW: CategoryRow = { id: "", label: "", amount: "", early: "", quota: "" };

/** Fee categories, early price and how to pay for a paid event (N1.3, DEC-26): money moves outside the platform. */
export function EventFeePanel(props: {
  event: EventItem;
  version: number;
  onSaved: (version: number) => void;
  show: (message: string) => void;
}) {
  const { event, show } = props;
  const router = useRouter();
  const saved = event.fee;
  const upload = useImageUpload("banner");
  const [paid, setPaid] = useState(saved?.paid ?? false);
  const [currency, setCurrency] = useState<string>(saved?.currency ?? "IDR");
  const [rows, setRows] = useState<CategoryRow[]>(
    saved?.categories.map((c) => ({
      id: c.id,
      label: c.label,
      amount: majorText(c.amountMinor, saved.currency),
      early: c.earlyAmountMinor === null ? "" : majorText(c.earlyAmountMinor, saved.currency),
      quota: c.quota === null ? "" : String(c.quota),
    })) ?? [],
  );
  const [earlyUntil, setEarlyUntil] = useState(
    saved?.earlyUntil ? utcToWallTime(new Date(saved.earlyUntil), event.timezone) : "",
  );
  const [instructions, setInstructions] = useState(saved?.instructions ?? "");
  const [payImage, setPayImage] = useState(saved?.payImage ?? null);
  const [busy, setBusy] = useState(false);

  const patch = (i: number, change: Partial<CategoryRow>) =>
    setRows(rows.map((r, at) => (at === i ? { ...r, ...change } : r)));

  const save = async (off: boolean) => {
    const amounts = rows.map((r) => ({
      amount: toMinor(r.amount, currency),
      early: r.early.trim() === "" ? null : toMinor(r.early, currency),
    }));
    if (
      !off &&
      amounts.some(
        (a, i) => a.amount === null || (rows[i]!.early.trim() !== "" && a.early === null),
      )
    ) {
      show(`Enter the prices as numbers with up to ${minorDigits(currency)} decimals.`);
      return;
    }
    const until = earlyUntil ? wallTimeToUtc(earlyUntil, event.timezone) : null;
    if (earlyUntil && !until) {
      show("Check the date of the early price.");
      return;
    }
    setBusy(true);
    const result = await saveEventFeeAction({
      id: event.id,
      version: props.version,
      fee: off
        ? null
        : {
            paid,
            currency,
            categories: rows.map((r, i) => ({
              id: r.id,
              label: r.label,
              amountMinor: amounts[i]!.amount as number,
              earlyAmountMinor: amounts[i]!.early,
              quota: r.quota.trim() === "" ? null : Number(r.quota),
            })),
            earlyUntil: until?.toISOString() ?? null,
            instructions,
            payImage,
          },
    });
    setBusy(false);
    if (!result.ok) {
      show(actionMessage(result));
      return;
    }
    props.onSaved(result.data.version);
    show(off ? "Fee removed" : "Fee saved");
    router.refresh();
  };

  return (
    <div className="admin-event-fee">
      <label className="admin-check-label">
        <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
        Paid event (people pay outside the platform and upload a proof)
      </label>
      {paid ? (
        <>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="event-fee-currency">
              Currency
            </label>
            <Select
              id="event-fee-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {FINANCE_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          {rows.map((r, i) => (
            <div key={r.id || i} className="admin-form-grid">
              <div className="admin-field">
                <label className="admin-field__label" htmlFor={`fee-label-${i}`}>
                  Category
                </label>
                <input
                  id={`fee-label-${i}`}
                  className="admin-input"
                  value={r.label}
                  onChange={(e) => patch(i, { label: e.target.value })}
                />
              </div>
              <div className="admin-field">
                <label className="admin-field__label" htmlFor={`fee-amount-${i}`}>
                  Price
                </label>
                <input
                  id={`fee-amount-${i}`}
                  className="admin-input"
                  inputMode="decimal"
                  value={r.amount}
                  onChange={(e) => patch(i, { amount: e.target.value })}
                />
              </div>
              <div className="admin-field">
                <label className="admin-field__label" htmlFor={`fee-early-${i}`}>
                  Early price
                </label>
                <input
                  id={`fee-early-${i}`}
                  className="admin-input"
                  inputMode="decimal"
                  value={r.early}
                  onChange={(e) => patch(i, { early: e.target.value })}
                />
              </div>
              <div className="admin-field">
                <label className="admin-field__label" htmlFor={`fee-quota-${i}`}>
                  Places
                </label>
                <input
                  id={`fee-quota-${i}`}
                  className="admin-input"
                  inputMode="numeric"
                  placeholder="No limit"
                  value={r.quota}
                  onChange={(e) => patch(i, { quota: e.target.value })}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRows(rows.filter((_, at) => at !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            icon="plus"
            onClick={() => setRows([...rows, EMPTY_ROW])}
          >
            Add category
          </Button>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="event-fee-early-until">
              Early price until ({event.timezone})
            </label>
            <input
              id="event-fee-early-until"
              className="admin-input"
              type="datetime-local"
              value={earlyUntil}
              onChange={(e) => setEarlyUntil(e.target.value)}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="event-fee-how">
              How to pay (shown on the ticket page)
            </label>
            <textarea
              id="event-fee-how"
              className="admin-input admin-textarea"
              rows={3}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>
          <PhotoDrop
            value={payImage?.thumbUrl ?? null}
            label="QR code or account details"
            onFile={(file) =>
              void upload.upload(file).then((image) => {
                const next = image ? publicImage(image) : null;
                if (next) setPayImage(next);
              })
            }
            onClear={() => setPayImage(null)}
          />
          <UploadBar upload={upload} />
          <FieldError id="event-fee-image-error" message={upload.error} />
        </>
      ) : null}
      <div className="admin-form-actions">
        <Button
          variant="outline"
          size="sm"
          icon="check"
          disabled={busy || upload.busy}
          onClick={() => void save(false)}
        >
          Save fee
        </Button>
        {saved ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void save(true)}>
            Remove the fee
          </Button>
        ) : null}
      </div>
    </div>
  );
}
