/** What a Zoom session adds to a booking: a stored AI summary, and the "empty session" test. */

export interface ZoomSummary {
  readonly title: string;
  readonly overview: string;
  readonly details: ReadonlyArray<{ readonly label: string; readonly summary: string }>;
  readonly nextSteps: readonly string[];
  readonly at: Date;
}

const MIN_REAL_MINUTES = 5;

const object = (payload: unknown): Record<string, unknown> | null => {
  const found = (payload as { object?: unknown } | null)?.object;
  return found && typeof found === "object" ? (found as Record<string, unknown>) : null;
};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The summary of a `meeting.summary_completed` payload; null when it has no content (a title alone is empty). */
export function summaryContent(payload: unknown): Omit<ZoomSummary, "at"> | null {
  const o = object(payload);
  if (!o) return null;
  const overview = text(o["summary_overview"]);
  const details = list(o["summary_details"])
    .map((d) => ({
      label: text((d as { label?: unknown } | null)?.label),
      summary: text((d as { summary?: unknown } | null)?.summary),
    }))
    .filter((d) => d.summary !== "");
  const nextSteps = list(o["next_steps"]).map(text).filter(Boolean);
  if (!overview && details.length === 0 && nextSteps.length === 0) return null;
  return { title: text(o["summary_title"]), overview, details, nextSteps };
}

/** True only on proof; a field Zoom did not send never counts. */
export function recordingIsEmpty(payload: unknown): boolean {
  const o = object(payload);
  if (!o) return false;
  const duration = o["duration"];
  if (typeof duration === "number" && duration < MIN_REAL_MINUTES) return true;
  if (o["recording_count"] === 0) return true;
  const files = list(o["recording_files"]) as Array<Record<string, unknown>>;
  if (files.length === 0) return false;
  const playable = (f: Record<string, unknown>) => {
    const type = (text(f["file_type"]) || text(f["file_extension"]) || "MP4").toUpperCase();
    const size = f["file_size"];
    const minutes =
      (Date.parse(String(f["recording_end"])) - Date.parse(String(f["recording_start"]))) / 60_000;
    return (
      (type === "MP4" || type === "M4A") &&
      !(typeof size === "number" && size <= 0) &&
      !(minutes < MIN_REAL_MINUTES)
    );
  };
  return !files.some(playable);
}

/** The summary as plain text, for the minutes drafter. */
export const summaryText = (s: ZoomSummary): string =>
  [
    s.title,
    s.overview,
    ...s.details.map((d) => `${d.label ? `${d.label}: ` : ""}${d.summary}`),
    s.nextSteps.length ? `Next steps:\n${s.nextSteps.map((n) => `- ${n}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

/** The meeting page folds a long summary: more than three parts or 800 characters. */
export const summaryFolded = (s: ZoomSummary): boolean =>
  (s.overview ? 1 : 0) + s.details.length + s.nextSteps.length > 3 || summaryText(s).length > 800;
