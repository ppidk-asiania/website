import {
  EVENT_LOCK_DAYS,
  approvalState,
  eventEnd,
  eventStage,
  sortedSponsors,
  type ApprovalState,
  type AttendanceMode,
  type EventEntity,
  type EventStage,
  type EventImage,
  type EventType,
  type ScheduleRow,
  type Speaker,
  type Sponsor,
} from "@website/domain/events";
import { EVENT_TYPE_LABELS, label } from "../labels";
import type { Author } from "./authors";
import { esc } from "./format";

export type EventStatus = "published" | "draft";
export type EventTab = "all" | "upcoming" | "past" | "drafts";

export interface EventItem {
  id: string;
  version: number;
  title: string;
  type: EventType;
  typeLabel: string;
  startsAt: string;
  timezone: string;
  registrationClosesAt: string | null;
  location: string;
  url: string;
  description: string;
  registrationUrl: string | null;
  banner: EventImage | null;
  status: EventStatus;
  modifiedAt: string;
  author: Author | null;
  schedule: ScheduleRow[];
  speakers: Speaker[];
  sponsors: Sponsor[];
  publishAt: string | null;
  approval: ApprovalState;
  rejectionNote: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  stage: EventStage;
  stages: StageRow[];
  finalAttendance: number | null;
  attendanceNote: string;
  recapUrl: string;
  registration: {
    formId: string;
    attendanceModes: readonly AttendanceMode[];
    showOnTicket: string;
    shortUrl: string | null;
  } | null;
}

export interface StageRow {
  key: EventStage;
  label: string;
  from: string | null;
}

const STAGE_LABELS: Record<EventStage, string> = {
  preparing: "Preparing",
  public: "Public",
  running: "Running",
  after: "After the event",
  locked: "Locked",
};

/** The five stages with the instant each one starts; preparing has no start. */
export function stageRows(e: EventEntity): StageRow[] {
  const end = eventEnd(e);
  const lock = new Date(end.getTime() + EVENT_LOCK_DAYS * 86_400_000);
  const from: Record<EventStage, Date | null> = {
    preparing: null,
    public: e.published ? (e.publishAt ?? e.updatedAt) : null,
    running: e.startsAt,
    after: end,
    locked: lock,
  };
  return (Object.keys(STAGE_LABELS) as EventStage[]).map((key) => ({
    key,
    label: STAGE_LABELS[key],
    from: from[key]?.toISOString() ?? null,
  }));
}

/** The one word the list shows: what the public sees now, or what the event waits for. */
export function statusLabel(
  e: Pick<EventItem, "status" | "approval" | "publishAt" | "cancelledAt">,
  nowIso: string,
): string {
  if (e.cancelledAt) return "Cancelled";
  if (e.status === "published") return e.publishAt && e.publishAt > nowIso ? "Scheduled" : "Public";
  return {
    none: "Private",
    pending: "Waiting for approval",
    approved: "Approved",
    rejected: "Rejected",
  }[e.approval];
}

export function matchesTab(e: EventItem, tab: EventTab, nowIso: string): boolean {
  if (tab === "all") return true;
  if (tab === "drafts") return e.status === "draft";
  if (e.status === "draft") return false;
  return tab === "upcoming" ? e.startsAt >= nowIso : e.startsAt < nowIso;
}

export function countdownLabel(startsAt: string, now: number): string | null {
  const days = Math.ceil((Date.parse(startsAt) - now) / 86_400_000);
  if (Number.isNaN(days) || days < 1) return null;
  return days === 1 ? "In 1 day" : `In ${days} days`;
}

export function toEventItem(
  e: EventEntity,
  author: Author | null,
  now: Date = new Date(),
): EventItem {
  return {
    id: e.id,
    version: e.version,
    title: e.title,
    type: e.type,
    typeLabel: label(EVENT_TYPE_LABELS, e.type),
    startsAt: e.startsAt.toISOString(),
    timezone: e.timezone,
    registrationClosesAt: e.registrationClosesAt?.toISOString() ?? null,
    location: e.location ?? "",
    url: e.slug,
    description: e.description,
    registrationUrl: e.registrationUrl,
    banner: e.bannerImage,
    status: e.published ? "published" : "draft",
    modifiedAt: e.updatedAt.toISOString(),
    author,
    schedule: [...e.schedule],
    speakers: [...e.speakers],
    sponsors: sortedSponsors(e.sponsors),
    publishAt: e.publishAt?.toISOString() ?? null,
    approval: approvalState(e),
    rejectionNote: e.rejectionNote,
    cancelledAt: e.cancelledAt?.toISOString() ?? null,
    cancelReason: e.cancelReason,
    stage: eventStage(e, now),
    stages: stageRows(e),
    finalAttendance: e.finalAttendance,
    attendanceNote: e.attendanceNote ?? "",
    recapUrl: e.recapUrl ?? "",
    registration: e.registration,
  };
}

export function eventsCsv(rows: readonly EventItem[], nowIso: string): string[][] {
  const header = [
    "Title",
    "Type",
    "Start (UTC)",
    "Location",
    "Status",
    "Modified (UTC)",
    "Modified by",
  ];
  return [
    header.map(esc),
    ...rows.map((e) =>
      [
        e.title,
        e.typeLabel,
        e.startsAt.slice(0, 16).replace("T", " "),
        e.location,
        statusLabel(e, nowIso),
        e.modifiedAt.slice(0, 16).replace("T", " "),
        e.author?.name ?? "",
      ].map(esc),
    ),
  ];
}
