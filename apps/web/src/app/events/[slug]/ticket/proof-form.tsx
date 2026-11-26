"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";

/** Sends the proof of payment (an image or a PDF) and reloads the page to show the new state. */
export function ProofForm(props: {
  slug: string;
  labels: { upload: string; hint: string; failed: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const send = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/events/${props.slug}/proof`, {
        method: "POST",
        body: file,
      });
      setFailed(!response.ok);
      if (response.ok) router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  return (
    <div className="ui-field">
      <label htmlFor="event-proof">{props.labels.upload}</label>
      <input
        id="event-proof"
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        disabled={busy}
        onChange={(event) => void send(event)}
      />
      <p className="site-muted">{props.labels.hint}</p>
      {failed && (
        <p role="alert" className="ui-message">
          {props.labels.failed}
        </p>
      )}
    </div>
  );
}
