"use client";

import { useState } from "react";
import {
  CORE_UNIT_TYPES,
  seatLabel,
  seatsFor,
  SUGGESTED_APPOINTMENT_ROLES,
  type AppointmentRoleMap,
  type AppointmentSeat,
  type OrgUnitType,
  type UnitRoleMap,
} from "@website/domain/organizations";
import {
  appointAction,
  endAppointmentAction,
  saveAppointmentRolesAction,
  saveUnitRoleMapAction,
} from "@/app/(panel)/organizations/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Modal } from "@/components/ui/modal";
import { label, ORG_UNIT_TYPE_LABELS } from "@/labels";
import { Select } from "@/components/ui/select";

export interface AppointmentItem {
  id: string;
  version: number;
  orgUnitId: string;
  name: string;
  title: string;
  seat: AppointmentSeat;
  status: "active" | "ended" | "revoked";
  startsOn: string;
}

export interface SeatUnit {
  id: string;
  name: string;
  type: OrgUnitType;
}

export function UnitPeople(props: {
  unit: SeatUnit;
  people: AppointmentItem[];
  canEdit: boolean;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const end = async (a: AppointmentItem) => {
    setBusy(true);
    const result = await endAppointmentAction({ id: a.id, version: a.version, status: "ended" });
    setBusy(false);
    props.onDone(result.ok ? `${a.name}'s appointment ended` : actionMessage(result));
  };
  if (props.people.length === 0)
    return <p className="admin-unit-empty">No one holds a seat yet.</p>;
  return (
    <ul className="admin-form-separator__list">
      {props.people.map((a) => (
        <li key={a.id} className="admin-account__row">
          <span className="admin-table__sub">
            {a.name} — {seatLabel(a.seat, props.unit)}
            {a.title === seatLabel(a.seat, props.unit) ? "" : ` (${a.title})`} · since {a.startsOn}
          </span>
          {props.canEdit ? (
            <Button size="sm" icon="x" variant="outline" disabled={busy} onClick={() => end(a)}>
              End
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function AppointModal(props: {
  unit: SeatUnit | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [seat, setSeat] = useState<AppointmentSeat>(
    props.unit ? (seatsFor(props.unit).at(-1) ?? "head") : "member",
  );
  const [title, setTitle] = useState("");
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { unit } = props;

  const appoint = async () => {
    if (!unit) return;
    setBusy(true);
    const result = await appointAction({
      email,
      orgUnitId: unit.id,
      seat,
      title: title.trim() || seatLabel(seat, unit),
    });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.fields ?? {});
      setMessage(actionMessage(result));
      return;
    }
    props.onDone(`${email} appointed`);
  };

  return (
    <Modal
      asForm
      open={unit !== null}
      title={`Appoint to ${unit?.name ?? ""}`}
      onClose={props.onClose}
      footer={
        <div className="admin-modal__footer-row">
          <Button variant="outline" icon="chevronLeft" onClick={props.onClose}>
            Back
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon="check"
            disabled={busy}
            onClick={() => appoint()}
          >
            Appoint
          </Button>
        </div>
      }
    >
      <div className="admin-field">
        <label className="admin-field__label" htmlFor="appoint-email">
          Account e-mail *
        </label>
        <input
          id="appoint-email"
          className="admin-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby="appoint-email-error"
        />
        <FieldError
          id="appoint-email-error"
          message={errors["email"] ?? "The person signs in on the website once first."}
        />
      </div>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor="appoint-seat">
          Seat *
        </label>
        <Select
          id="appoint-seat"
          className="admin-select"
          value={seat}
          onChange={(e) => setSeat(e.target.value as AppointmentSeat)}
        >
          {(unit ? seatsFor(unit) : []).map((s) => (
            <option key={s} value={s}>
              {seatLabel(s, unit as SeatUnit)}
            </option>
          ))}
        </Select>
      </div>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor="appoint-title">
          Title
        </label>
        <input
          id="appoint-title"
          className="admin-input"
          value={title}
          placeholder={unit ? seatLabel(seat, unit) : ""}
          onChange={(e) => setTitle(e.target.value)}
          aria-describedby="appoint-title-error"
        />
        <FieldError id="appoint-title-error" message={errors["title"]} />
      </div>
      {message && (
        <p role="alert" className="admin-field__error">
          {message}
        </p>
      )}
    </Modal>
  );
}

export function RoleMapModal(props: {
  open: boolean;
  current: { map: AppointmentRoleMap; version: number } | null;
  roles: { id: string; name: string }[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [map, setMap] = useState<AppointmentRoleMap>(
    props.current?.map ?? SUGGESTED_APPOINTMENT_ROLES,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const result = await saveAppointmentRolesAction({
      map,
      version: props.current?.version ?? null,
    });
    setBusy(false);
    if (!result.ok) return setMessage(actionMessage(result));
    props.onDone("Roles from appointments saved");
  };

  const select = (text: string, value: string, onChange: (id: string) => void) => (
    <div className="admin-field" key={text}>
      <label className="admin-field__label" htmlFor={`role-map-${text}`}>
        {text}
      </label>
      <Select
        id={`role-map-${text}`}
        className="admin-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {props.roles.some((r) => r.id === value) ? null : <option value={value}>{value}</option>}
        {props.roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>
    </div>
  );

  return (
    <Modal
      asForm
      open={props.open}
      title="Roles from appointments"
      onClose={props.onClose}
      footer={
        <div className="admin-modal__footer-row">
          <Button variant="outline" icon="chevronLeft" onClick={props.onClose}>
            Back
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon="cloud"
            disabled={busy}
            onClick={() => save()}
          >
            Save
          </Button>
        </div>
      }
    >
      <p className="admin-table__sub">
        Every appointment gives the officer role; heads and secretaries also get their role for
        their unit (and the units below it); the head of a core unit gets its role for the whole
        organisation. Roles count only in the appointment&apos;s period and end with it.
      </p>
      <div className="admin-form-grid">
        {select("Every officer", map.officer, (id) => setMap((m) => ({ ...m, officer: id })))}
        {select("Unit head", map.unitHead, (id) => setMap((m) => ({ ...m, unitHead: id })))}
        {select("Unit secretary", map.unitSecretary, (id) =>
          setMap((m) => ({ ...m, unitSecretary: id })),
        )}
        {CORE_UNIT_TYPES.map((type) =>
          select(`Head of ${label(ORG_UNIT_TYPE_LABELS, type)}`, map.core[type], (id) =>
            setMap((m) => ({ ...m, core: { ...m.core, [type]: id } })),
          ),
        )}
      </div>
      {message && (
        <p role="alert" className="admin-field__error">
          {message}
        </p>
      )}
    </Modal>
  );
}

export function UnitRoleMapModal(props: {
  open: boolean;
  unit: SeatUnit & { version: number; roleMap: UnitRoleMap };
  roles: { id: string; name: string }[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { unit } = props;
  const [map, setMap] = useState<UnitRoleMap>(unit.roleMap);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (seat: AppointmentSeat, roleId: string, scope: "global" | "unit") =>
    setMap((m) => ({
      ...Object.fromEntries(Object.entries(m).filter(([key]) => key !== seat)),
      ...(roleId ? { [seat]: { roleId, scope } } : {}),
    }));

  const save = async () => {
    setBusy(true);
    const result = await saveUnitRoleMapAction({
      orgUnitId: unit.id,
      version: unit.version,
      roleMap: map,
    });
    setBusy(false);
    if (!result.ok) return setMessage(actionMessage(result));
    props.onDone("Roles from seats saved");
  };

  return (
    <Modal
      asForm
      open={props.open}
      title={`Roles from seats — ${unit.name}`}
      onClose={props.onClose}
      footer={
        <div className="admin-modal__footer-row">
          <Button variant="outline" icon="chevronLeft" onClick={props.onClose}>
            Back
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon="cloud"
            disabled={busy}
            onClick={() => save()}
          >
            Save
          </Button>
        </div>
      }
    >
      <p className="admin-table__sub">
        A seat with a role here gives that role instead of the default from Role Manager. Changing
        this does not rewrite existing assignments; it applies to the next appointment.
      </p>
      <div className="admin-form-grid">
        {seatsFor(unit).map((seat) => {
          const entry = map[seat];
          return (
            <div className="admin-field" key={seat}>
              <label className="admin-field__label" htmlFor={`unit-role-${seat}`}>
                {seatLabel(seat, unit)}
              </label>
              <Select
                id={`unit-role-${seat}`}
                className="admin-select"
                value={entry?.roleId ?? ""}
                onChange={(e) => change(seat, e.target.value, entry?.scope ?? "unit")}
              >
                <option value="">Default</option>
                {props.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
              {entry ? (
                <Select
                  aria-label={`Scope of the role of ${seatLabel(seat, unit)}`}
                  className="admin-select"
                  value={entry.scope}
                  onChange={(e) => change(seat, entry.roleId, e.target.value as "global" | "unit")}
                >
                  <option value="unit">This unit and the units below it</option>
                  <option value="global">Whole organisation</option>
                </Select>
              ) : null}
            </div>
          );
        })}
      </div>
      {message && (
        <p role="alert" className="admin-field__error">
          {message}
        </p>
      )}
    </Modal>
  );
}
