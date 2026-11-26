"use client";

import { useState, type FormEvent } from "react";
import { feeAmount, type AttendanceMode, type PublicFee } from "@website/domain/events";
import { formatMoney } from "@website/domain/shared";
import type { Question } from "@website/domain/forms";
import { FormFields } from "@/components/form-fields";
import type { Dictionary } from "@/i18n/dictionaries";
import { captchaToken } from "@/lib/captcha-client";
import { answersFrom, type FieldValues } from "@/lib/form-answers";
import type { FormRegistrationResult } from "@/server/registrations";
import { registerWithFormAction } from "./actions";

/** The registration wizard on one page: your data, the questions and how you attend, then one submit. */
export function RegisterWizard(props: {
  slug: string;
  version: number;
  questions: readonly Question[];
  modes: readonly AttendanceMode[];
  fee: PublicFee | null;
  practice: boolean;
  profile: { name: string; email: string; fields: ReadonlyArray<{ label: string; value: string }> };
  initial: FieldValues;
  labels: { events: Dictionary["events"]; forms: Dictionary["forms"] };
}) {
  const { events: e, forms: t } = props.labels;
  const [value, setValue] = useState<FieldValues>(props.initial);
  const [mode, setMode] = useState<AttendanceMode | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);

  const describe = (result: FormRegistrationResult): string => {
    if (result.ok) {
      if (result.practice) return e.practiceOk;
      return result.status === "pending"
        ? e.mailPending
        : result.status === "confirmed"
          ? e.confirmed
          : e.waitlisted;
    }
    if (result.error === "captcha") return t.captchaFailed;
    if (result.error === "closed") return e.closed;
    if (result.error === "changed") return t.changed;
    if (result.error === "answers") return t.checkAnswers;
    if (result.error === "mode") return e.modeNeeded;
    if (result.error === "category") return props.fee ? e.categoryClosed : e.categoryNeeded;
    if (result.error === "signin") return e.signInToRegister;
    if (result.error === "profile") return e.profileNeeded;
    return e.failed;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const token = await captchaToken("event_register");
      const result = await registerWithFormAction({
        slug: props.slug,
        version: props.version,
        attendanceMode: mode,
        feeCategory: category,
        answers: answersFrom(props.questions, value),
        ...(props.practice && { practice: true }),
        token,
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
      setNeedsProfile(!result.ok && result.error === "profile");
      setDone(result.ok && !result.practice);
      setMessage(describe(result));
    } catch {
      setMessage(e.failed);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p role="status" className="ui-message" data-tone="info">
        {message}
      </p>
    );
  }

  return (
    <form className="ui-form site-form" onSubmit={(event) => void submit(event)}>
      {props.practice && <p className="site-notice">{e.practice}</p>}
      <section aria-labelledby="register-data">
        <h2 id="register-data">{e.yourData}</h2>
        <dl>
          <div>
            <dt className="site-muted">{t.yourName}</dt>
            <dd>{props.profile.name || "—"}</dd>
          </div>
          <div>
            <dt className="site-muted">{t.yourEmail}</dt>
            <dd>{props.profile.email || "—"}</dd>
          </div>
          {props.profile.fields.map((field) => (
            <div key={field.label}>
              <dt className="site-muted">{field.label}</dt>
              <dd>{field.value || "—"}</dd>
            </div>
          ))}
        </dl>
        <a href={`/account/profile?next=${encodeURIComponent(`/events/${props.slug}/register`)}`}>
          {e.editProfile}
        </a>
      </section>

      {props.modes.length > 0 && (
        <fieldset className="ui-field">
          <legend>{e.attendMode} *</legend>
          {props.modes.map((m) => (
            <label key={m}>
              <input
                type="radio"
                name="attendance-mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                required
              />{" "}
              {m === "online" ? e.online : e.onsite}
            </label>
          ))}
        </fieldset>
      )}

      {props.fee && (
        <fieldset className="ui-field">
          <legend>{e.ticketCategory} *</legend>
          {props.fee.categories.map((c) => (
            <label key={c.id}>
              <input
                type="radio"
                name="fee-category"
                value={c.id}
                checked={category === c.id}
                onChange={() => setCategory(c.id)}
                required
              />{" "}
              {c.label} ·{" "}
              {formatMoney({
                amountMinor: feeAmount(props.fee!, c.id, new Date()),
                currency: props.fee!.currency,
              })}
            </label>
          ))}
          {props.fee.earlyUntil && (
            <p className="site-muted">
              {e.earlyUntil.replace("{date}", props.fee.earlyUntil.toISOString().slice(0, 10))}
            </p>
          )}
        </fieldset>
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
        {busy ? e.registering : e.register}
      </button>
      {message && (
        <p role="status" className="ui-message">
          {needsProfile ? (
            <a
              href={`/account/profile?next=${encodeURIComponent(`/events/${props.slug}/register`)}`}
            >
              {message}
            </a>
          ) : (
            message
          )}
        </p>
      )}
      <p className="site-muted">{t.recaptchaNotice}</p>
    </form>
  );
}
