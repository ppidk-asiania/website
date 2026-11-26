"use client";

import { useState, type FormEvent } from "react";
import type { Dictionary } from "@/i18n/dictionaries";

type Labels = Dictionary["inventory"]["offer"];
type State = "idle" | "sent" | "failed" | "profile";

/** A member offers an item to give or to lend to the organisation. */
export function OfferForm({ labels }: { labels: Labels }) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [mode, setMode] = useState<"give" | "lend">("give");

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" ? value : "";
    };
    setBusy(true);
    try {
      const response = await fetch("/api/inventory/offers", {
        method: "POST",
        body: JSON.stringify({
          name: text("name"),
          description: text("description"),
          quantity: Number(text("quantity")),
          mode,
          returnOn: mode === "lend" ? text("returnOn") : null,
        }),
      });
      if (response.ok) {
        setState("sent");
        event.currentTarget.reset();
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setState(body?.error === "profile" ? "profile" : "failed");
    } catch {
      setState("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void send(event)}>
      <p className="site-muted">{labels.hint}</p>
      <div className="ui-field">
        <label htmlFor="offer-name">{labels.name}</label>
        <input id="offer-name" name="name" required maxLength={120} />
      </div>
      <div className="ui-field">
        <label htmlFor="offer-quantity">{labels.quantity}</label>
        <input
          id="offer-quantity"
          name="quantity"
          type="number"
          min={1}
          defaultValue={1}
          required
        />
      </div>
      <div className="ui-field">
        <label htmlFor="offer-description">{labels.description}</label>
        <input id="offer-description" name="description" maxLength={500} />
      </div>
      <div className="ui-field">
        <label htmlFor="offer-mode">{labels.mode}</label>
        <select
          id="offer-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value === "lend" ? "lend" : "give")}
        >
          <option value="give">{labels.give}</option>
          <option value="lend">{labels.lend}</option>
        </select>
      </div>
      {mode === "lend" ? (
        <div className="ui-field">
          <label htmlFor="offer-return">{labels.returnOn}</label>
          <input id="offer-return" name="returnOn" type="date" required />
        </div>
      ) : null}
      <button type="submit" className="ui-button" disabled={busy}>
        {labels.send}
      </button>
      {state === "sent" ? (
        <p role="status" className="site-notice">
          {labels.sent}
        </p>
      ) : null}
      {state === "failed" || state === "profile" ? (
        <p role="alert" className="ui-message">
          {state === "profile" ? labels.profile : labels.failed}
        </p>
      ) : null}
    </form>
  );
}
