"use client";

import { useState, type FormEvent } from "react";

interface Labels {
  channel: string;
  amount: string;
  message: string;
  showName: string;
  proof: string;
  send: string;
  sent: string;
  failed: string;
}

/** Sends the amount, an optional message and the proof file; the donation then waits for a treasurer. */
export function DonateForm(props: {
  channels: { id: string; label: string; currency: string }[];
  labels: Labels;
}) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "sent" | "failed">("idle");

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("proof");
    if (!(file instanceof File) || file.size === 0) return setState("failed");
    const text = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" ? value : "";
    };
    const query = new URLSearchParams({
      channel: text("channel"),
      amount: text("amount"),
      message: text("message"),
      ...(form.get("name") ? { name: "1" } : {}),
    });
    setBusy(true);
    try {
      const response = await fetch(`/api/donations?${query}`, { method: "POST", body: file });
      setState(response.ok ? "sent" : "failed");
      if (response.ok) event.currentTarget.reset();
    } catch {
      setState("failed");
    } finally {
      setBusy(false);
    }
  };

  const { labels } = props;
  return (
    <form onSubmit={(event) => void send(event)}>
      <div className="ui-field">
        <label htmlFor="donation-channel">{labels.channel}</label>
        <select id="donation-channel" name="channel" required>
          {props.channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} ({c.currency})
            </option>
          ))}
        </select>
      </div>
      <div className="ui-field">
        <label htmlFor="donation-amount">{labels.amount}</label>
        <input id="donation-amount" name="amount" inputMode="decimal" required />
      </div>
      <div className="ui-field">
        <label htmlFor="donation-message">{labels.message}</label>
        <textarea id="donation-message" name="message" maxLength={300} rows={3} />
      </div>
      <label>
        <input type="checkbox" name="name" /> {labels.showName}
      </label>
      <div className="ui-field">
        <label htmlFor="donation-proof">{labels.proof}</label>
        <input
          id="donation-proof"
          name="proof"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          required
        />
      </div>
      <button type="submit" className="ui-button" disabled={busy}>
        {labels.send}
      </button>
      {state === "sent" && (
        <p role="status" className="site-notice">
          {labels.sent}
        </p>
      )}
      {state === "failed" && (
        <p role="alert" className="ui-message">
          {labels.failed}
        </p>
      )}
    </form>
  );
}
