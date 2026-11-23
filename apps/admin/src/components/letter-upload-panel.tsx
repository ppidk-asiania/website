"use client";

import { useRef, useState, type ReactNode } from "react";
import type { UploadPlacement } from "@website/domain/documents";
import { placeLetterStampsAction } from "@/app/(panel)/letters/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { LetterPlacementCanvas, sameKey } from "./letter-placement-canvas";
import type { LetterItem } from "./letters-model";
import type { ItemKey } from "./placement-math";

type Field = "page" | "xMm" | "yMm" | "sizeMm" | "wMm" | "hMm";
type Desk = "secretary" | "coordinator";
const FIELD_LABELS: Record<Field, string> = {
  page: "Page",
  xMm: "From left (mm)",
  yMm: "From top (mm)",
  sizeMm: "Size (mm)",
  wMm: "Width (mm)",
  hMm: "Height (mm)",
};
const NUMBER_FIELDS: readonly Field[] = ["page", "xMm", "yMm", "wMm", "hMm"];
const QR_FIELDS: readonly Field[] = ["page", "xMm", "yMm", "sizeMm"];
const DESK_FIELDS: readonly Field[] = ["page", "xMm", "yMm", "wMm"];
const MAX_NUMBERS = 10;

const NEW_NUMBER = { xMm: 20, yMm: 30, wMm: 90, hMm: 6 };
const DEFAULTS = {
  qr: { page: 1, xMm: 175, yMm: 255, sizeMm: 22 },
  secretary: { page: 1, xMm: 130, yMm: 230, wMm: null, withStamp: false },
  coordinator: { page: 1, xMm: 30, yMm: 230, wMm: null, withStamp: false },
} satisfies Omit<UploadPlacement, "numbers">;

export function LetterUploadPanel(props: {
  letter: LetterItem;
  deskTitles: { coordinator: string; signer: string };
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { letter, deskTitles, onDone, onError } = props;
  const manual = letter.source === "manual";
  const LABELS: Record<ItemKey["kind"], string> = {
    number: "Number",
    qr: "QR",
    secretary: deskTitles.signer,
    coordinator: deskTitles.coordinator,
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ItemKey | null>(null);
  const [placement, setPlacement] = useState<UploadPlacement>(
    letter.placement ?? { numbers: [], ...DEFAULTS, coordinator: null },
  );
  const desks: Desk[] = letter.requiresCoordinator ? ["secretary", "coordinator"] : ["secretary"];

  const upload = async (file: File) => {
    if (file.type !== "application/pdf") return onError("Upload the document as a PDF.");
    if (file.size > 10 * 1024 * 1024) return onError("The PDF may be at most 10 MB.");
    setBusy(true);
    const response = await fetch(`/api/letters/${letter.id}/file?version=${letter.version}`, {
      method: "POST",
      body: file,
      headers: { "content-type": "application/pdf" },
    });
    setBusy(false);
    const data = (await response.json().catch(() => ({}))) as {
      message?: string;
      numberChecked?: boolean;
    };
    if (!response.ok)
      return onError(data.message ?? "Upload failed. Reload the page and try again.");
    onDone(
      !letter.numberFormatted
        ? "PDF uploaded"
        : data.numberChecked
          ? "PDF uploaded: the number was found in it"
          : "PDF uploaded: the number was not found in its text (a scan?)",
    );
  };

  const save = async () => {
    setBusy(true);
    const result = await placeLetterStampsAction({
      id: letter.id,
      version: letter.version,
      placement,
    });
    setBusy(false);
    if (!result.ok) return onError(actionMessage(result));
    onDone("Positions saved: open the preview to check them");
  };

  const setField = (key: ItemKey, field: Field, value: number | null) => {
    if (key.kind === "number") {
      const numbers = placement.numbers.map((n, at) =>
        at === key.index ? { ...n, [field]: value } : n,
      );
      return setPlacement({ ...placement, numbers });
    }
    const current = placement[key.kind];
    if (current) setPlacement({ ...placement, [key.kind]: { ...current, [field]: value } });
  };
  const addNumber = () => {
    const numbers = [...placement.numbers, { page, ...NEW_NUMBER }];
    setPlacement({ ...placement, numbers });
    setSelected({ kind: "number", index: numbers.length - 1 });
  };
  const toggle = (key: "qr" | Desk, on: boolean) =>
    setPlacement({ ...placement, [key]: on ? { ...DEFAULTS[key], page } : null });

  const row = (key: ItemKey, title: string, fields: readonly Field[], extra?: ReactNode) => {
    const spot = key.kind === "number" ? placement.numbers[key.index] : placement[key.kind];
    return (
      <fieldset
        key={key.kind === "number" ? `number-${key.index}` : key.kind}
        className="admin-form-grid"
        onFocus={() => setSelected(key)}
        data-selected={sameKey(selected, key) || undefined}
      >
        <legend className="admin-field__label">{title}</legend>
        {spot
          ? fields.map((field) => (
              <label key={field} className="admin-field">
                <span className="admin-field__label">{FIELD_LABELS[field]}</span>
                <input
                  className="admin-input"
                  type="number"
                  min={field === "page" ? 1 : 0}
                  value={(spot as Record<string, number | null>)[field] ?? ""}
                  placeholder={field === "wMm" && key.kind !== "number" ? "signature's own" : ""}
                  onChange={(e) =>
                    setField(
                      key,
                      field,
                      e.target.value === "" && field === "wMm" && key.kind !== "number"
                        ? null
                        : Number(e.target.value),
                    )
                  }
                />
              </label>
            ))
          : null}
        {extra}
      </fieldset>
    );
  };
  const tick = (key: "qr" | Desk, text: string) => (
    <label className="admin-check-label admin-form-grid__full">
      <input
        type="checkbox"
        checked={placement[key] !== null}
        onChange={(e) => toggle(key, e.target.checked)}
      />{" "}
      {text}
    </label>
  );

  return (
    <section className="admin-card admin-letter-upload" aria-label="Final PDF">
      <h2 className="admin-card__title">Final PDF</h2>
      <p className="admin-card__subtitle">
        {letter.numberFormatted ? (
          <>
            Type <strong>{letter.numberFormatted}</strong> into the document, export it as PDF and
            upload it here
          </>
        ) : (
          <>Export your document as PDF without the number and upload it here</>
        )}{" "}
        (at most 10 MB, without a password).
        {letter.numberFormatted && letter.upload
          ? letter.upload.numberChecked
            ? " The uploaded PDF contains the number."
            : " The number was not found in the uploaded PDF's text (a scan?): check it yourself."
          : ""}
        {manual ? " It is kept exactly as uploaded: nothing is printed into it." : ""}
      </p>
      {letter.canEdit ? (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            icon="upload"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {letter.upload ? "Replace PDF" : "Upload PDF"}
          </Button>
          {manual ? null : (
            <>
              <p className="admin-card__subtitle">
                Drag the boxes on the page (corner handle to resize) or type the values, in mm from
                the top-left corner. The number, the QR and the signatures are printed when the
                letter is issued; a signature appears once that desk has signed.
              </p>
              {letter.upload ? (
                <LetterPlacementCanvas
                  url={`/api/letters/${letter.id}/pdf?v=${letter.version}`}
                  placement={placement}
                  page={page}
                  labels={LABELS}
                  selected={selected}
                  onSelect={setSelected}
                  onPage={setPage}
                  onChange={setPlacement}
                />
              ) : null}
              {placement.numbers.map((_, index) => (
                <div key={index}>
                  {row({ kind: "number", index }, `Number box ${index + 1}`, NUMBER_FIELDS)}
                  <Button
                    variant="outline"
                    size="sm"
                    icon="trash"
                    onClick={() =>
                      setPlacement({
                        ...placement,
                        numbers: placement.numbers.filter((_, at) => at !== index),
                      })
                    }
                  >
                    Remove box {index + 1}
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                icon="plus"
                disabled={placement.numbers.length >= MAX_NUMBERS}
                onClick={addNumber}
              >
                Add number box (page {page})
              </Button>
              {tick("qr", "QR and code")}
              {row({ kind: "qr" }, "QR and code", QR_FIELDS)}
              {desks.map((desk) => (
                <div key={desk}>
                  {tick(desk, `${LABELS[desk]}'s signature`)}
                  {row({ kind: desk }, `${LABELS[desk]}'s signature`, DESK_FIELDS)}
                  {placement[desk] ? (
                    <label className="admin-check-label">
                      <input
                        type="checkbox"
                        checked={placement[desk]?.withStamp ?? false}
                        onChange={(e) =>
                          setPlacement({
                            ...placement,
                            [desk]: { ...(placement[desk] as object), withStamp: e.target.checked },
                          })
                        }
                      />{" "}
                      Print the stamp next to it
                    </label>
                  ) : null}
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                icon="cloud"
                disabled={busy}
                onClick={() => save()}
              >
                Save positions
              </Button>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
