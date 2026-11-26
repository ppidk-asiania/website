import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError } from "../shared";

export const ATTENDANCE_MODES = ["online", "onsite"] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

/** The questions an event asks when someone registers (N1.2): an ordinary account-mode form. */
export interface EventRegistrationSetup {
  readonly formId: string;
  /** Empty = the event does not ask how the person attends. */
  readonly attendanceModes: readonly AttendanceMode[];
  /** Free text printed on the ticket (N1.4), for example "Bring your passport". */
  readonly showOnTicket: string;
  /** Short link to the registration page, made once (silent mode of the links module). */
  readonly shortUrl: string | null;
}

export const EventRegistrationSetupSchema = z
  .object({
    formId: safeId,
    attendanceModes: z
      .array(z.enum(ATTENDANCE_MODES))
      .max(ATTENDANCE_MODES.length)
      .refine((modes) => new Set(modes).size === modes.length, "Each mode once."),
    showOnTicket: safeText(200, { allowEmpty: true }),
  })
  .strict();

/** What the registration keeps next to the status: how the person attends and which response holds the answers. */
export interface RegistrationDetails {
  readonly attendanceMode: AttendanceMode | null;
  readonly responseId: string | null;
  readonly formVersion: number | null;
}

export function assertAttendanceMode(
  setup: Pick<EventRegistrationSetup, "attendanceModes">,
  mode: AttendanceMode | null,
): void {
  if (setup.attendanceModes.length === 0) {
    if (mode !== null) throw new RuleViolationError("This event does not ask how you attend.");
    return;
  }
  if (mode === null || !setup.attendanceModes.includes(mode)) {
    throw new RuleViolationError("Choose how you attend.");
  }
}

export const isAttendanceMode = (value: unknown): value is AttendanceMode =>
  (ATTENDANCE_MODES as readonly unknown[]).includes(value);
