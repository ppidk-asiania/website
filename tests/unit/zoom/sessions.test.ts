import { describe, expect, it } from "vitest";
import {
  recordingIsEmpty,
  summaryContent,
  summaryFolded,
  summaryText,
  type ZoomSummary,
} from "@website/domain/zoom";

// Real `meeting.summary_completed` shape: payload.object uses meeting_id / meeting_uuid.
const summary = (over: Record<string, unknown> = {}) => ({
  account_id: "acc",
  object: {
    meeting_host_id: "host",
    meeting_host_email: "host@example.org",
    meeting_uuid: "4444AAAiAAAAAiAiAiiAii==",
    meeting_id: 97763643886,
    meeting_topic: "Rapat kerja",
    meeting_start_time: "2026-11-10T10:00:00Z",
    meeting_end_time: "2026-11-10T11:00:00Z",
    summary_start_time: "2026-11-10T10:00:00Z",
    summary_end_time: "2026-11-10T11:00:00Z",
    summary_created_time: "2026-11-10T11:05:00Z",
    summary_last_modified_time: "2026-11-10T11:05:00Z",
    summary_title: "Rapat kerja",
    summary_overview: "We agreed the budget.",
    summary_details: [{ label: "Budget", summary: "Approved 5 jt." }],
    next_steps: ["Send the letter"],
    ...over,
  },
});

// Real `recording.completed` shape: payload.object uses id / uuid, duration in minutes.
const file = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  meeting_id: "4444AAAiAAAAAiAiAiiAii==",
  recording_start: "2026-11-10T10:00:00Z",
  recording_end: "2026-11-10T10:30:00Z",
  file_type: "MP4",
  file_extension: "MP4",
  file_size: 1000,
  status: "completed",
  recording_type: "shared_screen_with_speaker_view",
  ...over,
});
const recording = (over: Record<string, unknown> = {}) => ({
  account_id: "acc",
  object: {
    id: 97763643886,
    uuid: "4444AAAiAAAAAiAiAiiAii==",
    host_id: "host",
    topic: "Rapat kerja",
    start_time: "2026-11-10T10:00:00Z",
    duration: 30,
    total_size: 1000,
    recording_count: 2,
    recording_files: [file(), file({ id: "f2", file_type: "TRANSCRIPT", file_extension: "VTT" })],
    ...over,
  },
});

describe("summaryContent", () => {
  it("reads the real payload", () => {
    expect(summaryContent(summary())).toEqual({
      title: "Rapat kerja",
      overview: "We agreed the budget.",
      details: [{ label: "Budget", summary: "Approved 5 jt." }],
      nextSteps: ["Send the letter"],
    });
  });

  it("is null when only a title is there, or nothing is", () => {
    const blank = { summary_overview: "  ", summary_details: [], next_steps: [] };
    expect(summaryContent(summary(blank))).toBeNull();
    expect(
      summaryContent(
        summary({ ...blank, summary_details: [{ label: "x", summary: " " }], next_steps: [" "] }),
      ),
    ).toBeNull();
    expect(summaryContent(summary({ summary_title: undefined, ...blank }))).toBeNull();
    expect(summaryContent(null)).toBeNull();
    expect(summaryContent({ object: "x" })).toBeNull();
  });

  it("any one of overview, next step or detail is enough; empty parts are dropped", () => {
    const none = { summary_overview: "", summary_details: [], next_steps: [] };
    expect(summaryContent(summary({ ...none, next_steps: ["", "Call"] }))?.nextSteps).toEqual([
      "Call",
    ]);
    expect(
      summaryContent(summary({ ...none, summary_details: [{ label: "A", summary: "text" }] })),
    ).not.toBeNull();
    expect(summaryContent(summary({ ...none, summary_overview: "Short" }))?.title).toBe(
      "Rapat kerja",
    );
  });
});

describe("recordingIsEmpty", () => {
  it("is false for a normal recording and when Zoom sent no evidence", () => {
    expect(recordingIsEmpty(recording())).toBe(false);
    expect(recordingIsEmpty({ object: { id: 1, uuid: "u" } })).toBe(false);
    expect(recordingIsEmpty(null)).toBe(false);
    expect(recordingIsEmpty(recording({ duration: undefined, recording_count: undefined }))).toBe(
      false,
    );
    expect(recordingIsEmpty(recording({ recording_files: [] }))).toBe(false);
  });

  it("is true under 5 minutes, or with no recordings", () => {
    expect(recordingIsEmpty(recording({ duration: 4 }))).toBe(true);
    expect(recordingIsEmpty(recording({ duration: 0 }))).toBe(true);
    expect(recordingIsEmpty(recording({ duration: 5 }))).toBe(false);
    expect(recordingIsEmpty(recording({ recording_count: 0 }))).toBe(true);
  });

  it("is true when files are listed and none is playable", () => {
    const only = (...files: unknown[]) => recording({ recording_files: files });
    expect(recordingIsEmpty(only(file({ file_type: "TRANSCRIPT" })))).toBe(true);
    expect(recordingIsEmpty(only(file({ file_size: 0 })))).toBe(true);
    expect(recordingIsEmpty(only(file({ recording_end: "2026-11-10T10:04:00Z" })))).toBe(true);
    expect(recordingIsEmpty(only(file({ file_type: "M4A" })))).toBe(false);
    expect(recordingIsEmpty(only(file({ file_size: 0 }), file({ id: "f2" })))).toBe(false);
  });

  it("a field Zoom did not send is not proof", () => {
    const only = (f: Record<string, unknown>) => recording({ recording_files: [f] });
    expect(recordingIsEmpty(only({ id: "f" }))).toBe(false);
    expect(recordingIsEmpty(only(file({ recording_start: undefined })))).toBe(false);
    expect(recordingIsEmpty(only(file({ file_size: undefined })))).toBe(false);
    expect(recordingIsEmpty(only(file({ file_type: undefined, file_extension: "MP4" })))).toBe(
      false,
    );
  });
});

describe("summaryText and summaryFolded", () => {
  const base: ZoomSummary = {
    title: "T",
    overview: "O",
    details: [{ label: "L", summary: "S" }],
    nextSteps: ["N"],
    at: new Date("2026-11-10T11:00:00Z"),
  };
  it("writes the summary as plain text for the drafter", () => {
    expect(summaryText(base)).toBe("T\n\nO\n\nL: S\n\nNext steps:\n- N");
    expect(summaryText({ ...base, details: [{ label: "", summary: "S" }], nextSteps: [] })).toBe(
      "T\n\nO\n\nS",
    );
  });
  it("folds above three parts or 800 characters", () => {
    expect(summaryFolded(base)).toBe(false);
    expect(summaryFolded({ ...base, overview: "", nextSteps: ["a", "b"] })).toBe(false);
    expect(summaryFolded({ ...base, nextSteps: ["a", "b", "c"] })).toBe(true);
    const long = (n: number) => ({
      ...base,
      title: "",
      details: [],
      nextSteps: [],
      overview: "x".repeat(n),
    });
    expect(summaryFolded(long(800))).toBe(false);
    expect(summaryFolded(long(801))).toBe(true);
  });
});
