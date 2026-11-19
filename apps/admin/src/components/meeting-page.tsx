"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ATTENDANCE_STATE_LABELS,
  MEETING_ROLE_LABELS,
  MEETING_STATUS_LABELS,
  type AttendanceState,
  type AttendanceStatus,
  type MeetingRole,
  type MeetingStatus,
} from "@website/domain/meetings";
import {
  cancelMeetingAction,
  logAttendanceExportAction,
  markAttendanceAction,
  openCodeAction,
  saveRoomAction,
} from "@/app/(panel)/meetings/actions";
import { actionMessage } from "@/components/action-message";
import { downloadCsv } from "@/components/csv";
import { attendanceCsv } from "@/components/exports-model";
import { formatInZone } from "@/components/format";
import { MeetingForm, MEETING_STATUS_TONE, type MeetingValues } from "@/components/meetings-page";
import { DraftMinutes } from "@/components/draft-minutes";
import { MinutesPanel, type ActionItemView, type MinutesView } from "@/components/minutes-panel";
import { ChoiceField, Field, FormModal, NotifyField, text } from "@/components/program-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { Column } from "@/components/ui/data-table";
import {
  ListCard,
  ListEmpty,
  SearchBox,
  SelectCheckbox,
  Tabs,
  useListTable,
} from "@/components/ui/list-controls";
import { Modal } from "@/components/ui/modal";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";

export interface MeetingView {
  id: string;
  version: number;
  periodId: string;
  title: string;
  description: string;
  unitName: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  status: MeetingStatus;
  started: boolean;
  externalUrl: string | null;
  zoomRequestId: string | null;
  zoomBookings: Array<{ id: string; label: string }>;
  zoomSummaries: Array<{
    at: string;
    title: string;
    overview: string;
    details: ReadonlyArray<{ label: string; summary: string }>;
    nextSteps: readonly string[];
    folded: boolean;
  }>;
  cancelReason: string | null;
  agenda: string[];
  agendaItems: Array<{ id: string; title: string }>;
  minutes: MinutesView | null;
  actionItems: ActionItemView[];
  participants: Array<{
    uid: string;
    name: string;
    role: MeetingRole;
    presentAt: string | null;
    method: "code" | "manual" | null;
    state: AttendanceState;
    note: string;
  }>;
  /** Active officers of the period who are not participants, for the PIC list (name has the seat). */
  officers: Array<{ uid: string; name: string }>;
  /** The viewer's own attendance; null when they are not a participant or the meeting is cancelled. */
  own: { state: AttendanceState; at: string | null; windowOpen: boolean } | null;
  /** Approved minutes freeze the attendance. */
  locked: boolean;
}

type Row = MeetingView["participants"][number] & { id: string };
type Tab = "all" | "not_yet" | "present" | "away" | "no_news";
const TAB_LABELS: Record<Tab, string> = {
  all: "All",
  not_yet: "Not yet",
  present: "Present",
  away: "Excused / Sick",
  no_news: "No news",
};
const inTab = (r: Row, tab: Tab) =>
  tab === "all" || (tab === "away" ? r.state === "excused" || r.state === "sick" : r.state === tab);

function CodeScreen({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const [code, setCode] = useState<{ code: string; qr: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const renew = async () => {
      const result = await openCodeAction({ id: meetingId });
      if (!alive) return;
      if (!result.ok) return setError(actionMessage(result));
      const qr = await QRCode.toDataURL(result.data.url, { errorCorrectionLevel: "H", margin: 4 });
      if (alive) setCode({ code: result.data.code, qr });
    };
    void renew();
    const timer = setInterval(() => void renew(), 90_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [meetingId]);
  return (
    <Modal open title="Attendance code" onClose={onClose}>
      {error ? <p role="alert">{error}</p> : null}
      {code ? (
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: "3rem", letterSpacing: "0.3em", fontWeight: 700 }}>{code.code}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing to optimise */}
          <img
            src={code.qr}
            alt={`QR code for attendance code ${code.code}`}
            width={280}
            height={280}
          />
          <p className="admin-page-header__desc">
            Participants scan the QR or type the code on the website (Attendance). It changes every
            90 seconds.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

export function MeetingPage({
  meeting: m,
  runs,
  canApprove,
  canDraft,
  edit,
}: {
  meeting: MeetingView;
  canApprove: boolean;
  canDraft: boolean;
  runs: boolean;
  edit: { units: Array<{ id: string; name: string }>; values: MeetingValues } | null;
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const [editing, setEditing] = useState(false);
  const [room, setRoom] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [screen, setScreen] = useState(false);

  const exportAttendance = async () => {
    const result = await logAttendanceExportAction({ rows: m.participants.length });
    if (!result.ok) {
      toast.show(actionMessage(result));
      return;
    }
    downloadCsv(`attendance-${m.id}`, attendanceCsv(m.participants));
  };

  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [away, setAway] = useState<"excused" | "sick" | null>(null);
  const canMark = runs && !m.locked;

  const rows = useMemo<Row[]>(() => m.participants.map((p) => ({ ...p, id: p.uid })), [m]);
  const count = (t: Tab) => rows.filter((r) => inTab(r, t)).length;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => inTab(r, tab) && (!q || r.name.toLowerCase().includes(q)));
  }, [rows, tab, query]);
  const table = useListTable(
    visible,
    (r: Row, key: "name" | "role" | "state") =>
      key === "role" ? MEETING_ROLE_LABELS[r.role] : key === "state" ? r.state : r.name,
    undefined,
    undefined,
    25,
  );
  const presentCount = count("present");
  const unsigned = rows.filter((r) => r.state === "not_yet" || r.state === "no_news").length;

  const markSelected = async (status: AttendanceStatus | "none", note = "") => {
    setBusy(true);
    const result = await markAttendanceAction({
      id: m.id,
      version: m.version,
      uids: [...table.selected],
      status,
      note,
    });
    setBusy(false);
    if (result.ok) {
      table.clearSelection();
      router.refresh();
    }
    return result;
  };

  const columns: Column<Row>[] = [
    ...(canMark
      ? [
          {
            key: "check",
            width: "24px",
            header: (
              <SelectCheckbox
                label="Select all on page"
                checked={table.pageAll}
                indeterminate={table.pageSome && !table.pageAll}
                onChange={table.togglePage}
              />
            ),
            render: (r: Row) => (
              <SelectCheckbox
                label={`Select ${r.name}`}
                checked={table.selected.has(r.id)}
                onChange={() => table.toggle(r.id)}
              />
            ),
          },
        ]
      : []),
    {
      key: "name",
      header: table.header("name", "Participant"),
      render: (p) => <span className="admin-table__title">{p.name}</span>,
    },
    {
      key: "role",
      header: table.header("role", "Role"),
      render: (p) => MEETING_ROLE_LABELS[p.role],
    },
    {
      key: "state",
      header: table.header("state", "Attendance"),
      render: (p) => (
        <>
          {ATTENDANCE_STATE_LABELS[p.state]}
          {p.presentAt && p.state === "present"
            ? ` · ${formatInZone(p.presentAt, m.timeZone)}${p.method === "manual" ? " (ticked)" : ""}`
            : ""}
          {p.note ? ` · ${p.note}` : ""}
        </>
      ),
    },
  ];

  return (
    <div>
      <ToastBanner message={toast.message} />
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">
            <a href="/meetings">Meetings</a> &gt; {m.title}
          </h1>
          <p className="admin-page-header__desc">
            {m.unitName} · {formatInZone(m.startsAt, m.timeZone)} –{" "}
            {formatInZone(m.endsAt, m.timeZone)} ({m.timeZone}){" "}
            <Badge tone={MEETING_STATUS_TONE[m.status]}>{MEETING_STATUS_LABELS[m.status]}</Badge>
          </p>
        </div>
        <div className="admin-page-header__actions">
          <Button
            size="sm"
            variant="outline"
            icon="download"
            href={`/api/meetings/${m.id}/minutes?sheet=attendance`}
          >
            Attendance PDF
          </Button>
          <Button size="sm" variant="outline" icon="download" onClick={() => exportAttendance()}>
            Export CSV
          </Button>
          {runs ? (
            <Button size="sm" icon="qr" onClick={() => setScreen(true)}>
              Show attendance code
            </Button>
          ) : null}
          {runs && m.status === "scheduled" ? (
            <Button size="sm" variant="outline" icon="link" onClick={() => setRoom(true)}>
              Room
            </Button>
          ) : null}
          {edit ? (
            <Button size="sm" variant="outline" icon="edit" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null}
          {runs && m.status === "scheduled" ? (
            <Button size="sm" icon="x" variant="danger" onClick={() => setCancelling(true)}>
              Cancel meeting
            </Button>
          ) : null}
        </div>
      </div>
      {m.own ? (
        <Card>
          <CardBody>
            <strong>Your attendance:</strong>{" "}
            {m.own.state === "present" && m.own.at
              ? `present ${formatInZone(m.own.at, m.timeZone)}`
              : m.own.state === "excused" || m.own.state === "sick"
                ? ATTENDANCE_STATE_LABELS[m.own.state].toLowerCase()
                : "not recorded yet"}{" "}
            <Badge tone={m.own.windowOpen ? "success" : "neutral"}>
              {m.own.windowOpen ? "Attendance is open" : "Attendance is closed"}
            </Badge>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title="Details" />
        <CardBody>
          {m.cancelReason ? <p>Cancelled: {m.cancelReason}</p> : null}
          <p>
            Room:{" "}
            {m.externalUrl ? (
              <a href={m.externalUrl} target="_blank" rel="noreferrer">
                {m.externalUrl}
              </a>
            ) : m.zoomRequestId ? (
              "Zoom booking"
            ) : (
              "not set"
            )}
          </p>
          {m.description ? <p style={{ whiteSpace: "pre-wrap" }}>{m.description}</p> : null}
          {m.agenda.length > 0 ? (
            <ol>
              {m.agenda.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ol>
          ) : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Attendance"
          subtitle={`${presentCount} of ${rows.length} present · ${
            unsigned > 0
              ? `${unsigned} participant${unsigned === 1 ? "" : "s"} not signed yet`
              : "everyone has a record"
          }`}
        />
        <CardBody>
          <SearchBox
            placeholder="Search by name..."
            label="Search participants"
            onSearch={(q) => {
              setQuery(q);
              table.setPage(1);
            }}
          />
          <Tabs
            label="Attendance lists"
            tabs={(Object.keys(TAB_LABELS) as Tab[])
              .filter((t) => t === "all" || t === tab || count(t) > 0)
              .map((t) => ({ key: t, label: TAB_LABELS[t], count: count(t) }))}
            active={tab}
            onSelect={(t) => {
              setTab(t);
              table.setPage(1);
              table.clearSelection();
            }}
          />
        </CardBody>
        <ListCard
          table={table}
          noun="participant"
          columns={columns}
          empty={
            <ListEmpty
              noun="participant"
              query={query}
              filters={0}
              emptyHint="Nobody is in this list."
              onClear={() => setQuery("")}
            />
          }
          bulkActions={
            canMark ? (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  icon="check"
                  disabled={busy || !m.started}
                  title={
                    m.started ? undefined : "Attendance can be ticked once the meeting has started"
                  }
                  onClick={async () => {
                    const result = await markSelected("present");
                    if (!result.ok) toast.show(actionMessage(result));
                  }}
                >
                  Mark present
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  icon="note"
                  disabled={busy}
                  onClick={() => setAway("excused")}
                >
                  Excused
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  icon="clock"
                  disabled={busy}
                  onClick={() => setAway("sick")}
                >
                  Sick
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  icon="x"
                  disabled={busy}
                  onClick={async () => {
                    const result = await markSelected("none");
                    if (!result.ok) toast.show(actionMessage(result));
                  }}
                >
                  Clear
                </Button>
              </>
            ) : null
          }
        />
      </Card>
      <FormModal
        open={away !== null}
        title={away === "sick" ? "Mark as sick" : "Mark as excused"}
        onClose={() => setAway(null)}
        onSubmit={(form) => markSelected(away ?? "excused", text(form, "note"))}
      >
        <Field label="Note (optional)" name="note" maxLength={200} />
      </FormModal>
      {m.zoomSummaries.length > 0 ? (
        <Card>
          <CardHeader
            title="Zoom summary"
            subtitle="Written by Zoom AI; check it before you rely on it"
          />
          <CardBody>
            {m.zoomSummaries.map((s) => (
              <details key={s.at} open={!s.folded}>
                <summary>{s.title || formatInZone(s.at, m.timeZone)}</summary>
                {s.overview ? <p style={{ whiteSpace: "pre-wrap" }}>{s.overview}</p> : null}
                {s.details.map((d) => (
                  <p key={d.label + d.summary} style={{ whiteSpace: "pre-wrap" }}>
                    {d.label ? <strong>{d.label}: </strong> : null}
                    {d.summary}
                  </p>
                ))}
                {s.nextSteps.length > 0 ? (
                  <ul>
                    {s.nextSteps.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                ) : null}
              </details>
            ))}
          </CardBody>
        </Card>
      ) : null}
      <MinutesPanel
        meetingId={m.id}
        version={m.version}
        agenda={m.agendaItems}
        minutes={m.minutes}
        items={m.actionItems}
        participants={m.participants.map((p) => ({ uid: p.uid, name: p.name }))}
        officers={m.officers}
        runs={runs}
        canApprove={canApprove}
        extra={
          runs && canDraft && !m.minutes?.approvedAt ? (
            <DraftMinutes
              meetingId={m.id}
              version={m.version}
              names={new Map(m.participants.map((p) => [p.uid, p.name]))}
              hasZoom={m.zoomRequestId !== null}
              hasSummary={m.zoomSummaries.length > 0}
            />
          ) : null
        }
      />
      {screen ? <CodeScreen meetingId={m.id} onClose={() => setScreen(false)} /> : null}
      {edit ? (
        <MeetingForm
          open={editing}
          onClose={() => setEditing(false)}
          periodId={m.periodId}
          units={edit.units}
          current={edit.values}
        />
      ) : null}
      <FormModal
        open={room}
        title="Meeting room"
        onClose={() => setRoom(false)}
        onSubmit={(form) => {
          const url = text(form, "url");
          const zoom = text(form, "zoom");
          return saveRoomAction({
            id: m.id,
            version: m.version,
            notify: form.has("notify"),
            room: zoom
              ? { kind: "zoom", zoomRequestId: zoom }
              : url
                ? { kind: "link", url }
                : { kind: "none" },
          });
        }}
      >
        <Field
          label="External link"
          name="url"
          type="url"
          hint="Google Meet, Teams or a map link; empty removes it. Saving a link clears a Zoom booking."
          defaultValue={m.externalUrl ?? ""}
        />
        <ChoiceField
          label="Or a Zoom booking"
          name="zoom"
          defaultValue={m.zoomRequestId ?? ""}
          options={[
            { value: "", label: "No Zoom (use the link above)" },
            ...m.zoomBookings.map((b) => ({ value: b.id, label: b.label })),
          ]}
        />
        <NotifyField label="Tell participants about the change" />
      </FormModal>
      <FormModal
        open={cancelling}
        title="Cancel meeting"
        submitLabel="Cancel meeting"
        onClose={() => setCancelling(false)}
        onSubmit={(form) =>
          cancelMeetingAction({
            id: m.id,
            version: m.version,
            reason: text(form, "reason"),
            notify: form.has("notify"),
          })
        }
      >
        <Field label="Reason" name="reason" rows={2} required maxLength={500} />
        <NotifyField label="Tell participants" />
      </FormModal>
    </div>
  );
}
