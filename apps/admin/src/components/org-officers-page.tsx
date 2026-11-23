"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { UnitRoleMap } from "@website/domain/organizations";
import {
  AppointModal,
  UnitPeople,
  UnitRoleMapModal,
  type AppointmentItem,
  type SeatUnit,
} from "@/components/appointment-forms";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/list-controls";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { ORG_SUBTITLE } from "./organizations-page";

export function UnitTabs({
  periodId,
  unitId,
  active,
}: {
  periodId: string;
  unitId: string;
  active: "unit" | "officers";
}) {
  const router = useRouter();
  const base = `/organizations/periods/${periodId}/units/${unitId}`;
  return (
    <Tabs
      label="Unit"
      tabs={[
        { key: "unit", label: "Unit" },
        { key: "officers", label: "Officers" },
      ]}
      active={active}
      onSelect={(key) => router.push(key === "unit" ? base : `${base}/officers`)}
    />
  );
}

interface Props {
  periodId: string;
  unit: SeatUnit & { version: number; roleMap: UnitRoleMap };
  people: AppointmentItem[];
  roles: { id: string; name: string }[] | null;
  canEdit: boolean;
  archived: boolean;
}

export function OrgOfficersPage({ periodId, unit, people, roles, canEdit, archived }: Props) {
  const router = useRouter();
  const toast = useToastMessage();
  const [appointing, setAppointing] = useState(false);
  const [mapping, setMapping] = useState(false);
  const done = (message: string) => {
    setAppointing(false);
    setMapping(false);
    router.refresh();
    toast.show(message);
  };
  const editable = canEdit && !archived;

  return (
    <div>
      <div className="admin-page-header admin-unit-header">
        <div>
          <h1 className="admin-page-header__title">
            Organizations &gt; Period &gt; Structure &gt; {unit.name} &gt; Officers
          </h1>
          <p className="admin-page-header__desc">
            {ORG_SUBTITLE}
            {archived ? " · Archived period (read-only)" : ""}
          </p>
        </div>
        <div className="admin-page-header__actions">
          {roles && !archived ? (
            <Button variant="outline" size="sm" icon="shield" onClick={() => setMapping(true)}>
              Roles from seats
            </Button>
          ) : null}
          {editable ? (
            <Button variant="primary" size="sm" icon="plus" onClick={() => setAppointing(true)}>
              Appoint
            </Button>
          ) : null}
        </div>
      </div>
      <UnitTabs periodId={periodId} unitId={unit.id} active="officers" />
      <section className="admin-unit-section">
        <UnitPeople unit={unit} people={people} canEdit={editable} onDone={done} />
      </section>
      <div className="admin-unit-footer">
        <Button
          variant="outline"
          size="sm"
          icon="chevronLeft"
          href={`/organizations/periods/${periodId}`}
        >
          Back
        </Button>
      </div>
      {editable ? (
        <AppointModal
          key={String(appointing)}
          unit={appointing ? unit : null}
          onClose={() => setAppointing(false)}
          onDone={done}
        />
      ) : null}
      {roles ? (
        <UnitRoleMapModal
          key={unit.version}
          open={mapping}
          unit={unit}
          roles={roles}
          onClose={() => setMapping(false)}
          onDone={done}
        />
      ) : null}
      <ToastBanner message={toast.message} />
    </div>
  );
}
