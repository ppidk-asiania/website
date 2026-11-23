import "server-only";
import type { Messenger } from "@website/domain/messaging";
import { groupNotice, type Application, type Recruitment } from "@website/domain/recruitment";

export interface GroupEvent {
  readonly kind: "submitted" | "booked" | "cancelled";
  readonly application: Pick<
    Application,
    "id" | "recruitmentId" | "userId" | "status" | "choices" | "version"
  >;
  /** booked / cancelled: the unit of that interview. */
  readonly choiceId?: string;
  readonly slotId?: string;
}

/**
 * Step 11.8: tells the recruitment group about a new application, a booked interview or one the
 * applicant cancelled. The caller sends it after the commit and ignores a failure. The heads of the
 * chosen unit and of its parent are mentioned by their verified numbers.
 */
export function createGroupNotice(deps: {
  recruitment: (id: string) => Promise<Recruitment | null>;
  people: {
    applicant: (uid: string) => Promise<{ name: string; campus: string } | null>;
    headNumbers: (periodId: string, unitId: string) => Promise<string[]>;
  };
  send: Messenger["send"];
  webUrl: string;
}) {
  return async ({ kind, application, choiceId, slotId }: GroupEvent): Promise<void> => {
    const recruitment = await deps.recruitment(application.recruitmentId);
    if (!recruitment?.waGroup) return;
    const applicant = await deps.people.applicant(application.userId);
    const units = new Map(recruitment.units.map((u) => [u.orgUnitId, u.name]));
    const chosen = kind === "submitted" || !choiceId ? application.choices : [choiceId];
    const heads = await Promise.all(
      chosen.map((id) => deps.people.headNumbers(recruitment.periodId, id)),
    );
    const key =
      kind === "submitted"
        ? `group:${application.id}:submitted:${application.version}`
        : kind === "booked"
          ? `group:${application.id}:booked:${slotId ?? choiceId}`
          : `group:${application.id}:cancelled:${choiceId}:${application.version}`;
    await deps.send(
      {
        channel: "whatsapp",
        to: recruitment.waGroup.id,
        subject: "",
        text: groupNotice({
          kind,
          status: application.status,
          name: applicant?.name || "-",
          campus: applicant?.campus ?? "",
          choices: application.choices.map((id) => units.get(id) ?? id),
          link: `${deps.webUrl}/recruitment/${application.recruitmentId}`,
        }),
        html: "",
        mentions: [...new Set(heads.flat())],
      },
      key,
    );
  };
}
