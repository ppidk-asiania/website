"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import { captchaToken } from "@/lib/captcha-client";
import { enterLetterArchiveAction } from "./actions";

type Failure = "details" | "captcha" | "failed" | null;

export function GuestBook({ labels: t }: { labels: Dictionary["letterArchive"] }) {
  const router = useRouter();
  const [guest, setGuest] = useState({ name: "", email: "", institution: "" });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const result = await enterLetterArchiveAction({
        ...guest,
        captcha: await captchaToken("letter_archive"),
      });
      if (result.ok) router.refresh();
      else setFailure(result.error);
    } catch {
      setFailure("failed");
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof typeof guest, label: string, type = "text", max = 160) => (
    <label className="ui-field">
      <span>{label}</span>
      <input
        className="ui-input"
        type={type}
        name={key}
        required
        maxLength={max}
        value={guest[key]}
        onChange={(e) => setGuest({ ...guest, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <form className="ui-form site-form" onSubmit={(e) => void submit(e)} noValidate>
      <p>{t.guestIntro}</p>
      {field("name", t.nameLabel, "text", 120)}
      {field("email", t.emailLabel, "email", 254)}
      {field("institution", t.institutionLabel)}
      <button className="ui-button" type="submit" disabled={busy}>
        {busy ? t.entering : t.enter}
      </button>
      <p className="site-muted">{t.recaptchaNotice}</p>
      <div role="status" aria-live="polite">
        {failure === "details" && <p className="ui-message">{t.badDetails}</p>}
        {failure === "captcha" && <p className="ui-message">{t.captchaFailed}</p>}
        {failure === "failed" && <p className="ui-message">{t.failed}</p>}
      </div>
    </form>
  );
}
