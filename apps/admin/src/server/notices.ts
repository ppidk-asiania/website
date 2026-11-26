import "server-only";
import type { SqlContactReader } from "@website/db/sql";
import type { EventEntity } from "@website/domain/events";
import { desksOf, type Letter, type LetterType } from "@website/domain/documents";
import type { FinanceRequest } from "@website/domain/finance";
import { messageTo, type Messenger, type SurveySource } from "@website/domain/messaging";
import type { ProofReview } from "@website/domain/members";
import type { LpjReport, Program, ProgramRevision } from "@website/domain/programs";
import type { Application, ApplicationStatus } from "@website/domain/recruitment";
import type { PagePermission } from "@website/permissions";

const both = (id: string, en: string) => `${id}\n\n${en}`;
const html = (text: string) =>
  `<p>${text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/\n/g, "<br>")}</p>`;

const APPLICATION_NOTICES: Partial<Record<ApplicationStatus, readonly [string, string]>> = {
  revision: [
    "Panitia meminta perbaikan pada lamaranmu. Buka halaman lamaran untuk melihat permintaannya.",
    "The committee asks you to revise your application. Open the application page to see what.",
  ],
  admin_rejected: [
    "Lamaranmu belum lolos seleksi berkas. Terima kasih atas minatmu.",
    "Your application did not pass the document check. Thank you for your interest.",
  ],
  interview: [
    "Lamaranmu lolos seleksi berkas. Pilih jadwal wawancara di halaman lamaran.",
    "Your application passed the document check. Pick an interview time on the application page.",
  ],
  offered: [
    "Kamu mendapat tawaran posisi. Terima atau tolak sebelum batas waktunya di halaman lamaran.",
    "You have a placement offer. Accept or decline it before it expires on the application page.",
  ],
  rejected: [
    "Lamaranmu belum berhasil kali ini. Terima kasih atas minatmu.",
    "Your application was not successful this time. Thank you for your interest.",
  ],
  approved: [
    "Penempatanmu disetujui. Unggah pakta integritas yang sudah ditandatangani di halaman lamaran.",
    "Your placement is approved. Upload the signed integrity pact on the application page.",
  ],
  confirmed: [
    "Selamat, kamu resmi dilantik sebagai pengurus.",
    "Congratulations, you are now confirmed as an officer.",
  ],
};

type Content = { subject: string; text: string };

export interface NoticeDeps {
  readonly contacts: Pick<SqlContactReader, "contacts" | "holders">;
  readonly send: Messenger["send"];
  /** Everyone holding a place or a waitlist spot of an event. */
  readonly eventRegistrants: (eventId: string) => Promise<string[]>;
  readonly letterType: (id: string) => Promise<Pick<LetterType, "requiresCoordinator"> | null>;
  readonly webUrl: string;
  readonly adminUrl: string;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
  readonly poll: (
    uids: readonly string[],
    source: SurveySource,
    sourceId: string,
  ) => Promise<unknown>;
}

export function createNotices(deps: NoticeDeps) {
  async function tell(uids: readonly string[], content: Content, key: (uid: string) => string) {
    const contacts = await deps.contacts.contacts(uids);
    for (const uid of uids) {
      await deps.send(
        messageTo(contacts.get(uid) ?? null, { ...content, html: html(content.text) }),
        key(uid),
      );
    }
  }

  const safely = async (what: string, id: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      deps.logError("notice failed", { what, id, error: String(error) });
    }
  };

  const application = (next: Application, recruitmentTitle: string) =>
    safely("application", next.id, async () => {
      const notice = APPLICATION_NOTICES[next.status];
      if (!notice) return;
      const note = next.status === "approved" && next.pactNote ? `\n\n${next.pactNote}` : "";
      const link = `${deps.webUrl}/recruitment/${next.recruitmentId}`;
      await tell(
        [next.userId],
        {
          subject: `Oprec: ${recruitmentTitle}`,
          text: `${both(notice[0], notice[1])}${note}\n\n${link}`,
        },
        () => `recruitment:${next.id}:${next.status}:${next.version}`,
      );
      if (next.status === "confirmed") await deps.poll([next.userId], "recruitment", next.id);
    });

  // The key holds the decision time, so a second request to fix the proof is sent too.
  const proof = (uid: string, review: ProofReview) =>
    safely("proof", uid, async () => {
      const fix = review.state === "fix";
      const text = fix
        ? both(
            "Bukti status mahasiswamu perlu diperbaiki. Unggah ulang di profilmu.",
            "Your proof of student status needs a fix. Upload it again on your profile.",
          )
        : both(
            "Bukti status mahasiswamu sudah diterima.",
            "Your proof of student status is accepted.",
          );
      await tell(
        [uid],
        {
          subject: "Bukti status mahasiswa / Student proof",
          text: `${text}${fix ? `\n\n${review.note}` : ""}\n\n${deps.webUrl}/account/profile`,
        },
        () => `proof:${uid}:${review.state}:${review.at.getTime()}`,
      );
    });

  const letter = (saved: Letter) =>
    safely("letter", saved.id, async () => {
      const link = `${deps.adminUrl}/letters`;
      const key = (uid: string) => `letter:${saved.id}:${saved.status}:${saved.version}:${uid}`;
      const desk = async (permission: PagePermission, id: string, en: string, extra = "") =>
        tell(
          await deps.contacts.holders(permission, { orgUnitPath: saved.orgUnitPath }),
          {
            subject: `Surat / Letter: ${saved.subject}`,
            text: `${both(id, en)}${extra}\n\n${link}`,
          },
          key,
        );
      if (saved.status === "review") {
        await desk(
          "letters.review",
          "Surat menunggu koreksi.",
          "A letter waits for review.",
          saved.draftUrl ? `\n\n${saved.draftUrl}` : "",
        );
      } else if (saved.status === "corrected" && !saved.secretary && !saved.coordinator) {
        const type = await deps.letterType(saved.typeId);
        for (const d of desksOf(type ?? { requiresCoordinator: false }, saved)) {
          await desk(
            d === "secretary" ? "letters.sign" : "letters.sign_coordinator",
            "Surat menunggu tanda tangan.",
            "A letter waits for your signature.",
          );
        }
      } else if (saved.status === "approved") {
        await desk("letters.issue", "Surat siap diterbitkan.", "A letter is ready to be issued.");
      } else if (saved.status === "draft" && saved.reviewNote) {
        await tell(
          [saved.createdBy],
          {
            subject: `Surat / Letter: ${saved.subject}`,
            text: `${both("Surat dikembalikan untuk diperbaiki.", "Your letter was returned for changes.")}\n\n${saved.reviewNote}\n\n${link}`,
          },
          key,
        );
      }
    });

  const lpj = (saved: LpjReport) =>
    safely("lpj", saved.id, async () => {
      const link = `${deps.adminUrl}/lpj/${saved.id}`;
      const key = (uid: string) => `lpj:${saved.id}:${saved.status}:${saved.version}:${uid}`;
      const to = (uids: readonly string[], id: string, en: string, extra = "") =>
        tell(
          uids,
          { subject: `LPJ: ${saved.plan.name}`, text: `${both(id, en)}${extra}\n\n${link}` },
          key,
        );
      const desk = async (permission: PagePermission, id: string, en: string) =>
        to(await deps.contacts.holders(permission, { orgUnitPath: saved.orgUnitPath }), id, en);
      if (saved.status === "draft" && saved.version === 1) {
        await to(
          saved.pics,
          `Program selesai: tulis LPJ-nya paling lambat ${saved.dueOn}.`,
          `The programme is finished: write its LPJ by ${saved.dueOn}.`,
        );
      } else if (saved.status === "submitted" && !saved.secretariat && !saved.treasurer) {
        await desk(
          "lpj.review_secretariat",
          "LPJ menunggu pemeriksaan.",
          "An LPJ waits for review.",
        );
        await desk("lpj.review_treasurer", "LPJ menunggu pemeriksaan.", "An LPJ waits for review.");
      } else if (saved.status === "submitted" && saved.secretariat && saved.treasurer) {
        await desk("lpj.approve", "LPJ menunggu persetujuan.", "An LPJ waits for your approval.");
      } else if (saved.status === "returned") {
        await to(
          saved.pics,
          "LPJ dikembalikan untuk diperbaiki.",
          "Your LPJ was returned for changes.",
          `\n\n${saved.returnNote ?? ""}`,
        );
      } else if (saved.status === "approved") {
        await to(saved.pics, "LPJ disetujui.", "Your LPJ is approved.");
        await deps.poll(saved.pics, "lpj", saved.id);
      }
    });

  const program = (saved: Program) =>
    safely("program", saved.id, async () => {
      const link = `${deps.adminUrl}/programs/${saved.id}`;
      const subject = `Program: ${saved.name}`;
      const key = (uid: string) => `program:${saved.id}:${saved.status}:${saved.version}:${uid}`;
      const team = [...new Set([saved.createdBy, ...saved.pics])];
      const to = (uids: readonly string[], id: string, en: string, note = "") =>
        tell(uids, { subject, text: `${both(id, en)}${note}\n\n${link}` }, key);
      if (saved.status === "proposed") {
        await to(
          await deps.contacts.holders("programs.approve", { orgUnitPath: saved.orgUnitPath }),
          "Program baru menunggu persetujuan.",
          "A programme waits for your approval.",
        );
      } else if (saved.status === "approved") {
        await to(team, "Programmu disetujui.", "Your programme is approved.");
      } else if (saved.status === "draft" && saved.reviewNote) {
        await to(
          team,
          "Programmu dikembalikan untuk diperbaiki.",
          "Your programme was returned for changes.",
          `\n\n${saved.reviewNote}`,
        );
      }
    });

  const programRevision = (saved: ProgramRevision, of: Pick<Program, "name">) =>
    safely("programRevision", saved.id, async () => {
      const link = `${deps.adminUrl}/programs/${saved.programId}`;
      const subject = `Revisi program / Programme revision: ${of.name}`;
      const key = (uid: string) => `programRevision:${saved.id}:${saved.status}:${uid}`;
      const to = (uids: readonly string[], id: string, en: string) =>
        tell(uids, { subject, text: `${both(id, en)}\n\n${link}` }, key);
      if (saved.status === "pending") {
        await to(
          await deps.contacts.holders("programs.approve", { orgUnitPath: saved.orgUnitPath }),
          "Revisi rencana program menunggu keputusan.",
          "A programme plan revision waits for your decision.",
        );
      } else {
        const verdict =
          saved.status === "approved" ? ["disetujui", "approved"] : ["ditolak", "rejected"];
        await to(
          [saved.requestedBy],
          `Revisi rencana programmu ${verdict[0]}.`,
          `Your plan revision was ${verdict[1]}.`,
        );
      }
    });

  const finance = (saved: FinanceRequest) =>
    safely("finance", saved.id, async () => {
      const link = `${deps.adminUrl}/finance`;
      const subject = `Keuangan / Finance: ${saved.title}`;
      const key = (uid: string) => `finance:${saved.id}:${saved.status}:${saved.version}:${uid}`;
      const desk = async (permission: PagePermission, id: string, en: string) =>
        tell(
          await deps.contacts.holders(permission, { orgUnitPath: saved.orgUnitPath }),
          { subject, text: `${both(id, en)}\n\n${link}` },
          key,
        );
      const requester = (id: string, en: string, note: string | null) =>
        tell(
          [saved.createdBy],
          { subject, text: `${both(id, en)}${note ? `\n\n${note}` : ""}\n\n${link}` },
          key,
        );
      if (saved.status === "submitted") {
        await desk(
          "finance.review",
          "Pengajuan keuangan menunggu diperiksa bendahara.",
          "A finance request waits for the treasurer's review.",
        );
      } else if (saved.status === "reviewed") {
        await desk(
          "finance.authorize",
          "Pengajuan keuangan menunggu otorisasi.",
          "A finance request waits for authorisation.",
        );
      } else if (saved.status === "authorized") {
        await desk(
          "finance.pay",
          "Pengajuan keuangan disetujui, menunggu dicairkan.",
          "A finance request is authorised and waits to be paid.",
        );
      } else if (saved.status === "revision") {
        await requester(
          "Pengajuan keuangan dikembalikan untuk diperbaiki.",
          "Your finance request was returned for changes.",
          saved.revisionNote,
        );
      } else if (saved.status === "rejected") {
        await requester(
          "Pengajuan keuangan ditolak.",
          "Your finance request was rejected.",
          saved.rejection?.note ?? null,
        );
      } else if (saved.status === "paid") {
        await requester("Dana telah dicairkan.", "The money has been paid.", null);
        await deps.poll([saved.createdBy], "finance", saved.id);
      }
    });

  const eventApprovalAsked = (saved: EventEntity) =>
    safely("eventApprovalAsked", saved.id, async () => {
      await tell(
        await deps.contacts.holders("events.publish", {
          ...(saved.chapterId ? { chapterId: saved.chapterId } : {}),
        }),
        {
          subject: `Acara / Event: ${saved.title}`,
          text: `${both("Acara menunggu persetujuan sebelum tayang.", "An event waits for your approval before it goes public.")}\n\n${deps.adminUrl}/events`,
        },
        (uid) => `event:${saved.id}:asked:${saved.version}:${uid}`,
      );
    });

  const eventApprovalDecided = (saved: EventEntity, approved: boolean, askedBy: string | null) =>
    safely("eventApprovalDecided", saved.id, async () => {
      if (askedBy === null) return;
      const [id, en] = approved
        ? ["Acaramu disetujui dan boleh ditayangkan.", "Your event is approved and can go public."]
        : ["Acaramu belum disetujui.", "Your event was not approved."];
      await tell(
        [askedBy],
        {
          subject: `Acara / Event: ${saved.title}`,
          text: `${both(id, en)}${saved.rejectionNote ? `\n\n${saved.rejectionNote}` : ""}\n\n${deps.adminUrl}/events`,
        },
        (uid) => `event:${saved.id}:${approved ? "approved" : "rejected"}:${saved.version}:${uid}`,
      );
    });

  // The key has no version: a person is told once about a cancellation, however often it is retried.
  const eventCancelled = (saved: EventEntity) =>
    safely("eventCancelled", saved.id, async () => {
      await tell(
        await deps.eventRegistrants(saved.id),
        {
          subject: `Acara dibatalkan / Event cancelled: ${saved.title}`,
          text: `${both("Acara yang kamu daftar dibatalkan.", "An event you registered for is cancelled.")}\n\n${saved.cancelReason ?? ""}\n\n${deps.webUrl}/events/${saved.slug}`,
        },
        (uid) => `event:${saved.id}:cancelled:${uid}`,
      );
    });

  // A person may be rejected, send a new proof and be decided again: the time makes each decision new.
  const eventPaymentDecided = (
    event: EventEntity,
    uid: string,
    verified: boolean,
    note: string | null,
    at: Date,
  ) =>
    safely("eventPaymentDecided", event.id, async () => {
      const [id, en] = verified
        ? [
            "Pembayaranmu terverifikasi. Pendaftaranmu dikonfirmasi.",
            "Your payment is verified. Your registration is confirmed.",
          ]
        : [
            "Bukti pembayaranmu belum diterima. Kirim bukti yang baru.",
            "Your proof of payment was not accepted. Please send a new one.",
          ];
      await tell(
        [uid],
        {
          subject: `Acara / Event: ${event.title}`,
          text: `${both(id, en)}${note ? `\n\n${note}` : ""}\n\n${deps.webUrl}/events/${event.slug}/ticket`,
        },
        (to) =>
          `event:${event.id}:payment:${verified ? "verified" : "rejected"}:${to}:${at.getTime()}`,
      );
    });

  // A donation is decided once (rejected donations are not resent), so the id is enough for the key.
  const donationDecided = (uid: string, id: string, verified: boolean, note: string | null) =>
    safely("donationDecided", id, async () => {
      const [idText, en] = verified
        ? [
            "Donasimu terverifikasi. Terima kasih atas dukunganmu!",
            "Your donation is verified. Thank you for your support!",
          ]
        : ["Bukti donasimu belum diterima.", "Your proof of donation was not accepted."];
      await tell(
        [uid],
        {
          subject: "Donasi / Donation",
          text: `${both(idText, en)}${note ? `\n\n${note}` : ""}\n\n${deps.webUrl}/donate`,
        },
        (to) => `donation:${id}:${verified ? "verified" : "rejected"}:${to}`,
      );
    });

  // One decision per applicant (it cannot be decided twice), so the key needs no time.
  const eventPlacement = (
    event: EventEntity,
    uid: string,
    placement: { seat: string; division: string } | null,
  ) =>
    safely("eventPlacement", event.id, async () => {
      const [id, en] = placement
        ? [
            `Kamu diterima sebagai ${placement.seat} di ${placement.division}.`,
            `You are accepted as ${placement.seat} of ${placement.division}.`,
          ]
        : [
            "Lamaranmu untuk kepanitiaan belum diterima. Terima kasih atas minatmu.",
            "Your committee application was not accepted. Thank you for your interest.",
          ];
      await tell(
        [uid],
        {
          subject: `Panitia / Committee: ${event.title}`,
          text: `${both(id, en)}\n\n${deps.webUrl}/events/${event.slug}`,
        },
        (to) => `event:${event.id}:placement:${to}`,
      );
    });

  return {
    eventPlacement,
    application,
    proof,
    letter,
    lpj,
    program,
    programRevision,
    finance,
    eventApprovalAsked,
    eventApprovalDecided,
    eventCancelled,
    eventPaymentDecided,
    donationDecided,
  };
}

export type Notices = ReturnType<typeof createNotices>;
