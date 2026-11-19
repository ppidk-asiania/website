import "server-only";
import type { Contact, Messenger } from "@website/domain/messaging";
import type { Application, InterviewSlot } from "@website/domain/recruitment";

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export interface BookedInfo {
  readonly application: Pick<Application, "id" | "userId">;
  readonly slot: Pick<InterviewSlot, "id" | "interviewerUid" | "startsAt" | "timeZone">;
  readonly choiceId: string;
}

/**
 * Step 11.5: an applicant booked a time, the interviewer is told once
 * (`interview:{applicationId}:booked:{slotId}`). The website has no WhatsApp channel, so this goes
 * by e-mail, in the interviewer's own zone.
 */
export function createBookedNotice(deps: {
  contacts: (uids: readonly string[]) => Promise<Map<string, Contact>>;
  send: Messenger["send"];
  adminUrl: string;
}) {
  return {
    booked: async ({ application, slot }: BookedInfo): Promise<void> => {
      if (!slot.interviewerUid) return;
      const contact = (await deps.contacts([slot.interviewerUid])).get(slot.interviewerUid);
      if (!contact?.email || contact.active === false) return;
      const at = new Intl.DateTimeFormat("en-GB", {
        timeZone: contact.timeZone ?? slot.timeZone,
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZoneName: "short",
      }).format(slot.startsAt);
      const text = `Seorang pelamar memesan waktu wawancaramu: ${at}.\n\nAn applicant booked one of your interview times: ${at}.\n\n${deps.adminUrl}/interviews`;
      await deps.send(
        {
          channel: "email",
          to: contact.email,
          subject: "Wawancara dipesan / Interview booked",
          text,
          html: `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`,
        },
        `interview:${application.id}:booked:${slot.id}`,
      );
    },
  };
}
