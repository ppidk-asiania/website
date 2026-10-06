import type { EntityMeta } from "../shared";

export interface PlatformEvent extends EntityMeta {
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
  event: Pick<PlatformEvent, "published" | "deletedAt" | "startsAt" | "registrationClosesAt">,
  now: Date,
): boolean {
  if (!event.published || event.deletedAt !== null) return false;
  const closesAt = event.registrationClosesAt ?? event.startsAt;
  return now < closesAt;
}

export interface EventReader {
  listPublished(input: {
    chapterId?: string;
    updatedSince?: Date;
    cursor?: string;
    limit: number;
  }): Promise<{
    items: PlatformEvent[];
    nextCursor: string | null;
  }>;
  findById(id: string): Promise<PlatformEvent | null>;
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
  render(events: readonly PlatformEvent[]): string;
}
