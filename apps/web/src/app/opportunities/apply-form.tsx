"use client";

import { useState, type FormEvent } from "react";
import type { Dictionary } from "@/i18n/dictionaries";

type Labels = Dictionary["opportunities"];

/** A cover letter and a CV (PDF) for a posting that is applied to on the platform. */
export function ApplyForm({ id, labels }: { id: string; labels: Labels }) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "sent" | "profile" | "failed">("idle");

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    try {
      const response = await fetch(`/api/opportunities/${id}/applications`, {
        method: "POST",
        body: new FormData(form),
      });
      setState(response.ok ? "sent" : response.status === 403 ? "profile" : "failed");
    } catch {
      setState("failed");
    } finally {
      setBusy(false);
    }
  };

  if (state === "sent") {
    return (
      <p role="status" className="site-notice">
        {labels.sent}
      </p>
    );
  }
  return (
    <form onSubmit={(event) => void send(event)}>
      <div className="ui-field">
        <label htmlFor={`letter-${id}`}>{labels.coverLetter}</label>
        <textarea
          id={`letter-${id}`}
          name="coverLetter"
          rows={5}
          minLength={20}
          maxLength={3000}
          required
        />
      </div>
      <div className="ui-field">
        <label htmlFor={`cv-${id}`}>{labels.cv}</label>
        <input id={`cv-${id}`} name="cv" type="file" accept="application/pdf" required />
      </div>
      <button type="submit" className="ui-button" disabled={busy}>
        {labels.send}
      </button>
      {state === "profile" && (
        <p role="alert" className="ui-message">
          {labels.profileIncomplete} <a href="/settings/profile">/settings/profile</a>
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
