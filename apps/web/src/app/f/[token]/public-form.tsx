"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { Question } from "@website/domain/forms";
import { FormFields } from "@/components/form-fields";
import type { Dictionary } from "@/i18n/dictionaries";
import { captchaToken } from "@/lib/captcha-client";
import { answersFrom, EMPTY_VALUES, type FieldValues } from "@/lib/form-answers";
import type { FormSubmitResult } from "@/server/forms";
import { submitFormAction } from "./actions";

export function PublicFormClient(props: {
  token: string;
  version: number;
  questions: readonly Question[];
  labels: Dictionary["forms"];
  /** guest forms ask for name and e-mail first */
  askGuest: boolean;
  /** account / officers forms: answers can be changed until the form closes */
  signedIn: boolean;
  initial: FieldValues;
  children?: ReactNode;
}) {
  const t = props.labels;
  const [value, setValue] = useState<FieldValues>(props.initial);
  const [guest, setGuest] = useState({ name: "", email: "" });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const describe = (result: FormSubmitResult): string => {
    if (result.ok) return t.thanks;
    if (result.error === "captcha") return t.captchaFailed;
    if (result.error === "closed" || result.error === "not_found") return t.closed;
    if (result.error === "changed") return t.changed;
    if (result.error === "answers") return t.checkAnswers;
    if (result.error === "signin") return t.signIn;
    if (result.error === "officers") return t.officersOnly;
    if (result.error === "committee") return t.committeeOnly;
    if (result.error === "guest") return t.guestInvalid;
    return t.failed;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const captcha = await captchaToken("form_submit");
      const result = await submitFormAction({
        token: props.token,
        version: props.version,
        answers: answersFrom(props.questions, value),
        ...(props.askGuest && { guest }),
        captcha,
      });
      setErrors(
        !result.ok && result.error === "answers"
          ? Object.fromEntries(
              Object.entries(result.fields).map(([id, text]) => [
                id,
                text === "This question is required." ? t.requiredAnswer : t.invalidAnswer,
              ]),
            )
          : {},
      );
      setDone(result.ok);
      setMessage(describe(result));
    } catch {
      setMessage(t.failed);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="ui-form">
        <p role="status" className="ui-message" data-tone="info">
          {message}
        </p>
        <button
          className="ui-button"
          type="button"
          onClick={() => {
            if (!props.signedIn) setValue(EMPTY_VALUES);
            setDone(false);
            setMessage(null);
          }}
        >
          {props.signedIn ? t.edit : t.another}
        </button>
      </div>
    );
  }

  return (
    <form className="ui-form site-form" onSubmit={(e) => void submit(e)}>
      {props.children}
      {props.askGuest && (
        <>
          <label className="ui-field">
            {t.yourName} *
            <input
              required
              maxLength={200}
              autoComplete="name"
              value={guest.name}
              onChange={(e) => setGuest({ ...guest, name: e.target.value })}
            />
          </label>
          <label className="ui-field">
            {t.yourEmail} *
            <input
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              value={guest.email}
              onChange={(e) => setGuest({ ...guest, email: e.target.value })}
            />
          </label>
        </>
      )}
      <FormFields
        questions={props.questions}
        value={value}
        onChange={setValue}
        errors={errors}
        labels={t}
      />
      {errors["form"] && <p className="ui-message">{t.changed}</p>}
      <button className="ui-button" type="submit" disabled={busy}>
        {busy ? t.sending : t.submit}
      </button>
      {message && (
        <p role="status" className="ui-message">
          {message}
        </p>
      )}
      <p className="site-muted">{t.recaptchaNotice}</p>
    </form>
  );
}
