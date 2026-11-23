import "server-only";
import { z } from "zod";
import type { AuditEvent } from "@website/audit";
import type { SqlAnalysisStore, SqlApplicationStore, SqlMemberProfileStore } from "@website/db/sql";
import { answerText, type FileAnswer, type FormVersion } from "@website/domain/forms";
import { PROOF_CONTENT_TYPES } from "@website/domain/members";
import {
  AnalysisOutputSchema,
  ProofCheckOutputSchema,
  pickFiles,
  waitingFor,
  type AnalysisFileRef,
  type ApplicationAnalysis,
  type Recruitment,
  type SkippedFile,
} from "@website/domain/recruitment";
import { RuleViolationError } from "@website/domain/shared";
import { can, type Principal } from "@website/permissions";
import { safeId } from "@website/security/validation";
import type { CallModel } from "./anthropic";
import { createGuardedAction } from "./guarded-action";

export interface AnalysisDeps {
  readonly analyses: Pick<
    SqlAnalysisStore,
    "queue" | "claimNext" | "finish" | "fail" | "latestFor" | "addProofCheck" | "latestChecks"
  >;
  readonly applications: Pick<SqlApplicationStore, "get">;
  readonly recruitments: { get(id: string): Promise<Recruitment | null> };
  readonly formVersion: (formId: string, version: number) => Promise<FormVersion | null>;
  readonly profiles: Pick<SqlMemberProfileStore, "findByUserId">;
  readonly chapterName: (id: string) => Promise<string | null>;
  readonly storage: { read(path: string): Promise<Uint8Array | null> };
  /** null = no API key: the buttons refuse and the cron job leaves the queue alone. */
  readonly callModel: CallModel | null;
  readonly now: () => Date;
  readonly uuid: () => string;
}

const ANALYSIS_TOOL = {
  name: "application_analysis",
  description: "Notes for the committee on one application.",
  input_schema: z.toJSONSchema(AnalysisOutputSchema),
};
const PROOF_TOOL = {
  name: "proof_check",
  description: "How a student-status document compares with the registration data.",
  input_schema: z.toJSONSchema(ProofCheckOutputSchema),
};

const ANALYSIS_SYSTEM =
  "You help the recruitment committee of an Indonesian student association read ONE application. " +
  "Summarise the CV and the documents. For each unit the applicant chose, give supporting points " +
  "and questions to ask in the interview. List things the committee should check. Use ONLY the " +
  "data and files given; invent nothing. Give no score, no rating, no ranking and no " +
  "recommendation to accept or reject. Write in the language of the application.";
const PROOF_SYSTEM =
  "You compare a student-status document (and an optional student card) with registration data. " +
  "For each field say match, differs or unreadable. Say whether the document states that the " +
  "student is currently active on the given date: yes, no or unreadable. Judge nothing else and " +
  "give no recommendation.";

const AI_OFF = "AI is not set up (no API key).";
const isFile = (value: unknown): value is FileAnswer =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The audit entry of the cron job (no person is signed in). */
const systemAudit = (
  deps: AnalysisDeps,
  row: ApplicationAnalysis,
  after: AuditEvent["after"],
): AuditEvent => ({
  id: deps.uuid(),
  occurredAt: deps.now(),
  actor: { type: "system", id: "ai-jobs" },
  action: "UPDATE",
  module: "recruitment",
  title: row.applicationId,
  resourceType: "analysis",
  resourceId: row.id,
  operationId: deps.uuid(),
  before: null,
  after,
  versionBefore: null,
  versionAfter: null,
  revertible: false,
  revertOf: null,
  request: { requestId: deps.uuid() },
  prevHash: null,
  hash: null,
});

export function createAnalysisActions(deps: AnalysisDeps) {
  const need = () => {
    if (!deps.callModel) throw new RuleViolationError(AI_OFF);
    return deps.callModel;
  };

  /** Allowed files read as model blocks; everything left out is listed with its reason. */
  async function attach(refs: readonly AnalysisFileRef[]) {
    const { files, skipped } = pickFiles(refs);
    const blocks: unknown[] = [];
    for (const f of files) {
      const data = await deps.storage.read(f.path);
      if (!data) {
        skipped.push({ label: f.label, reason: "file missing" });
        continue;
      }
      blocks.push(
        { type: "text", text: `File: ${f.label}` },
        {
          type: f.contentType === "application/pdf" ? "document" : "image",
          source: {
            type: "base64",
            media_type: f.contentType,
            data: Buffer.from(data).toString("base64"),
          },
        },
      );
    }
    return { blocks, skipped };
  }

  const toolInput = (answer: Awaited<ReturnType<CallModel>>, name: string) =>
    answer.content.find((c) => c.type === "tool_use" && c.name === name)?.input;

  async function analyse(row: ApplicationAnalysis) {
    const application = await deps.applications.get(row.applicationId);
    const recruitment = application && (await deps.recruitments.get(application.recruitmentId));
    if (!application || !recruitment) throw new RuleViolationError("This application is gone.");
    const [form, profile] = await Promise.all([
      deps.formVersion(recruitment.formId, recruitment.formVersion),
      deps.profiles.findByUserId(application.userId),
    ]);
    const questions = form?.questions ?? [];
    const refs: AnalysisFileRef[] = [];
    const texts: { question: string; answer: string }[] = [];
    for (const q of questions) {
      const value = application.answers[q.id];
      if (value === undefined) continue;
      if (isFile(value)) {
        refs.push({
          label: q.label,
          path: value.path,
          contentType: value.contentType,
          size: value.size,
        });
      } else texts.push({ question: q.label, answer: answerText(value) });
    }
    const { portfolio } = application;
    if (portfolio) {
      refs.push({ label: "Portfolio", ...portfolio, contentType: portfolio.contentType });
    }
    const { blocks, skipped } = await attach(refs);
    // a late file ("may follow") that has not arrived is no error, only noted
    const late: SkippedFile[] = waitingFor(questions, application.answers).map((q) => ({
      label: q.label,
      reason: "has not arrived yet",
    }));
    // only these fields of the member are ever sent
    const study = profile && {
      university: profile.university,
      level: profile.educationLevel,
      programme: profile.majors,
      entryYear: profile.yearOfEntry,
      graduationYear: profile.estimatedGraduationYear,
    };
    const choices = application.choices.map((id) => ({
      orgUnitId: id,
      name: recruitment.units.find((u) => u.orgUnitId === id)?.name ?? id,
    }));
    const answer = await need()("applicationAnalysis", row.requestedBy, {
      max_tokens: 4000,
      system: ANALYSIS_SYSTEM,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: "tool", name: ANALYSIS_TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: JSON.stringify({ study, choices, answers: texts }) },
            ...blocks,
          ],
        },
      ],
    });
    const result = AnalysisOutputSchema.safeParse(toolInput(answer, ANALYSIS_TOOL.name));
    if (!result.success) throw new Error("anthropic_invalid_answer");
    return { result: result.data, skipped: [...skipped, ...late] };
  }

  const queue = createGuardedAction({
    permission: "recruitment.ai",
    input: z.object({ id: safeId }).strict(),
    handler: async ({ id }, principal, audit) => {
      need();
      const application = await deps.applications.get(id);
      if (!application || application.status === "draft") {
        throw new RuleViolationError("Only a submitted application can be analysed.");
      }
      const row: ApplicationAnalysis = {
        id: deps.uuid(),
        applicationId: id,
        status: "queued",
        requestedBy: principal.userId,
        requestedAt: deps.now(),
        startedAt: null,
        finishedAt: null,
        result: null,
        skipped: [],
        error: null,
      };
      await deps.analyses.queue(
        row,
        audit({
          module: "recruitment",
          action: "CREATE",
          resourceType: "analysis",
          resourceId: row.id,
          title: id,
          before: null,
          after: { status: "queued", applicationId: id },
          versionBefore: null,
          versionAfter: null,
          revertible: false,
        }),
      );
      return { id: row.id };
    },
  });

  const checkProof = createGuardedAction({
    permission: "recruitment.ai",
    input: z.object({ id: safeId }).strict(),
    handler: async ({ id }, principal, audit) => {
      const callModel = need();
      const application = await deps.applications.get(id);
      const profile = application && (await deps.profiles.findByUserId(application.userId));
      const proof = profile?.studentProof;
      if (!application || !profile || !proof) {
        throw new RuleViolationError("No proof has been uploaded.");
      }
      // size 0: the 5 MB limit and the type were checked when the member uploaded the file
      const files = [
        { label: "Main proof", file: proof.main },
        ...(proof.supporting ? [{ label: "Supporting file", file: proof.supporting }] : []),
      ].map(({ label, file }) => ({
        label,
        path: file.path,
        contentType: PROOF_CONTENT_TYPES[file.type],
        size: 0,
      }));
      const { blocks, skipped } = await attach(files);
      if (skipped.some((s) => s.label === "Main proof")) {
        throw new RuleViolationError("The main proof file cannot be read.");
      }
      const request = {
        today: deps.now().toISOString().slice(0, 10),
        name: profile.fullName,
        campus: profile.university,
        level: profile.educationLevel,
        programme: profile.majors,
        entryYear: profile.yearOfEntry,
        chapter: profile.chapterId ? await deps.chapterName(profile.chapterId) : null,
      };
      const answer = await callModel("proofCheck", principal.userId, {
        max_tokens: 1000,
        system: PROOF_SYSTEM,
        tools: [PROOF_TOOL],
        tool_choice: { type: "tool", name: PROOF_TOOL.name },
        messages: [
          { role: "user", content: [{ type: "text", text: JSON.stringify(request) }, ...blocks] },
        ],
      });
      const result = ProofCheckOutputSchema.safeParse(toolInput(answer, PROOF_TOOL.name));
      if (!result.success) throw new RuleViolationError("The check gave no usable answer.");
      const check = {
        id: deps.uuid(),
        uid: application.userId,
        by: principal.userId,
        at: deps.now(),
        result: result.data,
      };
      await deps.analyses.addProofCheck(
        check,
        audit({
          module: "recruitment",
          action: "CREATE",
          resourceType: "proofCheck",
          resourceId: check.id,
          title: id,
          before: null,
          after: { activeStatus: result.data.activeStatus },
          versionBefore: null,
          versionAfter: null,
          revertible: false,
        }),
      );
      return { result: result.data };
    },
  });

  return {
    queue,
    checkProof,

    /** The `ai-jobs` cron job: ONE queued row per call; a failure is kept and never retried. */
    async runNext(): Promise<Record<string, unknown>> {
      if (!deps.callModel) return { processed: 0, reason: "no_api_key" };
      const row = await deps.analyses.claimNext(deps.now());
      if (!row) return { processed: 0 };
      try {
        const done = await analyse(row);
        await deps.analyses.finish(
          row.id,
          done,
          deps.now(),
          systemAudit(deps, row, { status: "done", skippedFiles: done.skipped.length }),
        );
        return { processed: 1, status: "done" };
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 200) : "failed";
        await deps.analyses.fail(
          row.id,
          message,
          deps.now(),
          systemAudit(deps, row, { status: "failed", error: message }),
        );
        return { processed: 1, status: "failed" };
      }
    },

    /** Only `recruitment.ai` holders get anything back. */
    async read(principal: Principal, applicationIds: readonly string[], uids: readonly string[]) {
      if (!can(principal, "recruitment.ai")) return { analyses: {}, proofChecks: {} };
      const [analyses, proofChecks] = await Promise.all([
        deps.analyses.latestFor(applicationIds),
        deps.analyses.latestChecks(uids),
      ]);
      return {
        analyses: Object.fromEntries(analyses),
        proofChecks: Object.fromEntries(proofChecks),
      };
    },
  };
}
