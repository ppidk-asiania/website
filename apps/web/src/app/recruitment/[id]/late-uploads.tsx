"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/i18n/dictionaries";

export function LateUploads(props: {
  recruitmentId: string;
  questions: readonly { id: string; label: string }[];
  labels: Dictionary["recruitment"];
}) {
  const router = useRouter();
  const t = props.labels;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const upload = async (questionId: string, file: File) => {
    setBusy(true);
    setMessage(t.uploading);
    try {
      const response = await fetch(
        `/api/recruitment/${props.recruitmentId}/portfolio?question=${encodeURIComponent(questionId)}`,
        {
          method: "POST",
          body: file,
          headers: {
            "Content-Type": "application/pdf",
            "X-File-Name": encodeURIComponent(file.name),
          },
        },
      );
      const body = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      setMessage(
        body.ok
          ? t.uploadLaterDone
          : body.error === "not_pdf"
            ? t.notPdf
            : body.error === "too_large"
              ? t.tooLarge
              : (body.message ?? t.failed),
      );
      if (body.ok) router.refresh();
    } catch {
      setMessage(t.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ui-form">
      {props.questions.map((q) => (
        <div key={q.id} className="ui-field">
          <label htmlFor={`late-${q.id}`}>
            {t.uploadLater}: {q.label}
          </label>
          <input
            id={`late-${q.id}`}
            className="ui-input"
            type="file"
            accept="application/pdf"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(q.id, file);
              e.target.value = "";
            }}
          />
        </div>
      ))}
      {message && (
        <p role="status" className="ui-message">
          {message}
        </p>
      )}
    </div>
  );
}
