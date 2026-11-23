"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/i18n/dictionaries";
import { submitApplicationAction } from "../actions";

export function SubmitApplication(props: { recruitmentId: string; t: Dictionary["recruitment"] }) {
  const { t } = props;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    try {
      const result = await submitApplicationAction({ recruitmentId: props.recruitmentId });
      if (result.ok) return router.push(`/recruitment/${props.recruitmentId}`);
      setMessage(
        result.error === "proof"
          ? t.proofMissing
          : result.error === "answers"
            ? t.steps.fixAnswers
            : result.error === "refused"
              ? (result.message ?? t.failed)
              : result.error === "closed"
                ? t.actions.closed
                : result.error === "locked"
                  ? t.locked
                  : t.failed,
      );
    } catch {
      setMessage(t.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="ui-button" type="button" disabled={busy} onClick={() => void send()}>
        {t.submit}
      </button>
      {message && (
        <p role="alert" className="ui-message">
          {message}
        </p>
      )}
    </>
  );
}
