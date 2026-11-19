"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { utcToWallTime } from "@website/domain/shared";
import {
  cancelInterviewSlotAction,
  createInterviewPlanAction,
  createMyInterviewTimesAction,
  recordAttendanceAction,
  removeInterviewSlotAction,
  updateInterviewSlotAction,
} from "@/app/(panel)/recruitment/actions";
import { actionMessage } from "@/components/action-message";
import type { SlotItem } from "@/components/interviews-model";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldError } from "@/components/ui/field-error";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The interview times of one recruitment. The committee page (`mine` absent) manages every time;
 * "My interview times" (`mine`) opens, changes and cancels the viewer's own times for their unit.
 */
export function InterviewsPage(props: {
  recruitment: { id: string; title: string };
  slots: SlotItem[];
  canEdit: boolean;
  mine?: { units: { id: string; name: string }[] };
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const [zone] = useState(browserZone);
  const days = useMemo(
    () => [
      ...new Set(props.slots.map((s) => utcToWallTime(new Date(s.startsAt), zone).slice(0, 10))),
    ],
    [props.slots, zone],
  );
  const [day, setDay] = useState(days[0] ?? "");
  const [planning, setPlanning] = useState(false);
  const [editing, setEditing] = useState<SlotItem | null>(null);
  const [cancelling, setCancelling] = useState<SlotItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [plan, setPlan] = useState({
    date: "",
    startTime: "09:00",
    endTime: "12:00",
    durationMinutes: "30",
    gapMinutes: "10",
    breakStart: "",
    breakEnd: "",
    capacity: "1",
    location: "",
    mode: "online",
    note: "",
    bookingCutoffHours: "12",
    orgUnitId: props.mine?.units[0]?.id ?? "",
  });
  const [edit, setEdit] = useState({
    mode: "online",
    location: "",
    note: "",
    capacity: "1",
  });

  const ofDay = props.slots.filter((s) =>
    utcToWallTime(new Date(s.startsAt), zone).startsWith(day),
  );
  const mine = props.mine !== undefined;

  const done = (message: string) => {
    toast.show(message);
    router.refresh();
  };

  const create = async () => {
    setBusy(true);
    const body = {
      timeZone: zone,
      date: plan.date,
      startTime: plan.startTime,
      endTime: plan.endTime,
      durationMinutes: Number(plan.durationMinutes),
      gapMinutes: Number(plan.gapMinutes),
      breaks:
        plan.breakStart && plan.breakEnd ? [{ start: plan.breakStart, end: plan.breakEnd }] : [],
      capacity: Number(plan.capacity),
      location: plan.location,
      mode: plan.mode,
      note: plan.note,
      bookingCutoffHours: Number(plan.bookingCutoffHours),
    };
    const result = mine
      ? await createMyInterviewTimesAction({
          recruitmentId: props.recruitment.id,
          orgUnitId: plan.orgUnitId,
          plan: body,
        })
      : await createInterviewPlanAction({ recruitmentId: props.recruitment.id, plan: body });
    setBusy(false);
    if (!result.ok) {
      setFieldErrors(result.fields ?? {});
      toast.show(actionMessage(result));
      return;
    }
    setPlanning(false);
    setDay(plan.date);
    done(`${result.data.created} interview times created`);
  };

  const run = async (work: () => Promise<{ ok: boolean }>, message: string) => {
    setBusy(true);
    const result = await work();
    setBusy(false);
    if (result.ok) done(message);
    else toast.show(actionMessage(result as Parameters<typeof actionMessage>[0]));
    return result.ok;
  };

  const startEdit = (s: SlotItem) => {
    setEdit({
      mode: s.mode,
      location: s.location,
      note: s.note,
      capacity: String(s.capacity),
    });
    setEditing(s);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const ok = await run(
      () =>
        updateInterviewSlotAction({
          id: editing.id,
          mode: edit.mode,
          location: edit.location,
          note: edit.note,
          capacity: Number(edit.capacity),
        }),
      "Interview time saved",
    );
    if (ok) setEditing(null);
  };

  const confirmCancel = async () => {
    if (!cancelling) return;
    const ok = await run(
      () => cancelInterviewSlotAction({ id: cancelling.id }),
      "Interview time cancelled",
    );
    if (ok) setCancelling(null);
  };

  const record = (applicant: SlotItem["applicants"][number], attendance: string) =>
    run(
      () =>
        recordAttendanceAction({
          id: applicant.applicationId,
          choiceId: applicant.choiceId,
          attendance,
          note: "",
          version: applicant.version,
        }),
      "Attendance recorded",
    );

  const field = (key: keyof typeof plan, text: string, type = "text") => (
    <div className="admin-field">
      <label className="admin-field__label" htmlFor={`plan-${key}`}>
        {text}
      </label>
      <input
        id={`plan-${key}`}
        className="admin-input"
        type={type}
        value={plan[key]}
        onChange={(e) => setPlan({ ...plan, [key]: e.target.value })}
      />
    </div>
  );

  const modeField = (value: string, set: (mode: string) => void, id: string) => (
    <div className="admin-field">
      <label className="admin-field__label" htmlFor={id}>
        Meeting
      </label>
      <Select id={id} className="admin-select" value={value} onChange={(e) => set(e.target.value)}>
        <option value="online">Online (link)</option>
        <option value="onsite">On site (address)</option>
      </Select>
    </div>
  );

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">
            {mine ? "My interview times" : "Recruitment > Interviews"}
          </h1>
          <p className="admin-page-header__desc">
            {props.recruitment.title} · times on your clock ({zone}); applicants see them on theirs.
          </p>
        </div>
        <div className="admin-page-header__actions">
          {mine ? null : (
            <Button
              variant="outline"
              size="sm"
              icon="chevronLeft"
              onClick={() => router.push("/recruitment")}
            >
              Back
            </Button>
          )}
          <div className="admin-fab">
            {props.canEdit ? (
              <Button variant="primary" size="sm" icon="plus" onClick={() => setPlanning(true)}>
                Add a day
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="admin-toolbar">
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="interview-day">
            Day
          </label>
          <input
            id="interview-day"
            className="admin-input"
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
          <FieldError
            id="interview-day-error"
            hint={
              days.length ? `Days with interviews: ${days.join(", ")}` : "No interview times yet."
            }
          />
        </div>
      </div>

      <Card className="admin-list-card">
        <CardBody>
          {ofDay.length === 0 ? (
            <span className="admin-card__subtitle">No interview times on this day.</span>
          ) : (
            <ol className="admin-detail-rounds">
              {ofDay.map((s) => (
                <li key={s.id}>
                  <strong>{utcToWallTime(new Date(s.startsAt), zone).slice(11)}</strong> ·{" "}
                  {s.durationMinutes} min · {s.booked}/{s.capacity} booked
                  {s.unitName ? ` · ${s.unitName}` : ""}
                  {!mine && s.interviewerName ? ` · ${s.interviewerName}` : ""}
                  {s.location ? ` · ${s.location}` : ""}
                  {s.note ? ` · ${s.note}` : ""}
                  {s.applicants.map((a) => (
                    <div key={`${a.applicationId}-${a.choiceId}`}>
                      {a.name}
                      {a.attendance ? ` — ${a.attendance}` : ""}
                      {s.own || props.canEdit ? (
                        <>
                          {" "}
                          <Button
                            variant="outline"
                            size="sm"
                            icon="check"
                            disabled={busy}
                            onClick={() => record(a, "attended")}
                          >
                            Attended
                          </Button>{" "}
                          <Button
                            variant="outline"
                            size="sm"
                            icon="x"
                            disabled={busy}
                            onClick={() => record(a, "absent")}
                          >
                            Absent
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ))}
                  {s.own ? (
                    <>
                      {" "}
                      <Button
                        variant="outline"
                        size="sm"
                        icon="edit"
                        disabled={busy}
                        onClick={() => startEdit(s)}
                      >
                        Change
                      </Button>{" "}
                      <Button
                        variant="outline"
                        size="sm"
                        icon="trash"
                        disabled={busy}
                        onClick={() => setCancelling(s)}
                      >
                        Cancel time
                      </Button>
                    </>
                  ) : props.canEdit && s.booked === 0 ? (
                    <>
                      {" "}
                      <Button
                        variant="outline"
                        size="sm"
                        icon="trash"
                        disabled={busy}
                        onClick={() =>
                          run(() => removeInterviewSlotAction({ id: s.id }), "Removed")
                        }
                      >
                        Remove
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      <Modal
        asForm
        open={planning}
        title="Add a day of interviews"
        subtitle={`Times on your clock (${zone}); stored in UTC.`}
        onClose={() => setPlanning(false)}
        footer={
          <div className="admin-modal__footer-row">
            <Button variant="outline" icon="chevronLeft" onClick={() => setPlanning(false)}>
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              icon="plus"
              disabled={busy}
              onClick={() => create()}
            >
              Create times
            </Button>
          </div>
        }
      >
        <div className="admin-form-grid">
          {props.mine ? (
            <div className="admin-form-grid__full admin-field">
              <label className="admin-field__label" htmlFor="plan-unit">
                Unit *
              </label>
              <Select
                id="plan-unit"
                className="admin-select"
                value={plan.orgUnitId}
                onChange={(e) => setPlan({ ...plan, orgUnitId: e.target.value })}
              >
                {props.mine.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {field("date", "Day *", "date")}
          {field("capacity", "People per time *", "number")}
          {field("startTime", "From *", "time")}
          {field("endTime", "Until *", "time")}
          {field("durationMinutes", "Minutes per interview *", "number")}
          {field("gapMinutes", "Minutes between", "number")}
          {field("breakStart", "Break from", "time")}
          {field("breakEnd", "Break until", "time")}
          {modeField(plan.mode, (mode) => setPlan({ ...plan, mode }), "plan-mode")}
          {field("bookingCutoffHours", "Booking closes (hours before)", "number")}
          <div className="admin-form-grid__full">
            {field("location", plan.mode === "online" ? "Meeting link" : "Address")}
          </div>
          <div className="admin-form-grid__full">{field("note", "Note for applicants")}</div>
        </div>
        <FieldError id="plan-error" message={fieldErrors["plan"] ?? fieldErrors["orgUnitId"]} />
      </Modal>

      <Modal
        asForm
        open={editing !== null}
        title="Change this interview time"
        subtitle={
          editing && editing.booked > 0
            ? "Someone booked it: the time stays; link, address and note can change."
            : undefined
        }
        onClose={() => setEditing(null)}
        footer={
          <div className="admin-modal__footer-row">
            <Button variant="outline" icon="chevronLeft" onClick={() => setEditing(null)}>
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              icon="check"
              disabled={busy}
              onClick={() => saveEdit()}
            >
              Save
            </Button>
          </div>
        }
      >
        <div className="admin-form-grid">
          {modeField(edit.mode, (mode) => setEdit({ ...edit, mode }), "edit-mode")}
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="edit-capacity">
              People per time
            </label>
            <input
              id="edit-capacity"
              className="admin-input"
              type="number"
              value={edit.capacity}
              onChange={(e) => setEdit({ ...edit, capacity: e.target.value })}
            />
          </div>
          <div className="admin-form-grid__full admin-field">
            <label className="admin-field__label" htmlFor="edit-location">
              {edit.mode === "online" ? "Meeting link" : "Address"}
            </label>
            <input
              id="edit-location"
              className="admin-input"
              value={edit.location}
              onChange={(e) => setEdit({ ...edit, location: e.target.value })}
            />
          </div>
          <div className="admin-form-grid__full admin-field">
            <label className="admin-field__label" htmlFor="edit-note">
              Note for applicants
            </label>
            <input
              id="edit-note"
              className="admin-input"
              value={edit.note}
              onChange={(e) => setEdit({ ...edit, note: e.target.value })}
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={cancelling !== null}
        title="Cancel this interview time?"
        confirmLabel="Cancel time"
        pending={busy}
        onCancel={() => setCancelling(null)}
        onConfirm={() => void confirmCancel()}
      >
        {cancelling && cancelling.booked > 0
          ? `${cancelling.booked} applicant(s) booked it. Their booking is cancelled and they are asked to pick another time.`
          : "No one booked this time."}
      </ConfirmDialog>
      <ToastBanner message={toast.message} />
    </div>
  );
}
