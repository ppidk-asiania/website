import { z } from "zod";
import { safeText } from "@website/security/validation";
import { isRecruitmentOpen } from "./index";
import { QUEUE_STAGES, type Bar, type QueueStage, type RecruitmentRecap } from "./recap";

/** Step 11.8: the recruitment WhatsApp group, set by the committee (the id is pasted from WAHA). */
export const WaGroupSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[0-9]{5,}(-[0-9]+)?@g\.us$/, "Use the group id, like 1203630@g.us."),
    name: safeText(80).pipe(z.string().min(1, "Enter the name of the group.")),
  })
  .strict();
export type WaGroup = z.output<typeof WaGroupSchema>;

export const GROUP_KEYWORDS = [
  "rekap",
  "posisi",
  "ppin",
  "kampus",
  "jenjang",
  "wawancara",
  "antrean",
  "tren",
  "bantuan",
] as const;
export type GroupKeyword = (typeof GROUP_KEYWORDS)[number];

/** "/rekap" (any case, nothing after it but spaces) gives "rekap"; anything else is not for the bot. */
export function parseGroupKeyword(text: string): GroupKeyword | null {
  const word = /^\/([a-z]+)\s*$/i.exec(text.trim())?.[1]?.toLowerCase();
  return GROUP_KEYWORDS.find((k) => k === word) ?? null;
}

/** One group on several recruitments: the one accepting applications, else the one opened last. */
export function pickRecruitment<T extends Parameters<typeof isRecruitmentOpen>[0]>(
  list: readonly T[],
  now: Date,
): T | null {
  const live = list.filter((r) => r.deletedAt === null);
  const latest = (rows: readonly T[]) =>
    [...rows].sort((a, b) => b.opensAt.getTime() - a.opensAt.getTime())[0] ?? null;
  return latest(live.filter((r) => isRecruitmentOpen(r, now))) ?? latest(live);
}

export const GROUP_REFUSAL =
  "Maaf, kamu tidak punya akses ke data rekrutmen. Tautkan nomor WhatsApp-mu di profil PPIDK. / Sorry, you have no access to recruitment data. Link your WhatsApp number on your PPIDK profile.";
export const GROUP_HELP = `Perintah / Commands:
/rekap ringkasan / summary
/posisi pilihan per unit / choices per unit
/ppin asal PPI / chapters
/kampus asal kampus / campuses
/jenjang jenjang studi / study levels
/wawancara wawancara / interviews
/antrean antrean / queue
/tren angkatan masuk / entry years
/bantuan bantuan ini / this help`;

const STAGE_LABELS: Record<QueueStage, string> = {
  review: "Perlu ditinjau",
  revision: "Revisi",
  interview: "Wawancara",
  offered: "Ditawari",
  accepted: "Diterima",
  placement: "Penempatan",
  closed: "Selesai / ditutup",
};

const lines = (heading: string, rows: readonly string[]) =>
  [heading, ...(rows.length ? rows : ["Belum ada data."])].join("\n");
const bars = (list: readonly Bar[]) => list.map((b) => `• ${b.label}: ${b.count}`);

/**
 * The text of one keyword, from `recruitmentRecap()`. Counts only: no phone number, e-mail, score
 * or applicant name ever reaches a group.
 */
export function groupAnswer(
  keyword: Exclude<GroupKeyword, "bantuan">,
  title: string,
  recap: RecruitmentRecap,
): string {
  const head = `*${title}*`;
  const stage = (s: { key: QueueStage; count: number }) => `• ${STAGE_LABELS[s.key]}: ${s.count}`;
  switch (keyword) {
    case "rekap":
      return lines(`${head}\nRekap`, [
        `• Pelamar: ${recap.people} orang, ${recap.total} lamaran`,
        ...recap.stages.map(stage),
      ]);
    case "antrean":
      return lines(`${head}\nAntrean`, recap.stages.filter((s) => s.key !== "closed").map(stage));
    case "posisi":
      return lines(
        `${head}\nPilihan per unit (pilihan 1 / pilihan 2 / diterima / kuota)`,
        recap.units.map(
          (u) => `• ${u.name}: ${u.choice1} / ${u.choice2} / ${u.accepted} / ${u.quota}`,
        ),
      );
    case "ppin":
      return lines(`${head}\nAsal PPI`, bars(recap.spread.chapter));
    case "kampus":
      return lines(`${head}\nAsal kampus`, bars(recap.spread.campus));
    case "jenjang":
      return lines(`${head}\nJenjang studi`, bars(recap.spread.level));
    case "tren":
      return lines(
        `${head}\nAngkatan masuk`,
        bars([...recap.spread.entryYear].sort((a, b) => a.label.localeCompare(b.label))),
      );
    case "wawancara": {
      const i = recap.interviews;
      return lines(`${head}\nWawancara`, [
        `• Terjadwal: ${i.scheduled}`,
        `• Hadir: ${i.attended}`,
        `• Tidak hadir: ${i.absent}`,
        `• Sudah dinilai: ${i.assessed}`,
      ]);
    }
  }
}

export type GroupNoticeKind = "submitted" | "booked" | "cancelled";
const NOTICE_TITLES: Record<GroupNoticeKind, string> = {
  submitted: "Lamaran baru masuk",
  booked: "Wawancara dipesan",
  cancelled: "Pelamar membatalkan wawancara",
};

/** The name is shown only while the application still runs (not a draft, not closed). */
export const isRunning = (status: string): boolean =>
  status !== "draft" && !(QUEUE_STAGES.closed as readonly string[]).includes(status);

/** Mentions are added by the channel, so this text never holds a phone number. */
export function groupNotice(input: {
  kind: GroupNoticeKind;
  status: string;
  name: string;
  campus: string;
  choices: readonly string[];
  link: string;
}): string {
  return [
    `*${NOTICE_TITLES[input.kind]}*`,
    `Nama: ${isRunning(input.status) ? input.name : "(lamaran sudah selesai)"}`,
    `Kampus: ${input.campus || "-"}`,
    `Pilihan: ${input.choices.join(", ")}`,
    `Buka (perlu masuk): ${input.link}`,
  ].join("\n");
}
