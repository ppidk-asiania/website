import type { Application, ApplicationStatus, Recruitment } from "./index";
import { holdsSeat } from "./index";
import type { InterviewScope } from "./interviews";
import { NO_RELATION, RECOMMENDATIONS, weightedAverage, type Assessment } from "./assessments";
import type { Recommendation } from "./assessments";

/** Step 11.7: the steps of the applications list, in flow order; the recap and the list tabs share them. */
export const QUEUE_STAGES = {
  review: ["submitted"],
  revision: ["revision"],
  interview: ["interview"],
  offered: ["offered"],
  accepted: ["accepted"],
  placement: ["approved", "pakta_review", "confirmed"],
  closed: ["admin_rejected", "declined", "rejected", "withdrawn"],
} as const satisfies Record<string, readonly ApplicationStatus[]>;
export type QueueStage = keyof typeof QUEUE_STAGES;

/** From the profile as it is today; the loader resolves the chapter name. */
export interface Origin {
  readonly chapter: string | null;
  readonly campus: string;
  readonly level: string;
  readonly entryYear: number;
  readonly gender: string;
}

export interface Bar {
  readonly label: string;
  readonly count: number;
}

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

const tally = (labels: readonly string[], top?: number): Bar[] => {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, top);
};

/**
 * ONE function for the recap page and the WhatsApp bot (step 11.8). `scope` is the viewer's:
 * everything (`recruitment.read`) or the unit tree. Stages count applications, spreads count
 * people; drafts count nowhere.
 */
export function recruitmentRecap(input: {
  recruitments: ReadonlyArray<{
    recruitment: Pick<Recruitment, "units">;
    applications: readonly Application[];
    assessments: readonly Assessment[];
  }>;
  origins: ReadonlyMap<string, Origin>;
  scope: Pick<InterviewScope, "all" | "orgUnitIds">;
}) {
  const { scope } = input;
  const unitIn = (id: string) => scope.all || scope.orgUnitIds.has(id);
  const unit = new Map<
    string,
    {
      orgUnitId: string;
      name: string;
      choice1: number;
      choice2: number;
      accepted: number;
      quota: number;
    }
  >();
  const kept: Application[] = [];
  const bookings: Array<{ attendance: "attended" | "absent" | null }> = [];
  const assessed: Assessment[] = [];

  for (const { recruitment, applications, assessments } of input.recruitments) {
    for (const u of recruitment.units.filter((u) => unitIn(u.orgUnitId))) {
      const row = unit.get(u.orgUnitId);
      if (row) row.quota += u.quota;
      else
        unit.set(u.orgUnitId, {
          orgUnitId: u.orgUnitId,
          name: u.name,
          choice1: 0,
          choice2: 0,
          accepted: 0,
          quota: u.quota,
        });
    }
    const mine = applications.filter(
      (a) => a.status !== "draft" && (scope.all || a.choices.some(unitIn)),
    );
    kept.push(...mine);
    for (const a of mine) {
      a.choices.forEach((id, i) => {
        const row = unit.get(id);
        if (row && i === 0) row.choice1 += 1;
        if (row && i === 1) row.choice2 += 1;
      });
      const offered = a.offer && unit.get(a.offer.orgUnitId);
      if (offered && holdsSeat(a.status)) offered.accepted += 1;
      for (const [choiceId, booking] of Object.entries(a.interviews)) {
        if (unitIn(choiceId)) bookings.push(booking);
      }
    }
    const ids = new Set(mine.map((a) => a.id));
    assessed.push(...assessments.filter((x) => ids.has(x.applicationId) && unitIn(x.choiceId)));
  }

  const people = [...new Set(kept.map((a) => a.userId))].map((uid) => input.origins.get(uid));
  const spreadOf = (pick: (o: Origin) => string, top?: number) =>
    tally(
      people.map((o) => (o ? pick(o) : "Unknown")),
      top,
    );

  const aspects = new Map<string, { label: string; scores: { score: number; weight: number }[] }>();
  for (const a of assessed) {
    for (const r of a.rubric) {
      const row = aspects.get(r.key) ?? { label: r.label, scores: [] };
      row.scores.push({ score: a.scores[r.key] ?? 0, weight: 1 });
      aspects.set(r.key, row);
    }
  }
  const recommendations = Object.fromEntries(RECOMMENDATIONS.map((r) => [r, 0])) as Record<
    Recommendation,
    number
  >;
  for (const a of assessed) recommendations[a.recommendation] += 1;

  return {
    total: kept.length,
    stages: (Object.keys(QUEUE_STAGES) as QueueStage[]).map((key) => ({
      key,
      count: kept.filter((a) =>
        (QUEUE_STAGES[key] as readonly ApplicationStatus[]).includes(a.status),
      ).length,
    })),
    units: [...unit.values()],
    people: people.length,
    spread: {
      chapter: spreadOf((o) => o.chapter ?? "No chapter"),
      level: spreadOf((o) => o.level),
      campus: spreadOf((o) => o.campus, 10),
      entryYear: spreadOf((o) => String(o.entryYear)),
      gender: spreadOf((o) => o.gender),
    },
    interviews: {
      scheduled: bookings.length,
      attended: bookings.filter((b) => b.attendance === "attended").length,
      absent: bookings.filter((b) => b.attendance === "absent").length,
      assessed: new Set(assessed.map((a) => a.interviewKey)).size,
      relationDeclared: assessed.filter((a) => a.relation !== NO_RELATION).length,
      aspects: [...aspects.values()].map(({ label, scores }) => ({
        label,
        average: oneDecimal(weightedAverage(scores) ?? 0),
      })),
      recommendations,
    },
  };
}
export type RecruitmentRecap = ReturnType<typeof recruitmentRecap>;
