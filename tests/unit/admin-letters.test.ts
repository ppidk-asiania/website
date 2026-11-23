import { describe, expect, it } from "vitest";
import {
  LETTER_TABS,
  letterActions,
  matchesLetterTab,
  showsFilePanel,
  toLetterItem,
  type LetterItem,
} from "../../apps/admin/src/components/letters-model";
import type { Letter, LetterType } from "@website/domain/documents";

const at = new Date("2026-11-02T03:00:00Z");
const letter: Letter = {
  id: "l1",
  version: 3,
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
  periodId: "p1",
  typeId: "sk",
  orgUnitId: "sekjen",
  orgUnitPath: ["sekjen"],
  subject: "SK Panitia",
  body: "<p>x</p>",
  recipient: "",
  place: "Tokyo",
  attachmentNote: "",
  letterDate: "2026-11-02",
  status: "corrected",
  source: "editor",
  createdBy: "author",
  reviewedBy: "sekre",
  reviewNote: null,
  secretary: { uid: "sekjen", at },
  coordinator: null,
  number: null,
  numberFormatted: null,
  verificationCode: null,
  issuedAt: null,
  cancelledAt: null,
  cancelReason: null,
  contentDigest: null,
  signers: [],
  letterhead: null,
  archive: null,
  upload: null,
  placement: null,
  activityCode: null,
  topDeskOnly: false,
  initialsBox: false,
  draftUrl: null,
  signedBy: [],
  sheetNumberTemplate: null,
};
const type = {
  name: "Surat Keputusan",
  code: "SK",
  requiresCoordinator: true,
  requiresRecipient: false,
} as LetterType;
const names = new Map([
  ["sekjen", "Rina"],
  ["author", "Ari"],
]);
const none = { review: false, sign: false, signCoordinator: false, issue: false, cancel: false };
const item = (extra: Partial<LetterItem> = {}) => ({
  ...toLetterItem(letter, type, "Sekretariat", names, false),
  ...extra,
});

describe("Letters page model", () => {
  it("maps a letter for the page (names, desks, labels)", () => {
    expect(item()).toMatchObject({
      typeName: "Surat Keputusan",
      typeCode: "SK",
      unitName: "Sekretariat",
      statusLabel: "Corrected (to sign)",
      authorName: "Ari",
      secretary: { uid: "sekjen", name: "Rina", at: at.toISOString() },
      coordinator: null,
      requiresCoordinator: true,
      requiresRecipient: false,
      issuedAt: null,
    });
    const unknown = toLetterItem(
      { ...letter, createdBy: "x", issuedAt: at, secretary: { uid: "y", at } },
      undefined,
      "",
      names,
      true,
    );
    expect(unknown).toMatchObject({
      typeName: "",
      typeCode: "",
      authorName: "x",
      secretary: { name: "y" },
      requiresCoordinator: false,
      requiresRecipient: true,
      issuedAt: at.toISOString(),
      canEdit: true,
    });
  });

  it("tabs group the statuses by desk", () => {
    expect(LETTER_TABS.map((t) => t.key)).toEqual([
      "all",
      "draft",
      "review",
      "corrected",
      "approved",
      "issued",
      "cancelled",
    ]);
    expect(matchesLetterTab({ status: "awaiting_file" }, "approved")).toBe(true);
    expect(matchesLetterTab({ status: "approved" }, "approved")).toBe(true);
    expect(matchesLetterTab({ status: "issued" }, "all")).toBe(true);
    expect(matchesLetterTab({ status: "issued" }, "draft")).toBe(false);
  });

  it("a top-desk letter offers only the top desk's signature and carries its options", () => {
    const alone = item({ topDeskOnly: true, secretary: null, initialsBox: true });
    expect(alone).toMatchObject({ topDeskOnly: true, initialsBox: true, draftUrl: null });
    expect(letterActions(alone, { ...none, sign: true }, "sekjen")).toEqual([]);
    expect(letterActions(alone, { ...none, signCoordinator: true }, "koor")).toEqual([
      "signCoordinator",
    ]);
    expect(
      letterActions(
        item({ topDeskOnly: true, requiresCoordinator: false, secretary: null }),
        { ...none, signCoordinator: true },
        "koor",
      ),
    ).toEqual(["signCoordinator"]);
  });

  it("shows only the buttons the viewer's desks allow", () => {
    expect(letterActions(item(), { ...none, sign: true, signCoordinator: true }, "sekjen")).toEqual(
      [],
    );
    expect(letterActions(item(), { ...none, signCoordinator: true }, "koor")).toEqual([
      "signCoordinator",
    ]);
    expect(
      letterActions(
        item({ secretary: null, coordinator: { uid: "koor", name: "K", at: "" } }),
        { ...none, sign: true },
        "koor",
      ),
    ).toEqual([]);
    expect(letterActions(item({ secretary: null }), { ...none, sign: true }, "sekjen")).toEqual([
      "signSecretary",
    ]);
    expect(
      letterActions(
        item({ requiresCoordinator: false }),
        { ...none, signCoordinator: true },
        "koor",
      ),
    ).toEqual([]);
    expect(letterActions(item({ status: "draft", canEdit: true }), none, "author")).toEqual([
      "edit",
      "submit",
      "delete",
    ]);
    expect(
      letterActions(item({ status: "review", canEdit: true }), { ...none, review: true }, "s"),
    ).toEqual(["edit", "pass", "return"]);
    expect(
      letterActions(item({ status: "approved" }), { ...none, review: true, issue: true }, "s"),
    ).toEqual(["return", "issue"]);
    expect(letterActions(item({ status: "issued" }), { ...none, cancel: true }, "s")).toEqual([
      "cancel",
    ]);
    expect(
      letterActions(item({ status: "awaiting_file" }), { ...none, cancel: true }, "s"),
    ).toEqual(["cancel"]);
    const file = { size: 1, numberChecked: false, uploadedAt: at.toISOString() };
    expect(letterActions(item({ status: "awaiting_file" }), { ...none, issue: true }, "s")).toEqual(
      [],
    );
    expect(
      letterActions(item({ status: "awaiting_file", upload: file }), { ...none, issue: true }, "s"),
    ).toEqual([]);
    const placement = {
      numbers: [],
      qr: { page: 1, xMm: 175, yMm: 255, sizeMm: 22 },
      secretary: { page: 1, xMm: 130, yMm: 230, wMm: null, withStamp: false },
      coordinator: null,
    };
    expect(
      letterActions(
        item({ status: "awaiting_file", upload: file, placement }),
        { ...none, issue: true },
        "s",
      ),
    ).toEqual(["issueFile"]);
    expect(
      letterActions(
        item({ status: "cancelled" }),
        { review: true, sign: true, signCoordinator: true, issue: true, cancel: true },
        "s",
      ),
    ).toEqual([]);
  });
});

describe("upload letters in the list", () => {
  it("carry their source, file and stamp positions (dates as text)", () => {
    const uploaded = toLetterItem(
      {
        ...letter,
        source: "upload",
        status: "awaiting_file",
        upload: {
          path: "p",
          sha256: "s",
          size: 9,
          numberChecked: true,
          uploadedBy: "author",
          uploadedAt: at,
        },
        placement: {
          numbers: [],
          qr: null,
          secretary: { page: 1, xMm: 1, yMm: 2, wMm: null, withStamp: false },
          coordinator: null,
        },
      },
      type,
      "Sekretariat",
      names,
      true,
    );
    expect(uploaded).toMatchObject({
      source: "upload",
      upload: { size: 9, numberChecked: true, uploadedAt: at.toISOString() },
      placement: { secretary: { page: 1, xMm: 1, yMm: 2 } },
    });
    expect(item().upload).toBeNull();
  });
});

describe("manual letters and the file panel (14.2)", () => {
  const issuer = { ...none, issue: true };
  it("a manual draft is numbered straight away (no review) and finished with its file", () => {
    expect(
      letterActions(item({ status: "draft", source: "manual", canEdit: true }), issuer, "s"),
    ).toEqual(["edit", "delete", "issue"]);
    expect(
      letterActions(item({ status: "draft", source: "upload", canEdit: true }), issuer, "s"),
    ).toEqual(["edit", "submit", "delete"]);
    const file = { size: 1, numberChecked: true, uploadedAt: at.toISOString() };
    expect(
      letterActions(item({ status: "awaiting_file", source: "manual", upload: file }), issuer, "s"),
    ).toEqual(["issueFile"]);
    expect(letterActions(item({ status: "awaiting_file", source: "manual" }), issuer, "s")).toEqual(
      [],
    );
  });

  it("shows the Final PDF panel while an own-PDF letter is editable or waiting, a manual one once numbered", () => {
    expect(showsFilePanel({ source: "upload", status: "draft" })).toBe(true);
    expect(showsFilePanel({ source: "upload", status: "review" })).toBe(true);
    expect(showsFilePanel({ source: "upload", status: "awaiting_file" })).toBe(true);
    expect(showsFilePanel({ source: "upload", status: "issued" })).toBe(false);
    expect(showsFilePanel({ source: "manual", status: "draft" })).toBe(false);
    expect(showsFilePanel({ source: "manual", status: "awaiting_file" })).toBe(true);
    expect(showsFilePanel({ source: "editor", status: "draft" })).toBe(false);
  });

  it("carries the signers typed for a manual letter", () => {
    const manual = toLetterItem(
      { ...letter, source: "manual", signedBy: [{ name: "Rina", seat: "Sekjen" }] },
      type,
      "Sekretariat",
      names,
      true,
    );
    expect(manual.signedBy).toEqual([{ name: "Rina", seat: "Sekjen" }]);
  });
});
