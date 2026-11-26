"use client";

import { useState, type FormEvent } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import { captchaToken } from "@/lib/captcha-client";

type Labels = Dictionary["inventory"]["request"];
type State = "idle" | "sent" | "failed" | "profile" | "captcha" | "unavailable";
const KNOWN = ["profile", "captcha", "unavailable"] as const;

/** A member sends a small JSON request; an outsider adds who they are and a signed statement (PDF). */
export function LoanForm(props: {
  items: { id: string; name: string }[];
  signedIn: boolean;
  labels: Labels;
}) {
  const { labels } = props;
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<State>("idle");

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" ? value : "";
    };
    const fields = {
      itemId: text("item"),
      quantity: Number(text("quantity")),
      purpose: text("purpose"),
      place: text("place"),
      from: text("from"),
      to: text("to"),
    };
    setBusy(true);
    try {
      let response: Response;
      if (props.signedIn) {
        response = await fetch("/api/inventory/loans", {
          method: "POST",
          body: JSON.stringify(fields),
        });
      } else {
        const file = form.get("statement");
        if (!(file instanceof File) || file.size === 0) return setState("failed");
        const query = new URLSearchParams({
          item: fields.itemId,
          quantity: String(fields.quantity),
          purpose: fields.purpose,
          place: fields.place,
          from: fields.from,
          to: fields.to,
          name: text("name"),
          email: text("email"),
          phone: text("phone"),
        });
        response = await fetch(`/api/inventory/outsider?${query}`, {
          method: "POST",
          headers: { "x-captcha-token": await captchaToken("loan_request") },
          body: file,
        });
      }
      if (response.ok) {
        setState("sent");
        event.currentTarget.reset();
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setState(KNOWN.find((k) => k === body?.error) ?? "failed");
    } catch {
      setState("failed");
    } finally {
      setBusy(false);
    }
  };

  const field = (name: string, label: string, props: React.ComponentProps<"input"> = {}) => (
    <div className="ui-field">
      <label htmlFor={`loan-${name}`}>{label}</label>
      <input id={`loan-${name}`} name={name} required {...props} />
    </div>
  );

  return (
    <form onSubmit={(event) => void send(event)}>
      <p className="site-muted">{props.signedIn ? labels.memberHint : labels.outsiderHint}</p>
      <div className="ui-field">
        <label htmlFor="loan-item">{labels.item}</label>
        <select id="loan-item" name="item" required>
          {props.items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      {field("quantity", labels.quantity, { type: "number", min: 1, defaultValue: 1 })}
      {field("from", labels.from, { type: "date" })}
      {field("to", labels.to, { type: "date" })}
      {field("purpose", labels.purpose, { maxLength: 300 })}
      {field("place", labels.place, { maxLength: 120 })}
      {!props.signedIn ? (
        <>
          {field("name", labels.name, { maxLength: 120 })}
          {field("email", labels.email, { type: "email" })}
          {field("phone", labels.phone, { maxLength: 30 })}
          {field("statement", labels.statement, { type: "file", accept: "application/pdf" })}
        </>
      ) : null}
      <button type="submit" className="ui-button" disabled={busy}>
        {labels.send}
      </button>
      {state === "sent" ? (
        <p role="status" className="site-notice">
          {labels.sent}
        </p>
      ) : null}
      {state !== "idle" && state !== "sent" ? (
        <p role="alert" className="ui-message">
          {state === "failed" ? labels.failed : labels[state]}
        </p>
      ) : null}
    </form>
  );
}
