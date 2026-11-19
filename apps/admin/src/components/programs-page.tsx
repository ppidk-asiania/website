"use client";

import { useState } from "react";
import type { PeriodStatus } from "@website/domain/organizations";
import type { HealthStatus, ProgramStatus } from "@website/domain/programs";
import { requestRevisionAction, saveProgramAction } from "@/app/(panel)/programs/actions";
import {
  budgetText,
  ChoiceField,
  Field,
  FormModal,
  parseBudgets,
  PeriodSwitch,
  text,
} from "@/components/program-ui";
import { downloadCsv } from "@/components/csv";
import { programsCsv } from "@/components/exports-model";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Column } from "@/components/ui/data-table";
import { ListCard, ListEmpty, SortMenu, useListTable } from "@/components/ui/list-controls";
import { HEALTH_STATUS_LABELS, label, PROGRAM_STATUS_LABELS } from "@/labels";

export const HEALTH_TONE: Record<HealthStatus, BadgeTone> = {
  on_track: "success",
  at_risk: "warn",
  off_track: "danger",
};

type SortKey = "name" | "status" | "progress" | "health";
const sortValue = (r: Row, key: SortKey): string | number =>
  key === "name"
    ? r.name.toLowerCase()
    : key === "progress"
      ? r.progress
      : key === "status"
        ? label(PROGRAM_STATUS_LABELS, r.status)
        : r.health
          ? label(HEALTH_STATUS_LABELS, r.health)
          : "—";

interface Row {
  id: string;
  name: string;
  unitName: string;
  status: ProgramStatus;
  progress: number;
  health: HealthStatus | null;
  mine: boolean;
  milestones: Array<{ title: string; dueOn: string | null; done: boolean }>;
}

export interface PlanOptions {
  units: Array<{ id: string; name: string }>;
  keyResults: Array<{ value: string; label: string }>;
}

export interface PlanValues {
  id: string;
  version: number;
  name: string;
  goal: string;
  description: string;
  orgUnitId: string;
  keyResultIds: string[];
  plannedStart: string | null;
  plannedEnd: string | null;
  budgets: Array<{ amountMinor: number; currency: string }>;
  picEmails: string[];
}

/** The plan fields that are locked once the programme is approved. */
const CORE = [
  "name",
  "orgUnitId",
  "goal",
  "plannedStart",
  "plannedEnd",
  "budgets",
  "keyResultIds",
] as const;

const readPlan = (form: FormData) => ({
  name: text(form, "name"),
  goal: text(form, "goal"),
  description: text(form, "description"),
  orgUnitId: text(form, "orgUnitId"),
  keyResultIds: form.getAll("keyResultIds").map(String),
  plannedStart: text(form, "plannedStart") || null,
  plannedEnd: text(form, "plannedEnd") || null,
  budgets: parseBudgets(text(form, "budgets")),
});

/**
 * `plan`: every field. `locked` (approved programme): background and PICs only.
 * `revision`: the locked fields, sent as a request that someone else decides.
 */
export function PlanForm({
  open,
  onClose,
  periodId,
  options,
  current,
  mode = "plan",
}: {
  open: boolean;
  onClose: () => void;
  periodId: string;
  options: PlanOptions;
  current: PlanValues | null;
  mode?: "plan" | "locked" | "revision";
}) {
  const core = mode !== "locked";
  const free = mode !== "revision";
  return (
    <FormModal
      open={open}
      title={
        mode === "revision"
          ? "Request a plan revision"
          : mode === "locked"
            ? "Edit details"
            : current
              ? "Edit programme"
              : "Add New Programme"
      }
      submitLabel={mode === "revision" ? "Send request" : "Save"}
      onClose={onClose}
      onSubmit={(form) => {
        const typed = readPlan(form);
        if (mode === "revision" && current) {
          const changes = Object.fromEntries(
            CORE.filter((k) =>
              k === "budgets"
                ? budgetText(typed.budgets) !== budgetText(current.budgets)
                : JSON.stringify(typed[k]) !== JSON.stringify(current[k]),
            ).map((k) => [k, typed[k]]),
          );
          return requestRevisionAction({ id: current.id, changes, reason: text(form, "reason") });
        }
        const plan =
          mode === "locked" && current
            ? {
                ...Object.fromEntries(CORE.map((k) => [k, current[k]])),
                description: typed.description,
              }
            : typed;
        return saveProgramAction({
          ...(current ? { id: current.id } : {}),
          version: current?.version ?? null,
          periodId,
          plan,
          picEmails: text(form, "pics")
            .split(/[\s,]+/)
            .filter(Boolean),
        });
      }}
    >
      {core ? (
        <>
          <Field
            label="Name"
            name="name"
            required
            minLength={3}
            maxLength={200}
            defaultValue={current?.name ?? ""}
          />
          <ChoiceField
            label="Unit"
            name="orgUnitId"
            defaultValue={current?.orgUnitId ?? options.units[0]?.id ?? ""}
            options={options.units.map((u) => ({ value: u.id, label: u.name }))}
          />
          <div className="admin-field">
            <span className="admin-field__label">Key results (up to 10)</span>
            {options.keyResults.length === 0 ? <p>No key results in this period yet.</p> : null}
            {options.keyResults.map((k) => (
              <label key={k.value} className="admin-check-label">
                <input
                  type="checkbox"
                  name="keyResultIds"
                  value={k.value}
                  defaultChecked={current?.keyResultIds.includes(k.value) ?? false}
                />
                {k.label}
              </label>
            ))}
          </div>
          <Field
            label="Goal"
            name="goal"
            rows={2}
            maxLength={2000}
            defaultValue={current?.goal ?? ""}
          />
          <Field
            label="Planned start"
            name="plannedStart"
            type="date"
            defaultValue={current?.plannedStart ?? ""}
          />
          <Field
            label="Planned end"
            name="plannedEnd"
            type="date"
            defaultValue={current?.plannedEnd ?? ""}
          />
          <Field
            label="Budget"
            name="budgets"
            rows={3}
            hint="One line per currency, e.g. JPY 50000 (never converted)"
            defaultValue={budgetText(current?.budgets ?? [])}
          />
        </>
      ) : null}
      {free ? (
        <>
          <Field
            label="Background"
            name="description"
            rows={3}
            maxLength={4000}
            defaultValue={current?.description ?? ""}
          />
          <Field
            label="PICs (account e-mails)"
            name="pics"
            rows={2}
            hint="Needed before approval; PICs run the programme"
            defaultValue={(current?.picEmails ?? []).join("\n")}
          />
        </>
      ) : (
        <Field
          label="Why must the plan change?"
          name="reason"
          rows={3}
          required
          maxLength={1000}
          hint="Someone with programme approval decides; you cannot decide your own request."
        />
      )}
    </FormModal>
  );
}

export function ProgramsPage({
  period,
  periods,
  rows,
  plan,
}: {
  period: { id: string; name: string; status: PeriodStatus } | null;
  periods: Array<{ id: string; name: string }>;
  rows: Row[];
  plan: PlanOptions | null;
}) {
  const [adding, setAdding] = useState(false);
  const table = useListTable(rows, sortValue);
  if (!period) {
    return (
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Programmes</h1>
          <p className="admin-page-header__desc">Create a board period first (Organizations).</p>
        </div>
      </div>
    );
  }
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: table.header("name", "Programme"),
      width: "40%",
      render: (r) => (
        <div>
          <a className="admin-table__title" href={`/programs/${r.id}`}>
            {r.name}
          </a>
          <div className="admin-table__sub">
            {r.unitName}
            {r.mine ? " · You are PIC" : ""}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: table.header("status", "Status"),
      render: (r) => <Badge>{label(PROGRAM_STATUS_LABELS, r.status)}</Badge>,
    },
    {
      key: "progress",
      header: table.header("progress", "Progress"),
      render: (r) => <span className="admin-table__title">{r.progress}%</span>,
    },
    {
      key: "health",
      header: table.header("health", "Health"),
      render: (r) =>
        r.health ? (
          <Badge tone={HEALTH_TONE[r.health]}>{label(HEALTH_STATUS_LABELS, r.health)}</Badge>
        ) : (
          "—"
        ),
    },
  ];
  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Programmes</h1>
          <p className="admin-page-header__desc">
            Work programmes of period {period.name}
            {period.status === "archived" ? " · Archived period" : ""}
          </p>
        </div>
        <div className="admin-page-header__actions">
          <Button
            variant="outline"
            size="sm"
            icon="chart"
            href={`/programs/report?period=${period.id}`}
          >
            Report card
          </Button>
          <div className="admin-fab">
            <Button
              variant="outline"
              size="sm"
              icon="download"
              onClick={() => downloadCsv(`programmes-${period.id}`, programsCsv(rows))}
            >
              Export CSV
            </Button>
            {plan ? (
              <Button variant="primary" size="sm" icon="plus" onClick={() => setAdding(true)}>
                Add New Programme
              </Button>
            ) : null}
          </div>
          <PeriodSwitch path="/programs" current={period.id} periods={periods} />
          <SortMenu columns={columns} />
        </div>
      </div>
      <ListCard
        table={table}
        noun="programme"
        columns={columns}
        empty={
          <ListEmpty
            noun="programme"
            query=""
            filters={table.filterCount}
            emptyHint="Nothing in this period yet."
            onClear={table.clearFilters}
          />
        }
      />
      {plan ? (
        <PlanForm
          open={adding}
          onClose={() => setAdding(false)}
          periodId={period.id}
          options={plan}
          current={null}
        />
      ) : null}
    </div>
  );
}
