"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary, Language } from "@/i18n/dictionaries";
import { formatEventTime } from "@/lib/event-time";
import { bookInterviewAction, cancelInterviewAction } from "./actions";

interface Choice {
  id: string;
  name: string;
  current: { startsAt: string; location: string; note: string; changeable: boolean } | null;
  times: { id: string; startsAt: string; minutes: number }[];
}

/** One interview per chosen unit; a booking is changed or cancelled once, before the cut-off. */
export function InterviewTimes(props: {
  recruitmentId: string;
  zone: string;
  language: Language;
  choices: Choice[];
  labels: Dictionary["recruitment"];
}) {
  const router = useRouter();
  const t = props.labels;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const show = (iso: string) => formatEventTime(new Date(iso), props.zone, props.language);

  const run = async (
    work: () => Promise<{ ok: boolean; error?: string; message?: string }>,
    done: string,
  ) => {
    setBusy(true);
    const result = await work();
    setBusy(false);
    setMessage(
      result.ok ? done : result.error === "refused" ? (result.message ?? t.failed) : t.failed,
    );
    if (result.ok) router.refresh();
  };

  return (
    <div className="ui-form site-form">
      <h3>{t.interviewTimes}</h3>
      <p className="site-muted">
        {t.timesIn}: {props.zone}
      </p>
      {props.choices.map((c) => (
        <section key={c.id} aria-label={c.name}>
          <h4>
            {t.interviewFor} {c.name}
          </h4>
          {c.current && (
            <p className="site-notice">
              {t.yourInterview}: <strong>{show(c.current.startsAt)}</strong> ({props.zone})
              {c.current.location && (
                <>
                  <br />
                  {c.current.location}
                </>
              )}
              {c.current.note && (
                <>
                  <br />
                  {c.current.note}
                </>
              )}
              <br />
              <span className="site-muted">
                {c.current.changeable ? t.changeOnce : t.changeClosed}
              </span>
              {c.current.changeable && (
                <>
                  <br />
                  <button
                    className="ui-button"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          cancelInterviewAction({
                            recruitmentId: props.recruitmentId,
                            choiceId: c.id,
                          }),
                        t.cancelled,
                      )
                    }
                  >
                    {t.cancelBooking}
                  </button>
                </>
              )}
            </p>
          )}
          {c.times.length === 0 ? (
            !c.current && <p className="site-muted">{t.noTimes}</p>
          ) : (
            <ul className="site-choices">
              {c.times.map((s) => (
                <li key={s.id} className="site-choice">
                  {show(s.startsAt)} · {s.minutes} min{" "}
                  <button
                    className="ui-button"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          bookInterviewAction({
                            recruitmentId: props.recruitmentId,
                            choiceId: c.id,
                            slotId: s.id,
                          }),
                        t.booked,
                      )
                    }
                  >
                    {c.current ? t.move : t.book}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {message && (
        <p role="status" className="ui-message">
          {message}
        </p>
      )}
    </div>
  );
}
