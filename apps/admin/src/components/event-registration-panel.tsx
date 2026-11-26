"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { ATTENDANCE_MODES, type AttendanceMode } from "@website/domain/events";
import {
  createEventShortLinkAction,
  listEventRegistrantsAction,
  saveEventRegistrationAction,
} from "@/app/(panel)/events/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Select } from "@/components/ui/select";
import type { EventItem } from "./events-model";
import type { RegistrantRow } from "@/server/event-registration";

export interface RegistrationFormChoice {
  id: string;
  title: string;
  status: string;
}

interface Registrants {
  columns: readonly string[];
  rows: readonly RegistrantRow[];
}

/** The questions people answer to register, the way to reach them, and who answered (N1.2). */
export function EventRegistrationPanel(props: {
  event: EventItem;
  forms: readonly RegistrationFormChoice[];
  canEdit: boolean;
  canSeeRegistrants: boolean;
  publicBase: string;
  show: (message: string) => void;
}) {
  const { event, forms, canEdit, canSeeRegistrants, publicBase, show } = props;
  const router = useRouter();
  const saved = event.registration;
  const [formId, setFormId] = useState(saved?.formId ?? "");
  const [modes, setModes] = useState<readonly AttendanceMode[]>(
    saved?.attendanceModes ?? ["online", "onsite"],
  );
  const [onTicket, setOnTicket] = useState(saved?.showOnTicket ?? "");
  const [version, setVersion] = useState(event.version);
  const [shortUrl, setShortUrl] = useState(saved?.shortUrl ?? null);
  const [qr, setQr] = useState<string | null>(null);
  const [people, setPeople] = useState<Registrants | null>(null);
  const [busy, setBusy] = useState(false);

  const registerPath = `/events/${event.url}/register`;
  // Anyone may try the form: practice mode stores nothing (the event must already be public).
  const practiceUrl = `${publicBase}${registerPath}?practice=1`;

  const run = async <T extends { version: number }>(
    call: () => Promise<{ ok: true; data: T } | Parameters<typeof actionMessage>[0]>,
    done: (data: T) => void,
  ) => {
    setBusy(true);
    const result = await call();
    setBusy(false);
    if (!result.ok) {
      show(actionMessage(result));
      return;
    }
    setVersion(result.data.version);
    done(result.data);
    router.refresh();
  };

  const save = (withForm: boolean) =>
    run(
      () =>
        saveEventRegistrationAction({
          id: event.id,
          version,
          setup: withForm ? { formId, attendanceModes: modes, showOnTicket: onTicket } : null,
        }),
      () => {
        if (!withForm) {
          setFormId("");
          setShortUrl(null);
          setQr(null);
        }
        show(withForm ? "Registration form saved" : "Back to one-click registration");
      },
    );

  const makeShortLink = () =>
    run(
      () => createEventShortLinkAction({ id: event.id, version }),
      ({ shortUrl: url }: { shortUrl: string; version: number }) => {
        setShortUrl(url);
        void QRCode.toDataURL(url, { errorCorrectionLevel: "H", margin: 4 }).then(setQr);
      },
    );

  const loadPeople = async () => {
    setBusy(true);
    const result = await listEventRegistrantsAction({ eventId: event.id });
    setBusy(false);
    if (!result.ok) show(actionMessage(result));
    else setPeople(result.data);
  };

  const columns: Column<RegistrantRow>[] = [
    { key: "name", header: "Name", render: (r) => r.name || r.email },
    { key: "email", header: "Email", render: (r) => r.email },
    { key: "status", header: "Status", render: (r) => r.status },
    { key: "mode", header: "Attends", render: (r) => r.attendanceMode ?? "" },
    ...(people?.columns ?? []).map((header, i) => ({
      key: `a${i}`,
      header,
      render: (r: RegistrantRow) => r.answers[i] ?? "",
    })),
  ];

  return (
    <fieldset className="admin-form-grid__full admin-event-registration">
      <legend className="admin-field__label">Registration form</legend>
      {canEdit ? (
        <>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="event-reg-form">
              Questions people answer to register
            </label>
            <Select id="event-reg-form" value={formId} onChange={(e) => setFormId(e.target.value)}>
              <option value="">No form: one-click registration</option>
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title} ({f.status})
                </option>
              ))}
            </Select>
          </div>
          {formId ? (
            <>
              <div className="admin-question__flags">
                {ATTENDANCE_MODES.map((m) => (
                  <label key={m} className="admin-check-label">
                    <input
                      type="checkbox"
                      checked={modes.includes(m)}
                      onChange={(e) =>
                        setModes(e.target.checked ? [...modes, m] : modes.filter((x) => x !== m))
                      }
                    />
                    {m === "online" ? "Online" : "On site"}
                  </label>
                ))}
              </div>
              <div className="admin-field">
                <label className="admin-field__label" htmlFor="event-reg-ticket">
                  Note on the ticket (e.g. what to bring)
                </label>
                <input
                  id="event-reg-ticket"
                  className="admin-input"
                  type="text"
                  maxLength={200}
                  value={onTicket}
                  onChange={(e) => setOnTicket(e.target.value)}
                />
              </div>
            </>
          ) : null}
          <div className="admin-form-actions">
            <Button
              variant="outline"
              size="sm"
              icon="check"
              disabled={busy || (formId === "" && saved === null)}
              onClick={() => void save(formId !== "")}
            >
              {formId === "" ? "Remove the form" : "Save form"}
            </Button>
            {saved ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void makeShortLink()}
                >
                  {shortUrl ? "Show short link and QR" : "Create short link and QR"}
                </Button>
                <a className="admin-link" href={practiceUrl} target="_blank" rel="noreferrer">
                  Try the form
                </a>
              </>
            ) : null}
          </div>
          {shortUrl ? (
            <p className="admin-event-registration__link">
              <a className="admin-link" href={shortUrl} target="_blank" rel="noreferrer">
                {shortUrl}
              </a>
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing to optimise
                <img src={qr} alt={`QR code for ${shortUrl}`} width={160} height={160} />
              ) : null}
            </p>
          ) : null}
        </>
      ) : null}
      {saved && canSeeRegistrants ? (
        <>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void loadPeople()}>
            {people ? "Refresh registrants" : "Show registrants"}
          </Button>
          {people ? (
            <DataTable
              columns={columns}
              rows={[...people.rows]}
              rowKey={(r) => r.userId}
              emptyText="Nobody has registered yet"
            />
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}
