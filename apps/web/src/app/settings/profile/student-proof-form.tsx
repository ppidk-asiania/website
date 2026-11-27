"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";

type Current = {
  main: boolean;
  supporting: boolean;
  version: number;
  review: { state: "ok" | "fix" | "fixed"; note: string } | null;
};

export function StudentProofForm(props: { t: Dictionary["profile"]["proof"]; current: Current }) {
  const { t, current } = props;
  const router = useRouter();
  const [mainFile, setMainFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const upload = async (file: File, kind: "main" | "supporting") => {
    setBusy(true);
    setMessage(t.uploading);
    try {
      const response = await fetch(
        `/api/account/student-proof?file=${kind}${kind === "main" ? "&confirmed=1" : ""}`,
        { method: "POST", body: file },
      );
      const body = (await response.json()) as { ok?: boolean; error?: string };
      const refusals: Record<string, string> = {
        confirm: t.confirmFirst,
        main_first: t.mainFirst,
        too_large: t.tooLarge,
        not_file: t.notFile,
      };
      setMessage(body.ok ? t.saved : (refusals[body.error ?? ""] ?? t.failed));
      if (body.ok) {
        setMainFile(null);
        setConfirmed(false);
        router.refresh();
      }
    } catch {
      setMessage(t.failed);
    } finally {
      setBusy(false);
    }
  };

  const link = (file: "main" | "supporting") => (
    <a
      href={`/api/account/student-proof?file=${file}&v=${current.version}`}
      target="_blank"
      rel="noopener"
    >
      {t.view}
    </a>
  );

  return (
    <div className="ui-form" id="student-proof">
      <p>{t.intro}</p>
      {current.review && (
        <p role="status">
          {current.review.state === "ok"
            ? t.ok
            : current.review.state === "fix"
              ? `${t.fix} ${current.review.note}`
              : t.fixed}
        </p>
      )}
      <p>{current.main ? link("main") : t.none}</p>
      <label className="ui-field">
        {t.main}
        <input
          className="ui-input"
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) => setMainFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <small>{t.mainHint}</small>
      <label className="ui-field">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{" "}
        {t.confirm}
      </label>
      <button
        className="ui-button"
        type="button"
        disabled={busy || !mainFile || !confirmed}
        onClick={() => mainFile && void upload(mainFile, "main")}
      >
        {t.save}
      </button>
      {current.main && (
        <>
          {current.supporting && <p>{link("supporting")}</p>}
          <label className="ui-field">
            {t.supporting}
            <input
              className="ui-input"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file, "supporting");
                e.target.value = "";
              }}
            />
          </label>
        </>
      )}
      {message && (
        <p role="status" className="ui-message">
          {message}
        </p>
      )}
    </div>
  );
}
