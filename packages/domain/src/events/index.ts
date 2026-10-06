import type { EntityMeta } from "../shared";

export interface EventEntity extends EntityMeta {
  readonly slug: string;
  readonly title: string;
  readonly summary: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly timezone: string;
  readonly location: string | null;
  readonly chapterId: string | null;
  readonly published: boolean;
  readonly capacity: number | null;
  readonly registrationClosesAt: Date | null;
}

export function isRegistrationOpen(
  event: Pick<EventEntity, "published" | "deletedAt" | "startsAt" | "registrationClosesAt">,
  now: Date,
): boolean {
  if (!event.published || event.deletedAt !== null) return false;
  const closesAt = event.registrationClosesAt ?? event.startsAt;
  return now < closesAt;
}

export type RegistrationStatus = "confirmed" | "waitlisted" | "cancelled";

/**
 * A registration links a signed-in user to an event. Personal data is NOT copied here:
 * it lives once in `memberProfiles/{uid}` and is joined for authorized staff only.
 * Stored at `eventRegistrations/{eventId}_{userId}` so one user registers at most once
 * per event (enforced by the document id inside a transaction).
 */
export interface EventRegistration {
  readonly id: string;
  readonly eventId: string;
  readonly userId: string;
  readonly status: RegistrationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function registrationId(eventId: string, userId: string): string {
  return `${eventId}_${userId}`;
}

/** Capacity rule: confirmed while seats remain, otherwise waitlisted. */
export function nextRegistrationStatus(
  event: Pick<EventEntity, "capacity">,
  confirmedCount: number,
): RegistrationStatus {
  return event.capacity === null || confirmedCount < event.capacity ? "confirmed" : "waitlisted";
}

export interface EventReader {
  listPublished(input: {
    chapterId?: string;
    updatedSince?: Date;
    cursor?: string;
    limit: number;
  }): Promise<{
    items: EventEntity[];
    nextCursor: string | null;
  }>;
  findById(id: string): Promise<EventEntity | null>;
}

/** Zoom (or another provider) behind a port; called synchronously with a timeout. */
export interface MeetingProvider {
  createMeeting(input: {
    topic: string;
    startsAt: Date;
    durationMinutes: number;
    timezone: string;
  }): Promise<{
    meetingId: string;
    joinUrl: string;
  }>;
}

/** Calendar output is an ICS feed, not a two-way integration. */
export interface CalendarFeed {
  render(events: readonly EventEntity[]): string;
}
