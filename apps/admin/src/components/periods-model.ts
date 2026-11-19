import type { Period, PeriodStatus } from "@website/domain/organizations";

export interface PeriodItem {
  id: string;
  version: number;
  name: string;
  cabinet: string;
  coreLabel: string;
  coordinatorTitle: string;
  signerTitle: string;
  startsOn: string;
  endsOn: string;
  vision: string;
  mission: string;
  lpjDeadlineDays: number;
  status: PeriodStatus;
}

export function toPeriodItem(p: Period): PeriodItem {
  return {
    id: p.id,
    version: p.version,
    name: p.name,
    cabinet: p.cabinet,
    coreLabel: p.coreLabel,
    coordinatorTitle: p.desks.coordinator.title,
    signerTitle: p.desks.signer.title,
    startsOn: p.startsOn,
    endsOn: p.endsOn,
    vision: p.vision,
    mission: p.mission,
    lpjDeadlineDays: p.lpjDeadlineDays,
    status: p.status,
  };
}
