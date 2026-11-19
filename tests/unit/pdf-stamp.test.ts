import { describe, expect, it } from "vitest";
import { degrees, PDFDocument, PDFName, PDFRawStream, StandardFonts } from "pdf-lib";
import { frameOf, openPdf, pdfText, qrPng, stampPdf, UnreadablePdfError } from "@website/pdf";

const textPdf = async (text: string, pages = 1) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1)
    doc.addPage().drawText(text, { x: 50, y: 700, size: 11, font });
  return doc.save({ useObjectStreams: false });
};
const images = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).context
    .enumerateIndirectObjects()
    .filter(
      ([, object]) =>
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    ).length;

describe("stamping the author's PDF (upload path)", () => {
  it("reads the text layer; a scan or a broken file has none", async () => {
    const text = await pdfText(await textPdf("Nomor: 001 / SOP / PPIDK-ASIANIA / 2026"));
    expect(text).toContain("001 / SOP");
    expect(await pdfText(await textPdf(""))).toBe("");
    expect(await pdfText(new TextEncoder().encode("%PDF-1.7 broken"))).toBe("");
  });

  it("keeps the file byte for byte when there is nothing to stamp", async () => {
    const bytes = await textPdf("x");
    expect(await stampPdf(bytes, { signatures: [], qr: null })).toBe(bytes);
  });

  it("stamps signatures and the QR (past the last page = the last page); skips a broken image", async () => {
    const bytes = await textPdf("x", 2);
    const image = { bytes: await qrPng("sig", 120), type: "png" as const };
    const stamped = await stampPdf(bytes, {
      signatures: [
        { spot: { page: 1, xMm: 120, yMm: 220 }, image, widthMm: 40, rotation: -5 },
        {
          spot: { page: 9, xMm: 20, yMm: 220 },
          image: { bytes: new Uint8Array([1, 2]), type: "png" },
          widthMm: 40,
          rotation: 0,
        },
      ],
      qr: {
        spot: { page: 9, xMm: 170, yMm: 250 },
        sizeMm: 22,
        url: "https://verif.ppiasiania.id/8F3KM-QRTVW",
        label: "verif.ppiasiania.id",
        code: "8F3KM-QRTVW",
      },
    });
    expect(await images(stamped)).toBe(2);
    const doc = await PDFDocument.load(stamped);
    expect(doc.getPageCount()).toBe(2);
    expect(await pdfText(stamped)).toContain("8F3KM-QRTVW");
  });

  it("stamps signatures alone, without a QR", async () => {
    const image = { bytes: await qrPng("sig", 120), type: "png" as const };
    const stamped = await stampPdf(await textPdf("x"), {
      signatures: [{ spot: { page: 1, xMm: 200, yMm: 20 }, image, widthMm: 80, rotation: 0 }],
      qr: null,
    });
    expect(await images(stamped)).toBe(1);
  });

  it("refuses a locked, damaged or empty PDF with a clear message", async () => {
    const plain = new TextDecoder("latin1").decode(await textPdf("x"));
    const locked = new TextEncoder().encode(
      plain
        .replace("\nxref\n", "\n99 0 obj\n<< /Filter /Standard /V 1 >>\nendobj\n\nxref\n")
        .replace("trailer\n<<", "trailer\n<<\n/Encrypt 99 0 R"),
    );
    await expect(openPdf(locked)).rejects.toBeInstanceOf(UnreadablePdfError);
    await expect(openPdf(new TextEncoder().encode("%PDF-1.7"))).rejects.toThrow(
      "without a password",
    );
    const empty = await (await PDFDocument.create()).save({ addDefaultPage: false });
    await expect(stampPdf(empty, { signatures: [], qr: null })).rejects.toBeInstanceOf(
      UnreadablePdfError,
    );
  });
});

describe("boxes on the page (14.2)", () => {
  const MM = 72 / 25.4;
  // A4 page whose CropBox does not start at the origin, turned the way a scanner turns it.
  const turned = async (angle: number) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setCropBox(10, 20, 500, 700);
    page.setRotation(degrees(angle));
    return page;
  };
  // Where the displayed top-left corner and one displayed point land in the page's own space.
  const apply = (m: readonly number[], x: number, y: number) => [
    (m[0] as number) * x + (m[2] as number) * y + (m[4] as number),
    (m[1] as number) * x + (m[3] as number) * y + (m[5] as number),
  ];

  it("measures from the top-left corner of the CropBox as the page is shown, for every turn", async () => {
    const expected: Record<
      number,
      { size: number[]; topLeft: number[]; right: number[]; down: number[] }
    > = {
      0: { size: [500, 700], topLeft: [10, 720], right: [11, 720], down: [10, 719] },
      90: { size: [700, 500], topLeft: [10, 20], right: [10, 21], down: [11, 20] },
      180: { size: [500, 700], topLeft: [510, 20], right: [509, 20], down: [510, 21] },
      270: { size: [700, 500], topLeft: [510, 720], right: [510, 719], down: [509, 720] },
    };
    for (const angle of [0, 90, 180, 270]) {
      const { width, height, matrix } = frameOf(await turned(angle));
      const want = expected[angle] as (typeof expected)[number];
      expect([width, height], `${angle} size`).toEqual(want.size);
      // Displayed frame: origin bottom-left, y up. Its top-left is (0, height).
      expect(apply(matrix, 0, height), `${angle} top-left`).toEqual(want.topLeft);
      expect(apply(matrix, 1, height), `${angle} right`).toEqual(want.right);
      expect(apply(matrix, 0, height - 1), `${angle} down`).toEqual(want.down);
    }
  });

  it("an upright page without a CropBox is the plain page: 1 mm is 1 mm from its top-left", async () => {
    const doc = await PDFDocument.create();
    const frame = frameOf(doc.addPage([595.28, 841.89]));
    expect(frame).toEqual({ width: 595.28, height: 841.89, matrix: [1, 0, 0, 1, 0, 0] });
    expect(apply(frame.matrix, 20 * MM, frame.height - 40 * MM)).toEqual([
      20 * MM,
      841.89 - 40 * MM,
    ]);
  });

  it("prints the number into every box, shrinks it to fit and stamps on turned pages too", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595.28, 841.89]);
    const second = doc.addPage([595.28, 841.89]);
    second.setRotation(degrees(90));
    const bytes = await doc.save({ useObjectStreams: false });
    const stamp = { bytes: await qrPng("stamp", 120), type: "png" as const };
    const stamped = await stampPdf(bytes, {
      signatures: [
        { spot: { page: 2, xMm: 120, yMm: 220 }, image: null, widthMm: 40, rotation: 0, stamp },
      ],
      qr: null,
      numbers: [
        {
          box: { page: 1, xMm: 20, yMm: 40, wMm: 90, hMm: 6 },
          text: "001/SK/PPIDK-ASIANIA/XI/2026",
        },
        {
          box: { page: 2, xMm: 20, yMm: 40, wMm: 20, hMm: 6 },
          text: "001/SK/PPIDK-ASIANIA/XI/2026",
        },
      ],
    });
    const text = await pdfText(stamped);
    expect(text.match(/001\/SK\/PPIDK-ASIANIA\/XI\/2026/g)).toHaveLength(2);
    expect(await images(stamped)).toBe(1);
    const reopened = await PDFDocument.load(stamped);
    expect(reopened.getPage(1).getRotation().angle).toBe(90);
  });

  it("a signature with a stamp but no personal signature image still prints the stamp", async () => {
    const stamp = { bytes: await qrPng("stamp", 120), type: "png" as const };
    const none = await stampPdf(await textPdf("x"), {
      signatures: [
        { spot: { page: 1, xMm: 120, yMm: 220 }, image: null, widthMm: 40, rotation: 0 },
      ],
      qr: null,
    });
    expect(await images(none)).toBe(0);
    const both = await stampPdf(await textPdf("x"), {
      signatures: [
        {
          spot: { page: 1, xMm: 120, yMm: 220 },
          image: { bytes: await qrPng("sig", 120), type: "png" },
          widthMm: 40,
          rotation: 0,
          stamp,
        },
      ],
      qr: null,
    });
    expect(await images(both)).toBe(2);
  });
});
