import { beforeEach, describe, expect, it } from "vitest";
import { createSqlAiStore, createSqlAnalysisStore } from "@website/db/sql";
import type { FormVersion } from "@website/domain/forms";
import type { Application, Recruitment } from "@website/domain/recruitment";
import { pickFiles } from "@website/domain/recruitment";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createAnalysisActions } from "../../apps/admin/src/server/ai-analysis";
import { createCallModel } from "../../apps/admin/src/server/anthropic";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlAnalysisStore>[0];
const now = new Date("2026-11-16T09:00:00Z");
const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "boss",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const context = () =>
  Promise.resolve({ actorEmail: "boss@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

const MB = 1024 * 1024;
const file = (path: string, contentType: string, size: number) =>
  ({ path, name: path.split("/").pop(), contentType, size }) as never;

const application = {
  id: "r1_u1",
  recruitmentId: "r1",
  userId: "u1",
  status: "submitted",
  choices: ["unitA"],
  answers: {
    q1: "I like to draw posters",
    q2: file("forms/f1/cv.pdf", "application/pdf", 1000),
    q4: file("forms/f1/big.pdf", "application/pdf", 6 * MB),
    q5: file("forms/f1/notes.txt", "text/plain", 10),
  },
  portfolio: file("recruitment/r1/u1/portfolio.pdf", "application/pdf", 2000),
} as unknown as Application;

const recruitment = {
  id: "r1",
  formId: "f1",
  formVersion: 1,
  units: [{ orgUnitId: "unitA", name: "Design unit", quota: 3, portfolioRequired: false }],
} as unknown as Recruitment;

const q = (id: string, type: string, label: string, mayFollow = false) => ({
  id,
  type,
  label,
  description: "",
  required: false,
  options: [],
  allowOther: false,
  maxSelections: null,
  min: null,
  max: null,
  ...(mayFollow ? { mayFollow: true } : {}),
});
const form = {
  questions: [
    q("q1", "long_text", "Why this unit?"),
    q("q2", "file", "CV"),
    q("q3", "file", "Recommendation letter", true),
    q("q4", "file", "Big file"),
    q("q5", "file", "Notes"),
  ],
} as unknown as FormVersion;

const profile = {
  userId: "u1",
  fullName: "Siti Rahma",
  gender: "female",
  dateOfBirth: "2001-02-03",
  whatsappNumber: "+819012345678",
  addressAbroad: { line1: "1-2-3 Secret Street", city: "Tokyo", countryCode: "JP" },
  addressIndonesia: { line1: "Jalan Rahasia 9", city: "Bandung", province: "Jawa Barat" },
  emergencyContact: { phone: "+6281200000000" },
  email: "siti@example.org",
  university: "Tokyo Uni",
  educationLevel: "master",
  majors: ["Design"],
  yearOfEntry: 2025,
  estimatedGraduationYear: 2027,
  chapterId: "jp",
  studentProof: {
    main: { path: "members/proofs/u1/main_1.pdf", type: "pdf" },
    supporting: { path: "members/proofs/u1/supporting_1.jpg", type: "jpeg" },
  },
};
const FORBIDDEN = [
  "female",
  "2001-02-03",
  "+819012345678",
  "Secret Street",
  "Jalan Rahasia",
  "+6281200000000",
  "siti@example.org",
];

const tool = (name: string, input: unknown) => ({
  usage: { input_tokens: 10, output_tokens: 5 },
  content: [{ type: "tool_use", name, input }],
});
const ANALYSIS = {
  summary: "A designer.",
  units: [{ orgUnitId: "unitA", supporting: ["Posters"], questions: ["Which tool?"] }],
  checks: ["CV dates"],
};
const PROOF = {
  fields: {
    name: "match",
    campus: "match",
    level: "differs",
    programme: "match",
    entryYear: "unreadable",
    chapter: "match",
  },
  activeStatus: "yes",
};

let fake: ReturnType<typeof fakeDb>;
let bodies: string[];
let ticks = 0;
let reply: () => Response;
const bytes = new Map<string, Uint8Array>();

const build = (apiKey = true) => {
  const db = fake.db as unknown as Db;
  const analyses = createSqlAnalysisStore(db);
  const ai = createSqlAiStore(db);
  return {
    analyses,
    actions: createAnalysisActions({
      analyses,
      applications: { get: () => Promise.resolve(application) },
      recruitments: { get: () => Promise.resolve(recruitment) },
      formVersion: () => Promise.resolve(form),
      profiles: { findByUserId: () => Promise.resolve(profile as never) },
      chapterName: () => Promise.resolve("PPI Japan"),
      storage: { read: (path) => Promise.resolve(bytes.get(path) ?? null) },
      callModel: apiKey
        ? createCallModel({
            apiKey: "k",
            fetchImpl: ((_url: string, init: { body: string }) => {
              bodies.push(init.body);
              return Promise.resolve(reply());
            }) as never,
            modelFor: () => Promise.resolve("claude-sonnet-4-5"),
            recordUsage: (row) => ai.recordUsage(row),
            now: () => now,
          })
        : null,
      now: () => new Date(now.getTime() + 1000 * ++ticks),
      uuid: (() => {
        let n = 0;
        return () => `id${++n}`;
      })(),
    }),
  };
};
const ok = (body: unknown) => () => Response.json(body);

beforeEach(() => {
  fake = fakeDb();
  bodies = [];
  reply = ok(tool("application_analysis", ANALYSIS));
  bytes.clear();
  bytes.set("forms/f1/cv.pdf", new Uint8Array([1, 2, 3]));
  bytes.set("recruitment/r1/u1/portfolio.pdf", new Uint8Array([4, 5]));
  bytes.set("members/proofs/u1/main_1.pdf", new Uint8Array([6]));
  bytes.set("members/proofs/u1/supporting_1.jpg", new Uint8Array([7]));
});

describe("pickFiles (step 11.9)", () => {
  it("skips another type, a file over 5 MB and what goes past 20 MB in all, with the reason", () => {
    const pdf = (label: string, size: number) => ({
      label,
      path: label,
      contentType: "application/pdf",
      size,
    });
    const { files, skipped } = pickFiles([
      pdf("a", 5 * MB),
      pdf("b", 5 * MB),
      pdf("c", 5 * MB),
      pdf("d", 5 * MB),
      pdf("e", 1),
      pdf("f", 5 * MB + 1),
      { label: "g", path: "g", contentType: "text/plain", size: 1 },
    ]);
    expect(files.map((f) => f.label)).toEqual(["a", "b", "c", "d"]);
    expect(skipped).toEqual([
      { label: "e", reason: "total over 20 MB" },
      { label: "f", reason: "file over 5 MB" },
      { label: "g", reason: "file type not accepted" },
    ]);
  });
});

describe("application analysis (step 11.9)", () => {
  it("is queued by the button and claimed once by two cron calls; the result appears", async () => {
    const { actions, analyses } = build();
    const boss = staff(["recruitment.ai"]);
    const queued = await actions.queue(...as(boss))({ id: "r1_u1" });
    expect(queued).toMatchObject({ ok: true });
    expect(await analyses.latestFor(["r1_u1"])).toMatchObject(
      new Map([["r1_u1", { status: "queued" }]]),
    );
    expect(bodies).toHaveLength(0);

    const runs = await Promise.all([actions.runNext(), actions.runNext()]);
    expect(runs.map((r) => r["processed"]).sort()).toEqual([0, 1]);
    expect(bodies).toHaveLength(1);

    const latest = (await actions.read(boss, ["r1_u1"], ["u1"])).analyses["r1_u1"];
    expect(latest).toMatchObject({ status: "done", result: ANALYSIS });
    // audit entries: the request and the run; one usage row for the one model call
    expect(fake.writes.filter((w) => w.path.startsWith("auditLogs/"))).toHaveLength(2);
    expect(fake.writes.filter((w) => w.path.startsWith("aiUsage/"))).toHaveLength(1);
    // nothing left for a later call, no retry
    expect(await actions.runNext()).toMatchObject({ processed: 0 });
  });

  it("lists the skipped files and the late file that has not arrived, and sends the others", async () => {
    const { actions } = build();
    await actions.queue(...as(staff(["recruitment.ai"])))({ id: "r1_u1" });
    await actions.runNext();
    const stored = (await actions.read(staff(["recruitment.ai"]), ["r1_u1"], [])).analyses["r1_u1"];
    expect(stored?.skipped).toEqual(
      expect.arrayContaining([
        { label: "Big file", reason: "file over 5 MB" },
        { label: "Notes", reason: "file type not accepted" },
        { label: "Recommendation letter", reason: "has not arrived yet" },
      ]),
    );
    const sent = JSON.parse(bodies[0] ?? "{}") as {
      messages: Array<{ content: Array<{ type: string }> }>;
    };
    expect(sent.messages[0]?.content.filter((c) => c.type === "document")).toHaveLength(2);
  });

  it("never sends gender, birth date, WhatsApp number, photo or address (analysis and proof check)", async () => {
    const { actions } = build();
    const boss = staff(["recruitment.ai"]);
    await actions.queue(...as(boss))({ id: "r1_u1" });
    await actions.runNext();
    reply = ok(tool("proof_check", PROOF));
    await actions.checkProof(...as(boss))({ id: "r1_u1" });
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      for (const secret of FORBIDDEN) expect(body).not.toContain(secret);
      expect(body).not.toMatch(/photo|gender|dateOfBirth|whatsapp|address/i);
    }
    expect(bodies[0]).toContain("Tokyo Uni");
    expect(bodies[1]).toContain("Siti Rahma");
    expect(bodies[1]).toContain("PPI Japan");
    expect(bodies[1]).toContain("2026-11-16");
  });

  it("keeps the error of a failed run, never retries it, and can be run again", async () => {
    const { actions } = build();
    const boss = staff(["recruitment.ai"]);
    reply = () => new Response("no", { status: 500 });
    await actions.queue(...as(boss))({ id: "r1_u1" });
    expect(await actions.runNext()).toMatchObject({ processed: 1 });
    expect((await actions.read(boss, ["r1_u1"], [])).analyses["r1_u1"]).toMatchObject({
      status: "failed",
      error: "anthropic_500",
    });
    expect(await actions.runNext()).toMatchObject({ processed: 0 });
    reply = ok(tool("application_analysis", ANALYSIS));
    await actions.queue(...as(boss))({ id: "r1_u1" });
    await actions.runNext();
    expect((await actions.read(boss, ["r1_u1"], [])).analyses["r1_u1"]).toMatchObject({
      status: "done",
    });
  });

  it("does not queue twice, nor for others, nor without the API key", async () => {
    const { actions } = build();
    const boss = staff(["recruitment.ai"]);
    await actions.queue(...as(boss))({ id: "r1_u1" });
    expect(await actions.queue(...as(boss))({ id: "r1_u1" })).toMatchObject({ ok: false });
    expect(
      await actions.queue(...as(staff(["recruitment.review"])))({ id: "r1_u1" }),
    ).toMatchObject({ ok: false, error: "forbidden" });
    expect(await build(false).actions.queue(...as(boss))({ id: "r1_u1" })).toMatchObject({
      ok: false,
    });
  });

  it("hides results and proof checks from anyone without the extra", async () => {
    const { actions } = build();
    const boss = staff(["recruitment.ai"]);
    await actions.queue(...as(boss))({ id: "r1_u1" });
    await actions.runNext();
    reply = ok(tool("proof_check", PROOF));
    expect(await actions.checkProof(...as(boss))({ id: "r1_u1" })).toMatchObject({
      ok: true,
      data: { result: PROOF },
    });
    const seen = await actions.read(boss, ["r1_u1"], ["u1"]);
    expect(seen.proofChecks["u1"]?.result).toEqual(PROOF);

    for (const other of [staff(["recruitment.review", "recruitment.read"]), staff(["ai.read"])]) {
      expect(await actions.read(other, ["r1_u1"], ["u1"])).toEqual({
        analyses: {},
        proofChecks: {},
      });
      expect(await actions.checkProof(...as(other))({ id: "r1_u1" })).toMatchObject({
        ok: false,
        error: "forbidden",
      });
    }
  });
});
