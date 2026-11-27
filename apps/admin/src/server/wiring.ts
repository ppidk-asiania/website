import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { hasTwoSignInMethods } from "@website/auth";
import { lazyEnv } from "@website/config/env";
import {
  createSqlUserStore,
  createSqlRateLimitStore,
  createSqlWebhookEventStore,
  deleteExpired,
  inviteId,
  type AuditListQuery,
  type SqlFormStore,
  type LetterListQuery,
  type FinanceListQuery,
} from "@website/db/sql";
import { CERTIFICATE_EMAIL_PURPOSE, type Letter } from "@website/domain/documents";
import { DEFAULT_UNIT_CAP_BYTES, orgUnitPath } from "@website/domain/organizations";
import sharp from "sharp";
import { trackingLinkData, unsubscribeLinkData } from "@website/domain/newsletter";
import { logSecurityEvent } from "@website/observability";
import { keyedHash, signLink } from "@website/security";
import { createAccountActions } from "./accounts";
import { createApplicationActions } from "./applications";
import { createProofActions } from "./student-proofs";
import { createDeadlineReminders } from "./deadline-reminders";
import { createExportLog, createReportCardFileRoute } from "./exports";
import { createAppointmentActions } from "./appointments";
import { createAuditLogActions, REVERTIBLE_COLLECTIONS } from "./audit-log";
import { createChapterActions } from "./chapters";
import { createMessenger, type Message } from "@website/domain/messaging";
import { createResendSender, emailChannel } from "@website/email";
import { createCronRoute, CRON_JOBS } from "./cron";
import { createChapterRecords } from "./chapter-records";
import { createDashboard } from "./dashboard";
import { createEventActions } from "./events";
import { createEventRegistrationActions } from "./event-registration";
import { createFinanceActions } from "./finance";
import { createFormActions } from "./forms";
import { createGalleryActions } from "./gallery";
import { createOrgDocumentActions } from "./org-documents";
import { createUnitDocumentActions } from "./unit-documents";
import { getAdminEnv, getAppUrls } from "./env";
import { createImageUploads } from "./images";
import { createIncomingActions } from "./incoming";
import {
  createInterviewActions,
  createInterviewNotices,
  createInterviewReads,
  createInterviewReminders,
} from "./interviews";
import { createLetterActions } from "./letters";
import {
  createCertificateActions,
  createCertificateSending,
  createCertificateFileRoute,
  createCertificatePickupRoute,
} from "./certificates";
import { createLetterFileRoute, createLetterPdf, type LetterContext } from "./letter-pdf";
import { createMessageActions } from "./messaging";
import { createNotices } from "./notices";
import { wahaChannel, wahaPoll, wahaResolveLid } from "./whatsapp";
import { createWhatsappLinking } from "./whatsapp-link";
import { createGroupBot } from "./whatsapp-group";
import { WHATSAPP_LINK_PURPOSE } from "@website/domain/members";
import { createPolls, createWahaWebhookRoute } from "./polls";
import { cloudApiReply, createChatbot, createWhatsappWebhook } from "./chatbot";
import { geminiCampusMatcher } from "./gemini";
import { createFirebaseAccountCreator } from "@website/auth/firebase-admin";
import {
  interviewScope,
  isRecruitmentOpen,
  recruitmentRecap,
  type InterviewScope,
} from "@website/domain/recruitment";
import { can, scopedOrgUnitIds } from "@website/permissions";
import { createNewsletterActions } from "./newsletter";
import { createNewsActions } from "./news";
import { createOrgUnitActions } from "./org-units";
import { createPeriodActions } from "./periods";
import { createCheckInActions } from "./event-checkin";
import { createCommitteeActions, createCommitteeRoles } from "./event-committee";
import { createEventCertificateActions } from "./event-certificates";
import { committeeRole } from "@website/domain/events";
import { createDonationActions } from "./donations";
import { createInventoryActions } from "./inventory";
import { createInventoryFlowActions } from "./inventory-flows";
import { createLoanActions } from "./loans";
import { createOpportunityActions } from "./opportunities";
import { createSponsorActions } from "./sponsors";
import { createRecruitmentActions } from "./recruitment";
import { createRoleActions } from "./roles";
import { createUniversityActions } from "./universities";
import { adminDb, adminStores, imageStorage } from "./stores";
import { createOkrActions } from "./okr";
import { createProgramActions } from "./programs";
import { createLpjActions, createLpjFileRoute } from "./lpj";
import { renderReportPdf } from "@website/pdf";
import { createMeetingActions } from "./meetings";
import { createMinutesActions, createMinutesFileRoute } from "./minutes";
import { modelFor } from "@website/domain/ai";
import { createAiActions } from "./ai";
import { createAnthropicDrafter, createCallModel, type CallModel } from "./anthropic";
import { createAnalysisActions } from "./ai-analysis";
import { createLinkActions } from "./links";
import { goppiShortener, sidShortener } from "./shorteners";
import { createZoomActions, createZoomSummary, createZoomTranscript } from "./zoom";
import { createZoomWebhookRoute } from "./zoom-webhook";
import { createDriveClient } from "./drive";
import { createRecordingArchive } from "./recordings";
import { createTasks } from "./tasks";
import { createCalendar } from "./calendar";
import { createZoomClient } from "./zoom-client";
import { encryptField } from "@website/security";

export const accountActions = lazyEnv(() =>
  createAccountActions({
    ...adminStores(),
    sendInvite: (invite, roleName) =>
      messenger().send(
        inviteMessage(invite.email, roleName, getAppUrls().WEB_URL ?? ""),
        `invite:${inviteId(invite.email)}:${invite.version}`,
      ),
  }),
);

function inviteMessage(to: string, roleName: string, webUrl: string): Message {
  const login = `${webUrl}/login`;
  const body =
    `Anda diundang ke admin PERHIMPUNAN PELAJAR INDONESIA DUNIA KAWASAN ASIA-OSEANIA sebagai ${roleName}. Masuk dengan ` +
    `alamat e-mail ini (Google atau e-mail dan kata sandi). / You are invited to the ` +
    `Overseas Indonesian Students’ Association Alliance for Asia-Oceania Region admin as ${roleName}. Sign in with this e-mail address (Google or ` +
    `e-mail and password).`;
  const staff =
    "Peran pengurus butuh dua metode masuk: setelah masuk pertama kali, tambahkan passkey di Akun " +
    "Anda lalu masuk lagi. / Staff roles need two sign-in methods: after the first sign-in, add " +
    "a passkey under Your account and sign in again.";
  return {
    channel: "email",
    to,
    subject: "Undangan admin PPIDK Asia-Oseania / PPIDK Asia-Oseania admin invitation",
    text: `${body}\n\n${login}\n\n${staff}`,
    html: `<p>${body}</p><p><a href="${login}">Masuk / Sign in</a></p><p>${staff}</p>`,
  };
}
export const roleActions = lazyEnv(() =>
  createRoleActions({ roles: adminStores().roles, now: () => new Date() }),
);

export const newsActions = lazyEnv(() =>
  createNewsActions({ content: adminStores().content, now: () => new Date() }),
);

export const eventRegistrationActions = lazyEnv(() =>
  createEventRegistrationActions({
    committeeRole: (userId, eventId) => committeeRoleOf()(userId, eventId),
    events: adminStores().events,
    forms: adminStores().forms,
    registrations: adminStores().eventRegistrations,
    users: (uids) => adminStores().accounts.getMany(uids),
    shorten: (url, title) => linkActions().shorten(url, title, "events"),
    storage: imageStorage(),
    notify: {
      paymentDecided: (event, uid, verified, note, at) =>
        notices().eventPaymentDecided(event, uid, verified, note, at),
    },
    uuid: randomUUID,
    webUrl: getAppUrls().WEB_URL ?? "",
    now: () => new Date(),
  }),
);

export const committeeActions = lazyEnv(() =>
  createCommitteeActions({
    committeeRole: (userId, eventId) => committeeRoleOf()(userId, eventId),
    forms: adminStores().forms,
    accountByEmail: (email) => adminStores().accounts.findByEmail(email),
    notify: { placed: (event, uid, placement) => notices().eventPlacement(event, uid, placement) },
    events: adminStores().events,
    committees: adminStores().committees,
    users: (uids) => adminStores().accounts.getMany(uids),
    findPeople: async (query) =>
      (await adminStores().accounts.searchByPrefix(query, 8)).map(({ uid, name, email }) => ({
        uid,
        name,
        email,
      })),
    now: () => new Date(),
  }),
);

export const committeeRoleOf = lazyEnv(() =>
  createCommitteeRoles({
    events: adminStores().events,
    committees: adminStores().committees,
    now: () => new Date(),
  }),
);

export const checkInActions = lazyEnv(() =>
  createCheckInActions({
    committeeRole: (userId, eventId) => committeeRoleOf()(userId, eventId),
    events: adminStores().events,
    registrations: adminStores().eventRegistrations,
    users: (uids) => adminStores().accounts.getMany(uids),
    now: () => new Date(),
  }),
);

export const eventActions = lazyEnv(() =>
  createEventActions({
    events: adminStores().events,
    releaseReservations: (id, now) => adminStores().flows.releaseForEvent(id, now),
    notify: {
      approvalAsked: (event) => notices().eventApprovalAsked(event),
      approvalDecided: (event, approved, askedBy) =>
        notices().eventApprovalDecided(event, approved, askedBy),
      cancelled: (event) => notices().eventCancelled(event),
    },
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

export const orgDocumentActions = lazyEnv(() =>
  createOrgDocumentActions({
    documents: adminStores().orgDocuments,
    storage: imageStorage(),
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

export const sponsorActions = lazyEnv(() =>
  createSponsorActions({ sponsors: adminStores().sponsors, now: () => new Date() }),
);

export const opportunityActions = lazyEnv(() =>
  createOpportunityActions({
    opportunities: adminStores().opportunities,
    chapterExists: async (id) => (await adminStores().chapters.get(id)) !== null,
    now: () => new Date(),
  }),
);

export const inventoryActions = lazyEnv(() =>
  createInventoryActions({
    inventory: adminStores().inventory,
    unitPath: async (id) => {
      const unit = await adminStores().orgUnits.get(id);
      return unit ? orgUnitPath(unit) : null;
    },
    chapterExists: async (id) => (await adminStores().chapters.get(id)) !== null,
    now: () => new Date(),
  }),
);

export const inventoryFlowActions = lazyEnv(() =>
  createInventoryFlowActions({
    flows: adminStores().flows,
    inventory: adminStores().inventory,
    unitPath: async (id) => {
      const unit = await adminStores().orgUnits.get(id);
      return unit ? orgUnitPath(unit) : null;
    },
    chapterExists: async (id) => (await adminStores().chapters.get(id)) !== null,
    committeeRole: (userId, eventId) => committeeRoleOf()(userId, eventId),
    now: () => new Date(),
  }),
);

export const loanActions = lazyEnv(() =>
  createLoanActions({
    loans: adminStores().loans,
    inventory: adminStores().inventory,
    storage: imageStorage(),
    notify: {
      loanStep: (loan, itemName, step, note) => notices().loanStep(loan, itemName, step, note),
    },
    now: () => new Date(),
  }),
);

export const donationActions = lazyEnv(() =>
  createDonationActions({
    donations: adminStores().donations,
    storage: imageStorage(),
    notify: {
      decided: (uid, id, verified, note) => notices().donationDecided(uid, id, verified, note),
    },
    users: (uids) => adminStores().accounts.getMany(uids),
    logExport: (actorId, details) =>
      logSecurityEvent(adminStores().logger, { type: "data.export", actorId, details }),
  }),
);

export const unitDocumentActions = lazyEnv(() =>
  createUnitDocumentActions({
    documents: adminStores().unitDocuments,
    storage: imageStorage(),
    activePeriod,
    seats: (uid) => adminStores().appointments.activeSeats(uid),
    unitPeriod: async (id) => {
      const unit = await adminStores().orgUnits.get(id);
      return unit && !unit.deletedAt ? unit.periodId : null;
    },
    capBytes: async () => {
      const mb = (await adminDb().collection("settings").doc("documents").get()).get("unitCapMb");
      return typeof mb === "number" && mb > 0 ? mb * 1024 * 1024 : DEFAULT_UNIT_CAP_BYTES;
    },
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

export const galleryActions = lazyEnv(() =>
  createGalleryActions({
    albums: adminStores().galleries,
    events: adminStores().events,
    now: () => new Date(),
  }),
);

export const chapterActions = lazyEnv(() =>
  createChapterActions({ chapters: adminStores().chapters, now: () => new Date() }),
);

export const chapterRecords = lazyEnv(() =>
  createChapterRecords({
    records: adminStores().chapterRecords,
    chapter: (id) => adminStores().chapters.get(id),
    now: () => new Date(),
  }),
);

export const periodActions = lazyEnv(() =>
  createPeriodActions({ periods: adminStores().periods, now: () => new Date() }),
);

export const orgUnitActions = lazyEnv(() =>
  createOrgUnitActions({ units: adminStores().orgUnits, now: () => new Date() }),
);

export const formActions = lazyEnv(() =>
  createFormActions({
    forms: adminStores().forms,
    now: () => new Date(),
    uuid: randomUUID,
    token: () => randomBytes(16).toString("base64url"),
    logExport: (actorId, details) =>
      logSecurityEvent(adminStores().logger, { type: "data.export", actorId, details }),
  }),
);

export const incomingActions = lazyEnv(() =>
  createIncomingActions({
    letters: adminStores().incoming,
    unitPeriod: async (id) => {
      const unit = await adminStores().orgUnits.get(id);
      return unit && !unit.deletedAt ? unit.periodId : null;
    },
    userExists: async (uid) => (await adminStores().accounts.get(uid)) !== null,
    storage: imageStorage(),
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

export const letterPdf = lazyEnv(() => {
  const env = getAdminEnv();
  return createLetterPdf({
    storage: imageStorage(),
    letters: adminStores().letters,
    toPng: async (bytes) => new Uint8Array(await sharp(bytes).png().toBuffer()),
    verification: { host: env.VERIFICATION_HOST ?? null, webUrl: env.WEB_URL ?? null },
    uuid: randomUUID,
    signatures: adminStores().signatures,
    signatureKey: () => env.FIELD_ENCRYPTION_KEY ?? null,
  });
});

export async function letterContext(
  letter: Letter,
): Promise<{ context: LetterContext; period: string | null } | null> {
  const stores = adminStores();
  const uids = [letter.secretary?.uid, letter.coordinator?.uid].filter((u): u is string => !!u);
  const [type, unit, period, people, settings] = await Promise.all([
    stores.letterTypes.get(letter.typeId),
    stores.orgUnits.get(letter.orgUnitId),
    stores.periods.get(letter.periodId),
    stores.accounts.getMany(uids),
    stores.letterSettings.get(),
  ]);
  if (!type) return null;
  const names = new Map([...people].map(([uid, u]) => [uid, u.name ?? u.email ?? uid]));
  return {
    context: { type, unitName: unit?.name ?? "", names, letterhead: settings.letterhead, period },
    period: period?.name ?? null,
  };
}

export const letterFile = lazyEnv(() =>
  createLetterFileRoute({
    getLetter: (id) => adminStores().letters.get(id),
    load: letterContext,
    pdf: letterPdf(),
    logError: (message, fields) => adminStores().logger.error(message, fields),
  }),
);

export const certificateActions = lazyEnv(() =>
  createCertificateActions({
    certificates: adminStores().certificates,
    getLetter: (id) => adminStores().letters.get(id),
    hashEmail: (email) => {
      const secret = getAdminEnv().SUBSCRIBER_HASH_SECRET;
      if (!secret) throw new Error("SUBSCRIBER_HASH_SECRET is required for e-mail columns.");
      return keyedHash(CERTIFICATE_EMAIL_PURPOSE, email, secret);
    },
    now: () => new Date(),
  }),
);

export const eventCertificateActions = lazyEnv(() =>
  createEventCertificateActions({
    certificates: adminStores().certificates,
    getLetter: (id) => adminStores().letters.get(id),
    hashEmail: (email) => {
      const secret = getAdminEnv().SUBSCRIBER_HASH_SECRET;
      if (!secret) throw new Error("SUBSCRIBER_HASH_SECRET is required for e-mail columns.");
      return keyedHash(CERTIFICATE_EMAIL_PURPOSE, email, secret);
    },
    events: adminStores().events,
    registrations: adminStores().eventRegistrations,
    committees: adminStores().committees,
    forms: adminStores().forms,
    users: (uids) => adminStores().accounts.getMany(uids),
    now: () => new Date(),
  }),
);

export const certificateSending = lazyEnv(() =>
  createCertificateSending({
    getLetter: (id) => adminStores().letters.get(id),
    list: (batchId) => adminStores().certificates.list(batchId),
    hashEmail: (email) => {
      const secret = getAdminEnv().SUBSCRIBER_HASH_SECRET;
      if (!secret) throw new Error("SUBSCRIBER_HASH_SECRET is required for e-mail columns.");
      return keyedHash(CERTIFICATE_EMAIL_PURPOSE, email, secret);
    },
    contactOf: async (email) => {
      const account = await adminStores().accounts.findByEmail(email);
      const contact = account
        ? (await adminStores().contacts.contacts([account.uid])).get(account.uid)
        : null;
      return { email, phone: contact?.phone ?? null };
    },
    log: adminStores().messageLog,
    send: (message, key) => messenger().send(message, key),
    retry: (id) => messenger().retry(id),
    pickupUrl: `${getAppUrls().WEB_URL ?? ""}/certificates`,
  }),
);

export const certificateFile = lazyEnv(() =>
  createCertificateFileRoute({
    getLetter: (id) => adminStores().letters.get(id),
    getSheet: (id) => adminStores().certificates.get(id),
    load: letterContext,
    pdf: letterPdf(),
    logError: (message, fields) => adminStores().logger.error(message, fields),
  }),
);

export const certificatePickupFile = lazyEnv(() =>
  createCertificatePickupRoute({
    find: (code) => adminStores().verification.find(code),
    load: letterContext,
    pdf: letterPdf(),
    secret: () => getAdminEnv().LINK_SIGNING_SECRET ?? null,
    now: () => new Date(),
    logError: (message, fields) => adminStores().logger.error(message, fields),
  }),
);

export const letterActions = lazyEnv(() =>
  createLetterActions({
    letters: adminStores().letters,
    types: adminStores().letterTypes,
    settings: adminStores().letterSettings,
    deskUnit: async (periodId, desk) =>
      (await adminStores().periods.get(periodId))?.desks[desk].orgUnitId ?? null,
    seats: (uid) => adminStores().appointments.activeSeats(uid),
    unitPath: async (id) => {
      const unit = await adminStores().orgUnits.get(id);
      return unit ? orgUnitPath(unit) : null;
    },
    afterIssue: async (letter) => {
      try {
        const loaded = await letterContext(letter);
        if (loaded) await letterPdf().archive(letter, loaded.context, loaded.period);
      } catch (error) {
        adminStores().logger.error("letter archive failed", {
          letterId: letter.id,
          error: String(error),
        });
      }
    },
    storage: imageStorage(),
    files: letterPdf(),
    afterStep: (letter) => notices().letter(letter),
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

export const recruitmentActions = lazyEnv(() =>
  createRecruitmentActions({
    recruitments: adminStores().recruitments,
    send: (message, key) => messenger().send(message, key),
    now: () => new Date(),
  }),
);

export const applicationActions = lazyEnv(() =>
  createApplicationActions({
    applications: adminStores().applications,
    signedUrl: (path) => imageStorage().signedReadUrl(path),
    appointments: adminStores().appointments,
    units: adminStores().orgUnits,
    roles: adminStores().roles,
    hasSecondFactor: async (uid) => {
      const { authAdmin, passkeys } = adminStores();
      const [methods, keys] = await Promise.all([
        authAdmin.signInMethods(uid),
        passkeys.listByUser(uid),
      ]);
      return hasTwoSignInMethods({ ...methods, passkeys: keys.length });
    },
    afterRoleChange: async (actor, uid, details) => {
      await adminStores().authAdmin.revokeSessions(uid);
      logSecurityEvent(adminStores().logger, {
        type: "staff.role_changed",
        actorId: actor.userId,
        details: { targetId: uid, ...details },
      });
    },
    notify: (application, title) => notices().application(application, title),
    now: () => new Date(),
  }),
);

export const proofActions = lazyEnv(() =>
  createProofActions({
    profiles: adminStores().memberProfiles,
    applications: adminStores().applications,
    signedUrl: (path) => imageStorage().signedReadUrl(path),
    notify: (uid, review) => notices().proof(uid, review),
    now: () => new Date(),
  }),
);

/** Block N, step 11.5: who interviews (seats, `recruitment.interview`, `recruitment.review`). */
export async function interviewScopeOf(uid: string): Promise<InterviewScope> {
  const [principal, seats, period] = await Promise.all([
    userDirectoryStore().findPrincipalByUid(uid),
    adminStores().appointments.activeSeats(uid),
    activePeriod(),
  ]);
  const units = period ? await adminStores().orgUnits.listForPeriod(period.id) : [];
  return interviewScope({
    seats,
    units,
    review: can(principal, "recruitment.review"),
    granted: scopedOrgUnitIds(principal, "recruitment.interview"),
  });
}

/** Step 11.8: the recap page's scope for a verified WhatsApp sender: global read sees all, else seats. */
export async function recapScopeOf(
  uid: string,
): Promise<Pick<InterviewScope, "all" | "orgUnitIds">> {
  const principal = await userDirectoryStore().findPrincipalByUid(uid);
  return scopedOrgUnitIds(principal, "recruitment.read") === "all"
    ? { all: true, orgUnitIds: new Set<string>() }
    : interviewScopeOf(uid);
}

/** Where applicants come from, as the profile says today (chapter resolved to its name). */
export async function applicantOrigins(uids: readonly string[]) {
  const [found, chapters] = await Promise.all([
    adminStores().memberProfiles.originsOf(uids),
    adminStores().chapters.listForAdmin(),
  ]);
  const names = new Map(chapters.map((c) => [c.id, c.name]));
  return new Map(
    [...found].map(([uid, o]) => [
      uid,
      { ...o, chapter: o.chapterId ? (names.get(o.chapterId) ?? null) : null },
    ]),
  );
}

/** Step 11.7: the one loader of `recruitmentRecap()` for the recap page and the WhatsApp bot (11.8). */
export async function loadRecap(
  recruitmentIds: readonly string[],
  scope: Pick<InterviewScope, "all" | "orgUnitIds">,
) {
  const { recruitments, applications } = adminStores();
  const found = await Promise.all(recruitmentIds.map((id) => recruitments.get(id)));
  const rows = await Promise.all(
    found.flatMap((recruitment) =>
      recruitment && recruitment.deletedAt === null
        ? [
            (async () => ({
              recruitment,
              applications: await applications.listForRecruitment(recruitment.id),
              assessments: await applications.assessments(recruitment.id),
            }))(),
          ]
        : [],
    ),
  );
  const uids = [...new Set(rows.flatMap((r) => r.applications.map((a) => a.userId)))];
  return recruitmentRecap({ recruitments: rows, origins: await applicantOrigins(uids), scope });
}

const interviewMessaging = () => ({
  contacts: (uids: readonly string[]) => adminStores().contacts.contacts(uids),
  send: (message: Message, key: string) => messenger().send(message, key),
  webUrl: getAppUrls().WEB_URL ?? "",
  adminUrl: getAppUrls().ADMIN_URL ?? "",
});

export const interviewActions = lazyEnv(() =>
  createInterviewActions({
    interviews: adminStores().interviews,
    applications: adminStores().applications,
    scope: interviewScopeOf,
    notices: createInterviewNotices(interviewMessaging()),
    now: () => new Date(),
  }),
);

export const interviewReads = lazyEnv(() =>
  createInterviewReads({
    applications: adminStores().applications,
    interviews: adminStores().interviews,
    scope: interviewScopeOf,
  }),
);

export const interviewReminders = lazyEnv(() =>
  createInterviewReminders({
    ...interviewMessaging(),
    bookings: (from, to) => adminStores().applications.bookingsBetween(from, to),
    now: () => new Date(),
  }),
);

export const universityActions = lazyEnv(() =>
  createUniversityActions({ universities: adminStores().universities, now: () => new Date() }),
);

export const appointmentActions = lazyEnv(() => {
  const stores = adminStores();
  return createAppointmentActions({
    ...stores,
    units: stores.orgUnits,
    now: () => new Date(),
  });
});

export const imageUploads = lazyEnv(() =>
  createImageUploads({
    storage: imageStorage(),
    appendAudit: (event) => adminStores().audit.appendAlone(event),
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

export const auditLogActions = lazyEnv(() =>
  createAuditLogActions({
    audit: adminStores().auditLog,
    revertible: REVERTIBLE_COLLECTIONS,
    now: () => new Date(),
    logSecurityEvent: (actorId, details) =>
      logSecurityEvent(adminStores().logger, { type: "audit.revert", actorId, details }),
  }),
);

export const cronRoute = lazyEnv(() =>
  createCronRoute({
    secret: getAdminEnv().CRON_SECRET,
    jobs: {
      ...CRON_JOBS,
      "newsletter-send": () => newsletterActions().runBatch(),
      expire: async () => ({
        ...(await deleteExpired(adminDb(), new Date())),
        unitDocuments: await unitDocumentActions().purge(),
      }),
      "meeting-reminders": async () => ({
        ...(await meetingActions().sendReminders()),
        ...(await interviewReminders()()),
      }),
      "zoom-rooms": () => zoomActions().retryRooms(),
      "recording-archive": () => recordingArchive()(),
      "deadline-reminders": () => deadlineReminders()(),
      "ai-jobs": () => analysisActions().runNext(),
    },
    log: ({ message, ...fields }) =>
      message === "cron_job_failed"
        ? adminStores().logger.error(String(message), fields)
        : adminStores().logger.info(String(message), fields),
  }),
);

export const messenger = lazyEnv(() => {
  const env = getAdminEnv();
  return createMessenger({
    log: adminStores().messageLog,
    channels: {
      email: emailChannel(
        env.RESEND_API_KEY ? createResendSender({ apiKey: env.RESEND_API_KEY }) : null,
        env.EMAIL_FROM_TRANSACTIONAL,
      ),
      whatsapp: wahaChannel(
        env.WAHA_BASE_URL && env.WAHA_API_KEY
          ? { baseUrl: env.WAHA_BASE_URL, apiKey: env.WAHA_API_KEY, session: env.WAHA_SESSION }
          : null,
      ),
    },
    mode: env.MESSAGING_MODE,
    appEnv: env.APP_ENV,
    testRecipients: env.MESSAGING_TEST_RECIPIENTS,
    now: () => new Date(),
  });
});
export const notices = lazyEnv(() =>
  createNotices({
    contacts: adminStores().contacts,
    send: (message, key) => messenger().send(message, key),
    eventRegistrants: (id) => adminStores().eventRegistrations.activeUserIds(id),
    letterType: (id) => adminStores().letterTypes.get(id),
    webUrl: getAppUrls().WEB_URL ?? "",
    adminUrl: getAppUrls().ADMIN_URL ?? "",
    logError: (message, fields) => adminStores().logger.error(message, fields),
    poll: (uids, source, sourceId) => polls().ask(uids, source, sourceId),
  }),
);

export const polls = lazyEnv(() => {
  const env = getAdminEnv();
  return createPolls({
    surveys: adminStores().surveys,
    contacts: (uids) => adminStores().contacts.contacts(uids),
    sendPoll: wahaPoll(
      env.WAHA_BASE_URL && env.WAHA_API_KEY
        ? { baseUrl: env.WAHA_BASE_URL, apiKey: env.WAHA_API_KEY, session: env.WAHA_SESSION }
        : null,
    ),
    delivery: {
      mode: env.MESSAGING_MODE,
      appEnv: env.APP_ENV,
      testRecipients: env.MESSAGING_TEST_RECIPIENTS,
    },
    logError: (message, fields) => adminStores().logger.error(message, fields),
    now: () => new Date(),
  });
});

export const wahaWebhook = lazyEnv(() => {
  const env = getAdminEnv();
  const record = (provider: string, eventId: string, now: Date) =>
    createSqlWebhookEventStore(adminDb()).record(provider, eventId, now);
  const wahaConfig =
    env.WAHA_BASE_URL && env.WAHA_API_KEY
      ? { baseUrl: env.WAHA_BASE_URL, apiKey: env.WAHA_API_KEY, session: env.WAHA_SESSION }
      : null;
  const reply = (to: string, text: string, key: string) =>
    messenger().send({ channel: "whatsapp", to, subject: "", text, html: "" }, key);
  const group = createGroupBot({
    record,
    recruitments: () => adminStores().recruitments.listForAdmin(),
    senderUid: (number) => adminStores().memberProfiles.uidByVerifiedNumber(number),
    resolveLid: wahaResolveLid(wahaConfig),
    scopeOf: recapScopeOf,
    recap: loadRecap,
    rateLimits: createSqlRateLimitStore(adminDb()),
    reply,
    logError: (message, fields) => adminStores().logger.error(message, fields),
    now: () => new Date(),
  });
  const link = createWhatsappLinking({
    record,
    profiles: adminStores().memberProfiles,
    hash: (code) => {
      if (!env.SUBSCRIBER_HASH_SECRET) {
        throw new Error("SUBSCRIBER_HASH_SECRET is required to link WhatsApp numbers.");
      }
      return keyedHash(WHATSAPP_LINK_PURPOSE, code, env.SUBSCRIBER_HASH_SECRET);
    },
    resolveLid: wahaResolveLid(wahaConfig),
    reply,
    logError: (message, fields) => adminStores().logger.error(message, fields),
    now: () => new Date(),
  });
  return createWahaWebhookRoute({
    secret: env.WAHA_WEBHOOK_SECRET,
    record,
    surveys: adminStores().surveys,
    // a group chat goes to the keywords, a private chat to the link code (step 10.4)
    onMessage: (message) => (message.from.endsWith("@g.us") ? group(message) : link(message)),
    now: () => new Date(),
  });
});

const userDirectoryStore = lazyEnv(() => createSqlUserStore(adminDb()));

export const whatsappWebhook = lazyEnv(() => {
  const env = getAdminEnv();
  const hashSecret = env.SUBSCRIBER_HASH_SECRET;
  const handle = createChatbot({
    conversations: adminStores().conversations,
    phoneId: (phone) => {
      if (!hashSecret) throw new Error("SUBSCRIBER_HASH_SECRET is required for the chatbot.");
      return keyedHash("whatsapp-conversation", phone, hashSecret);
    },
    chapters: async () =>
      (await adminStores().chapters.listForAdmin())
        .filter((c) => c.active && !c.deletedAt)
        .map((c) => ({ id: c.id, name: c.name, countryCode: c.countryCode })),
    universities: (countryCode) => adminStores().universities.listApproved(countryCode),
    matchCampus: env.GEMINI_API_KEY ? geminiCampusMatcher(env.GEMINI_API_KEY, fetch) : null,
    ensureAccount: createFirebaseAccountCreator({
      appEnv: env.APP_ENV,
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY,
    }),
    recordUser: async (uid, email, name) => {
      await userDirectoryStore().recordSignIn(
        { uid, email, name, emailVerified: false },
        new Date(),
      );
    },
    openRecruitments: async () => {
      const now = new Date();
      return (await adminStores().recruitments.listForAdmin())
        .filter((r) => isRecruitmentOpen(r, now))
        .map((r) => ({ id: r.id, title: r.title }));
    },
    webUrl: getAppUrls().WEB_URL ?? "",
    logError: (message, fields) => adminStores().logger.error(message, fields),
    now: () => new Date(),
  });
  return createWhatsappWebhook({
    verifyToken: env.WHATSAPP_CLOUD_VERIFY_TOKEN,
    appSecret: env.WHATSAPP_CLOUD_APP_SECRET,
    record: (provider, eventId, now) =>
      createSqlWebhookEventStore(adminDb()).record(provider, eventId, now),
    handle,
    send: cloudApiReply(
      env.WHATSAPP_CLOUD_PHONE_NUMBER_ID && env.WHATSAPP_CLOUD_TOKEN
        ? { phoneNumberId: env.WHATSAPP_CLOUD_PHONE_NUMBER_ID, token: env.WHATSAPP_CLOUD_TOKEN }
        : null,
      fetch,
    ),
    logError: (message, fields) => adminStores().logger.error(message, fields),
    now: () => new Date(),
  });
});

function webLink(path: string, data: Record<string, string>): string {
  const secret = getAdminEnv().LINK_SIGNING_SECRET;
  const web = getAppUrls().WEB_URL;
  if (!secret || !web) throw new Error("LINK_SIGNING_SECRET and WEB_URL are required.");
  return `${web}${path}?t=${signLink(data, secret)}`;
}

export const newsletterActions = lazyEnv(() =>
  createNewsletterActions({
    campaigns: adminStores().campaigns,
    subscribers: adminStores().subscribers,
    send: (message, key) => messenger().send(message, key),
    unsubscribeUrl: (subscriberId) =>
      webLink("/newsletter/unsubscribe", unsubscribeLinkData(subscriberId)),
    openUrl: (campaignId, subscriberId) =>
      webLink("/newsletter/o", trackingLinkData("open", campaignId, subscriberId)),
    clickUrl: (campaignId, subscriberId, url) =>
      webLink("/newsletter/c", trackingLinkData("click", campaignId, subscriberId, url)),
    subscriberId: (email) => {
      const secret = getAdminEnv().SUBSCRIBER_HASH_SECRET;
      if (!secret) throw new Error("SUBSCRIBER_HASH_SECRET is required.");
      return keyedHash("subscriber", email, secret);
    },
    newToken: () => randomBytes(32).toString("base64url"),
    confirmUrl: (id, token) =>
      `${getAppUrls().WEB_URL ?? ""}/newsletter/confirm?s=${id}&t=${token}`,
    chapters: () => adminStores().chapters.listForAdmin(),
    staffEmail: async (uid) => (await adminStores().accounts.get(uid))?.email ?? null,
    logExport: (actorId, rows) =>
      logSecurityEvent(adminStores().logger, {
        type: "data.export",
        actorId,
        details: { dataset: "newsletter_subscribers", rows },
      }),
    now: () => new Date(),
    batchSize: 100,
  }),
);

export const messageActions = lazyEnv(() => createMessageActions({ messenger: messenger() }));

export const dashboard = lazyEnv(() =>
  createDashboard({
    graduatedOfficers: () =>
      adminStores().appointments.graduatedOfficers(new Date().toISOString().slice(0, 10)),
    lpjSecretariatHolders: async () =>
      (await adminStores().contacts.holders("lpj.review_secretariat", { orgUnitPath: [] })).length,
    activePeriod,
    finance: (periodId) => adminStores().finance.list({ periodId, orgUnitIds: "all", limit: 300 }),
    lpj: (periodId) => adminStores().lpj.listForPeriod(periodId),
    zoom: (from) =>
      adminStores().zoom.listBetween(from, new Date(from.getTime() + 365 * 86_400_000)),
    revisions: (periodId) => adminStores().programs.listPendingRevisions(periodId),
    events: () => adminStores().events.listForAdmin(),
    payments: async () => {
      const [waiting, events] = await Promise.all([
        adminStores().eventRegistrations.listSubmitted(),
        adminStores().events.listForAdmin(),
      ]);
      const chapters = new Map(events.map((e) => [e.id, e.chapterId]));
      return waiting.map((w) => ({ chapterId: chapters.get(w.eventId) ?? null }));
    },
    donations: async () =>
      Array.from({ length: await adminStores().donations.countPending() }, () => ({
        chapterId: null,
      })),
    loans: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [waiting, late, items] = await Promise.all([
        adminStores().loans.list(),
        adminStores().loans.overdue(today),
        adminStores().inventory.list(),
      ]);
      const chapterOf = new Map(
        items.map((i) => [i.id, i.owner.kind === "chapter" ? i.owner.chapterId : null]),
      );
      const open = [
        ...waiting.filter((l) => l.status === "pending"),
        ...late.filter((l) => !waiting.some((w) => w.id === l.id && w.status === "pending")),
      ];
      return open.map((l) => ({ chapterId: chapterOf.get(l.itemId) ?? null }));
    },
    myTasks: (uid) => tasks().mine(uid),
    now: () => new Date(),
  }),
);

export const okrActions = lazyEnv(() =>
  createOkrActions({
    objectives: adminStores().objectives,
    periods: adminStores().periods,
    unitPath: async (id) => {
      const unit = await adminStores().orgUnits.get(id);
      return unit ? orgUnitPath(unit) : null;
    },
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

export const programActions = lazyEnv(() =>
  createProgramActions({
    programs: adminStores().programs,
    unitPath: async (id) => {
      const unit = await adminStores().orgUnits.get(id);
      return unit ? orgUnitPath(unit) : null;
    },
    findUserId: async (email) => (await adminStores().accounts.findByEmail(email))?.uid ?? null,
    afterLpj: (lpj) => notices().lpj(lpj),
    afterStep: (program) => notices().program(program),
    afterRevision: (revision, program) => notices().programRevision(revision, program),
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

export const lpjActions = lazyEnv(() =>
  createLpjActions({
    lpj: adminStores().lpj,
    afterStep: (lpj) => notices().lpj(lpj),
    now: () => new Date(),
  }),
);

export const lpjFile = lazyEnv(() =>
  createLpjFileRoute({
    getLpj: (id) => adminStores().lpj.get(id),
    period: (id) => adminStores().periods.get(id),
    names: async (uids) => {
      const people = await adminStores().accounts.getMany(uids);
      return new Map([...people].map(([uid, u]) => [uid, u.name ?? u.email ?? uid]));
    },
    render: renderReportPdf,
    now: () => new Date(),
    logError: (message, fields) => adminStores().logger.error(message, fields),
  }),
);

export const financeActions = lazyEnv(() =>
  createFinanceActions({
    requests: adminStores().finance,
    programPeriod: async (id) => (await adminStores().programs.get(id))?.periodId ?? null,
    unitPath: async (id) => {
      const unit = await adminStores().orgUnits.get(id);
      return unit ? orgUnitPath(unit) : null;
    },
    storage: imageStorage(),
    afterStep: (request) => notices().finance(request),
    period: async () => {
      const active = (await adminStores().periods.listForAdmin()).find(
        (p) => p.status === "active",
      );
      return active ? { id: active.id, name: active.name } : null;
    },
    logExport: (actorId, details) =>
      logSecurityEvent(adminStores().logger, { type: "data.export", actorId, details }),
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

export const meetingActions = lazyEnv(() =>
  createMeetingActions({
    meetings: adminStores().meetings,
    unitPath: async (id) => {
      const unit = await adminStores().orgUnits.get(id);
      return unit ? orgUnitPath(unit) : null;
    },
    unitName: async (id) => (await adminStores().orgUnits.get(id))?.name ?? null,
    findUserId: async (email) => (await adminStores().accounts.findByEmail(email))?.uid ?? null,
    contacts: (uids) => adminStores().contacts.contacts(uids),
    send: (message, key) => messenger().send(message, key),
    adminUrl: getAppUrls().ADMIN_URL ?? "",
    webUrl: getAppUrls().WEB_URL ?? "",
    randomBytes: (n) => randomBytes(n),
    zoomBooking: (id) => adminStores().zoom.get(id),
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

export const aiActions = lazyEnv(() => createAiActions({ ai: adminStores().ai }));

/** The one AI path (step 10.5): minutes, application analysis and proof check all go through it. */
const callModel = lazyEnv(() =>
  getAdminEnv().ANTHROPIC_API_KEY
    ? createCallModel({
        apiKey: getAdminEnv().ANTHROPIC_API_KEY as string,
        fetchImpl: fetch,
        modelFor: async (feature) =>
          modelFor(
            feature,
            (await adminStores().ai.readSettings()).settings,
            getAdminEnv().ANTHROPIC_MODEL,
          ),
        recordUsage: (row) => adminStores().ai.recordUsage(row),
        now: () => new Date(),
      })
    : null,
);

export const analysisActions = lazyEnv(() =>
  createAnalysisActions({
    analyses: adminStores().analyses,
    applications: adminStores().applications,
    recruitments: adminStores().recruitments,
    formVersion: (formId, n) => adminStores().forms.getVersion(formId, n),
    profiles: adminStores().memberProfiles,
    chapterName: async (id) => (await adminStores().chapters.get(id))?.name ?? null,
    storage: imageStorage(),
    callModel: callModel(),
    now: () => new Date(),
    uuid: randomUUID,
  }),
);

export const minutesActions = lazyEnv(() =>
  createMinutesActions({
    meetings: adminStores().meetings,
    actionItems: adminStores().actionItems,
    drafter: callModel() ? createAnthropicDrafter(callModel() as CallModel) : null,
    officerIds: async (periodId) =>
      (await adminStores().appointments.listForPeriod(periodId))
        .filter((a) => a.status === "active")
        .map((a) => a.userId),
    names: accountNames,
    logError: (message, fields) => adminStores().logger.error(message, fields),
    zoomTranscript: createZoomTranscript({
      booking: (id) => adminStores().zoom.get(id),
      client: zoomClient(),
    }),
    zoomSummary: createZoomSummary({ sessions: adminStores().zoom }),
    now: () => new Date(),
  }),
);

async function accountNames(uids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const people = await adminStores().accounts.getMany(uids);
  return new Map([...people].map(([uid, u]) => [uid, u.name ?? u.email ?? uid]));
}

export const minutesFile = lazyEnv(() =>
  createMinutesFileRoute({
    getMeeting: (id) => adminStores().meetings.get(id),
    listItems: (id) => adminStores().actionItems.listForMeeting(id),
    names: accountNames,
    render: renderReportPdf,
    now: () => new Date(),
  }),
);

export const reportCardFile = lazyEnv(() =>
  createReportCardFileRoute({
    periods: () => adminStores().periods.listForAdmin(),
    card: (id) => adminStores().periodReport.card(id, new Date()),
    units: (id) => adminStores().orgUnits.listForPeriod(id),
    render: renderReportPdf,
    now: () => new Date(),
  }),
);

export const exportLog = lazyEnv(() =>
  createExportLog({
    logExport: (actorId, details) =>
      logSecurityEvent(adminStores().logger, { type: "data.export", actorId, details }),
  }),
);

export const linkActions = lazyEnv(() => {
  const env = getAdminEnv();
  return createLinkActions({
    shorteners: [
      goppiShortener(
        env.GOPPI_BASE_URL && env.GOPPI_API_KEY
          ? { baseUrl: env.GOPPI_BASE_URL, apiKey: env.GOPPI_API_KEY }
          : null,
        fetch,
      ),
      sidShortener(env.SHORTLINK_API_KEY ?? null, fetch),
    ],
    links: adminStores().shortLinks,
    logError: (message, fields) => adminStores().logger.error(message, fields),
    now: () => new Date(),
  });
});

export const zoomClient = lazyEnv(() => {
  const env = getAdminEnv();
  return env.ZOOM_ACCOUNT_ID && env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET && env.ZOOM_HOST_USER
    ? createZoomClient(
        {
          accountId: env.ZOOM_ACCOUNT_ID,
          clientId: env.ZOOM_CLIENT_ID,
          clientSecret: env.ZOOM_CLIENT_SECRET,
          hostUser: env.ZOOM_HOST_USER,
        },
        fetch,
      )
    : null;
});

export const zoomActions = lazyEnv(() => {
  const env = getAdminEnv();
  const key = env.FIELD_ENCRYPTION_KEY;
  return createZoomActions({
    zoom: adminStores().zoom,
    client: zoomClient(),
    shorten: (url, title) => linkActions().shorten(url, title, "zoom"),
    unitOf: async (uid) => {
      const [first] = await adminStores().appointments.activeForUser(uid);
      const unit = first ? await adminStores().orgUnits.get(first.orgUnitId) : null;
      return unit ? { orgUnitId: unit.id, orgUnitPath: orgUnitPath(unit) } : null;
    },
    seats: (uid) => adminStores().appointments.activeSeats(uid),
    encrypt: key ? (plain) => encryptField(new TextEncoder().encode(plain), key) : null,
    logError: (message, fields) => adminStores().logger.error(message, fields),
    now: () => new Date(),
  });
});

export const recordingArchive = lazyEnv(() => {
  const env = getAdminEnv();
  return createRecordingArchive({
    zoom: adminStores().zoom,
    client: zoomClient(),
    drive:
      env.GOOGLE_DRIVE_CLIENT_EMAIL &&
      env.GOOGLE_DRIVE_PRIVATE_KEY &&
      env.GOOGLE_DRIVE_IMPERSONATE &&
      env.GOOGLE_DRIVE_FOLDER_ID
        ? createDriveClient(
            {
              clientEmail: env.GOOGLE_DRIVE_CLIENT_EMAIL,
              privateKey: env.GOOGLE_DRIVE_PRIVATE_KEY.replace(/\\n/g, "\n"),
              impersonate: env.GOOGLE_DRIVE_IMPERSONATE,
              folderId: env.GOOGLE_DRIVE_FOLDER_ID,
            },
            fetch,
          )
        : null,
    logError: (message, fields) => adminStores().logger.error(message, fields),
    now: () => new Date(),
  });
});

export const zoomWebhook = lazyEnv(() =>
  createZoomWebhookRoute({
    secret: getAdminEnv().ZOOM_WEBHOOK_SECRET_TOKEN,
    record: (provider, eventId, now) =>
      createSqlWebhookEventStore(adminDb()).record(provider, eventId, now),
    zoom: adminStores().zoom,
    client: zoomClient(),
    contacts: (uids) => adminStores().contacts.contacts(uids),
    send: (message, key) => messenger().send(message, key),
    adminUrl: getAppUrls().ADMIN_URL ?? "",
    logError: (message, fields) => adminStores().logger.error(message, fields),
    now: () => new Date(),
  }),
);

async function activePeriod(): Promise<{ id: string; name: string } | null> {
  const active = (await adminStores().periods.listForAdmin()).find((p) => p.status === "active");
  return active ? { id: active.id, name: active.name } : null;
}

export const deadlineReminders = lazyEnv(() =>
  createDeadlineReminders({
    applications: adminStores().applications,
    checkedIn: (week) => adminStores().programs.checkedIn(week),
    programs: async () => {
      const period = await activePeriod();
      return period ? adminStores().programs.listForPeriod(period.id) : [];
    },
    lpj: async () => {
      const period = await activePeriod();
      return period ? adminStores().lpj.listForPeriod(period.id) : [];
    },
    overdueLoans: async (today) => {
      const late = await adminStores().loans.overdue(today);
      return Promise.all(
        late.map(async (l) => ({
          id: l.id,
          to: l.to,
          itemName: (await adminStores().inventory.get(l.itemId))?.name ?? "",
          userId: l.borrower.kind === "member" ? l.borrower.userId : null,
          email: l.borrower.kind === "outsider" ? l.borrower.email : null,
        })),
      );
    },
    contacts: (uids) => adminStores().contacts.contacts(uids),
    send: (message, key) => messenger().send(message, key),
    adminUrl: getAppUrls().ADMIN_URL ?? "",
    now: () => new Date(),
  }),
);

export const tasks = lazyEnv(() =>
  createTasks({
    activePeriod,
    actionItemsOf: (uid) => adminStores().actionItems.listForPic(uid),
    actionItemsOfPeriod: (id) => adminStores().actionItems.listForPeriod(id),
    incoming: (id) => adminStores().incoming.list(id, 300),
    programs: (id) => adminStores().programs.listForPeriod(id),
    pendingRevisions: (id) => adminStores().programs.listPendingRevisions(id),
    unitsOf: async (uid) =>
      (await adminStores().appointments.activeForUser(uid)).map((a) => a.orgUnitId),
    unitPath: async (id) => {
      const unit = await adminStores().orgUnits.get(id);
      return unit ? orgUnitPath(unit) : null;
    },
    shares: adminStores().taskShares,
    findUserId: async (email) => (await adminStores().accounts.findByEmail(email))?.uid ?? null,
    now: () => new Date(),
  }),
);

export const calendar = lazyEnv(() =>
  createCalendar({
    meetings: (from, to) => adminStores().meetings.listBetween(from, to),
    zoom: (from, to) => adminStores().zoom.listBetween(from, to),
    chapterNames: async () =>
      new Map((await adminStores().chapters.listForAdmin()).map((c) => [c.id, c.name])),
    zoomSettings: async () => (await adminStores().zoom.readSettings()).settings,
    programs: async () => {
      const period = await activePeriod();
      return period ? adminStores().programs.listForPeriod(period.id) : [];
    },
    lpj: async () => {
      const period = await activePeriod();
      return period ? adminStores().lpj.listForPeriod(period.id) : [];
    },
    store: adminStores().calendar,
    principalOf: (uid) => userDirectoryStore().findPrincipalByUid(uid),
    secret: getAdminEnv().CALENDAR_FEED_SIGNING_SECRET ?? null,
    adminUrl: getAppUrls().ADMIN_URL ?? "",
    now: () => new Date(),
  }),
);

export const adminReads = {
  listRoleHolders: (roleIds: readonly string[], chapterIds?: readonly string[]) =>
    adminStores().accounts.listRoleHolders(roleIds, chapterIds),
  listInvites: () => adminStores().accounts.listInvites(),
  getUser: (uid: string) => adminStores().accounts.get(uid),
  getUsers: (uids: readonly string[]) => adminStores().accounts.getMany(uids),
  listRoles: () => adminStores().roles.list(),
  listAudit: (query: AuditListQuery) => adminStores().auditLog.list(query),
  listFailedMessages: (cursor: string | undefined) =>
    adminStores().messageLog.listFailed({ cursor, limit: 25 }),
  getRole: (id: string) => adminStores().roles.get(id),
  listNews: () => adminStores().content.listForAdmin("news"),
  getContent: (id: string) => adminStores().content.get(id),
  listEvents: () => adminStores().events.listForAdmin(),
  // The events an account serves on through a committee seat, with its role there (N1.5).
  servingEvents: async (userId: string) => {
    const [events, committees] = await Promise.all([
      adminStores().events.listForAdmin(),
      adminStores().committees.listAll(),
    ]);
    const now = new Date();
    const serving: Record<string, "board" | "member"> = {};
    for (const event of events) {
      const role = committeeRole(
        committees.find((c) => c.eventId === event.id) ?? null,
        userId,
        event,
        now,
      );
      if (role) serving[event.id] = role;
    }
    return serving;
  },
  // Forms an event may ask at registration: public ones answered with an account.
  listRegistrationForms: async () =>
    (await adminStores().forms.listForAdmin()).filter(
      (f) => f.usage === "public" && f.respondents === "account" && f.deletedAt === null,
    ),
  listForms: () => adminStores().forms.listForAdmin(),
  listLetters: (query: LetterListQuery) => adminStores().letters.list(query),
  getLetter: (id: string) => adminStores().letters.get(id),
  listCertificates: (batchId: string) => adminStores().certificates.list(batchId),
  listLetterTypes: () => adminStores().letterTypes.list(),
  getLetterSettings: () => adminStores().letterSettings.get(),
  listArchiveGuests: () => adminStores().letterArchive.guests(),
  listIncoming: (periodId: string) => adminStores().incoming.list(periodId, 300),
  listRecruitments: () => adminStores().recruitments.listForAdmin(),
  getRecruitment: (id: string) => adminStores().recruitments.get(id),
  listApplications: (recruitmentId: string) =>
    adminStores().applications.listForRecruitment(recruitmentId),
  listRevisions: (recruitmentId: string) =>
    adminStores().applications.revisionsForRecruitment(recruitmentId),
  getFormVersion: (formId: string, n: number) => adminStores().forms.getVersion(formId, n),
  personalityResults: (uids: readonly string[]) => adminStores().personality.getMany(uids),
  studentProofs: (uids: readonly string[]) => adminStores().memberProfiles.proofsOf(uids),
  listInterviewSlots: (recruitmentId: string) =>
    adminStores().interviews.listForRecruitment(recruitmentId),
  recruitmentSeats: (ids: readonly string[]) => adminStores().recruitments.seats(ids),
  getForm: (id: string) => adminStores().forms.get(id),
  listFormVersions: (id: string) => adminStores().forms.listVersions(id),
  listFormResponses: (id: string, limit: number) => adminStores().forms.listResponses(id, limit),
  currentFormVersions: (forms: Parameters<SqlFormStore["currentVersions"]>[0]) =>
    adminStores().forms.currentVersions(forms),
  listAlbums: () => adminStores().galleries.listForAdmin(),
  listOrgDocuments: () => adminStores().orgDocuments.listForAdmin(),
  listSponsors: () => adminStores().sponsors.listForAdmin(),
  listOpportunities: async () => {
    const rows = await adminStores().opportunities.listForAdmin();
    const clicks = await adminStores().opportunities.clickCounts(rows.map((o) => o.id));
    return rows.map((o) => ({ ...o, clicks: clicks.get(o.id) ?? 0 }));
  },
  listInventory: () => adminStores().inventory.list(),
  listLoans: () => adminStores().loans.list(),
  listReservations: () => adminStores().flows.listReservations(),
  listContributions: () => adminStores().flows.listContributions(),
  listProcurement: () => adminStores().flows.listProcurement(),
  listOutsideLoans: () => adminStores().flows.listOutside(),
  inventoryLog: (limit: number) => adminStores().inventory.log(null, limit),
  listDonationChannels: () => adminStores().donations.listChannels(),
  listDonations: () => adminStores().donations.list(),
  seats: (uid: string) => adminStores().appointments.activeSeats(uid),
  listUnitDocuments: (periodId: string) => adminStores().unitDocuments.listForPeriod(periodId),
  listChapters: () => adminStores().chapters.listForAdmin(),
  getChapter: (id: string) => adminStores().chapters.get(id),
  chapterOfficers: (id: string) => adminStores().chapterRecords.officers(id),
  chapterReports: (id: string) => adminStores().chapterRecords.reportsOf(id),
  listPeriods: () => adminStores().periods.listForAdmin(),
  getPeriod: (id: string) => adminStores().periods.get(id),
  listOrgUnits: (periodId: string) => adminStores().orgUnits.listForPeriod(periodId),
  getOrgUnit: (id: string) => adminStores().orgUnits.get(id),
  listAppointments: (periodId: string) => adminStores().appointments.listForPeriod(periodId),
  getAppointmentRoleMap: () => adminStores().appointments.getRoleMap(),
  listPendingUniversities: () => adminStores().universities.listPending(),
  listApprovedUniversities: (countryCode: string) =>
    adminStores().universities.listApproved(countryCode),
  listCampaigns: () => adminStores().campaigns.listForAdmin(),
  listSubscribers: () => adminStores().subscribers.listForAdmin(),
  countHolders: (ids: readonly string[]) => adminStores().roles.countHolders(ids),
  signInMethods: async (uid: string) => {
    const { authAdmin, passkeys } = adminStores();
    const [methods, keys] = await Promise.all([
      authAdmin.signInMethods(uid),
      passkeys.listByUser(uid),
    ]);
    return { ...methods, passkeys: keys.length };
  },
  listObjectives: (periodId: string) => adminStores().objectives.listForPeriod(periodId),
  listPrograms: (periodId: string) => adminStores().programs.listForPeriod(periodId),
  getProgram: (id: string) => adminStores().programs.get(id),
  listCheckins: (programId: string) => adminStores().programs.listCheckins(programId),
  listProgramRevisions: (programId: string) => adminStores().programs.listRevisions(programId),
  listLpj: (periodId: string) => adminStores().lpj.listForPeriod(periodId),
  getLpj: (id: string) => adminStores().lpj.get(id),
  periodReportCard: (periodId: string) => adminStores().periodReport.card(periodId, new Date()),
  listFinance: (query: FinanceListQuery) => adminStores().finance.list(query),
  listCashEntries: (periodId: string) => adminStores().finance.listEntries(periodId),
  listMeetings: (periodId: string) => adminStores().meetings.listForPeriod(periodId),
  listMyMeetings: (uid: string) => adminStores().meetings.listForUser(uid),
  getMeeting: (id: string) => adminStores().meetings.get(id),
  listShortLinks: () => adminStores().shortLinks.list(),
  listZoom: (from: Date, to: Date) => adminStores().zoom.listBetween(from, to),
  getZoom: (id: string) => adminStores().zoom.get(id),
  zoomSettings: () => adminStores().zoom.readSettings(),
  activePeriod,
  listHolidays: () => adminStores().calendar.listHolidays(),
  sharedBoards: (uid: string) => adminStores().taskShares.listForUser(uid),
  boardShares: (orgUnitId: string) => adminStores().taskShares.listForUnit(orgUnitId),
  surveysLastYear: () => adminStores().surveys.since(new Date(Date.now() - 365 * 86_400_000)),
  recordingFiles: (bookingIds: readonly string[]) =>
    adminStores().zoom.filesForBookings(bookingIds),
  zoomSessions: (bookingIds: readonly string[]) =>
    adminStores().zoom.sessionsForBookings(bookingIds),
  listActionItems: (meetingId: string) => adminStores().actionItems.listForMeeting(meetingId),
};
