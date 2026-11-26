import type { CommitteeSeat } from "./committee";

const SEAT_LABELS: Record<CommitteeSeat, string> = {
  head: "Head",
  deputy: "Deputy head",
  secretary: "Secretary",
  treasurer: "Treasurer",
  member: "Member",
};

/** The role text of a committee certificate: "Head of Logistics, <event>". One function for every sheet. */
export const committeeTitle = (seat: CommitteeSeat, division: string, eventTitle: string): string =>
  `${SEAT_LABELS[seat]} of ${division}, ${eventTitle}`;
