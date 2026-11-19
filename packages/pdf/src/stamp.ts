import {
  concatTransformationMatrix,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  StandardFonts,
  type PDFPage,
} from "pdf-lib";
import { extractText } from "unpdf";
import { INK, MM, MUTED, printable } from "./flow";
import { drawTurned, tryEmbed, type PdfImage } from "./letter";
import { qrPng } from "./qr";

export interface PageSpot {
  readonly page: number;
  readonly xMm: number;
  readonly yMm: number;
}

export interface PageBox extends PageSpot {
  readonly wMm: number;
  readonly hMm: number;
}

export interface StampInput {
  readonly signatures: readonly {
    readonly spot: PageSpot;
    /** The signer's own signature; null when they have none (the stamp is still printed). */
    readonly image: PdfImage | null;
    readonly widthMm: number;
    readonly rotation: number;
    /** The organisation stamp, printed beside the signature. */
    readonly stamp?: PdfImage | null;
  }[];
  /** The letter's number, printed in every box (shrunk to fit its width). */
  readonly numbers?: readonly { readonly box: PageBox; readonly text: string }[];
  readonly qr: {
    readonly spot: PageSpot;
    readonly sizeMm: number;
    readonly url: string;
    readonly label: string;
    readonly code: string;
  } | null;
}

export class UnreadablePdfError extends Error {
  override readonly name = "UnreadablePdfError";
}

export async function openPdf(bytes: Uint8Array): Promise<PDFDocument> {
  const pages = async () => {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return doc.getPageCount() > 0 ? doc : null;
  };
  const doc = await pages().catch(() => null);
  if (!doc) {
    throw new UnreadablePdfError(
      "This PDF cannot be read: export it again without a password, then upload it.",
    );
  }
  return doc;
}

/**
 * The page as it is shown: its size, and the matrix that takes a point of an upright frame with
 * its origin at the shown page's bottom-left into the page's own space. Boxes are placed in
 * millimetres from the top-left of the CropBox as shown, so a box on screen is a box in the file.
 */
export function frameOf(page: PDFPage) {
  const { x, y, width, height } = page.getCropBox();
  const turn = (((Math.round(page.getRotation().angle / 90) * 90) % 360) + 360) % 360;
  const matrix =
    turn === 90
      ? [0, 1, -1, 0, x + width, y]
      : turn === 180
        ? [-1, 0, 0, -1, x + width, y + height]
        : turn === 270
          ? [0, -1, 1, 0, x, y + height]
          : [1, 0, 0, 1, x, y];
  const sideways = turn === 90 || turn === 270;
  return { width: sideways ? height : width, height: sideways ? width : height, matrix };
}

export async function stampPdf(bytes: Uint8Array, input: StampInput): Promise<Uint8Array> {
  const doc = await openPdf(bytes);
  const numbers = input.numbers ?? [];
  if (input.signatures.length === 0 && !input.qr && numbers.length === 0) return bytes;
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  type Placed = { page: PDFPage; width: number; x: number; top: number };
  const at = (spot: PageSpot): Placed => {
    const page = pages[Math.min(spot.page, pages.length) - 1] as PDFPage;
    const { width, height } = frameOf(page);
    return { page, width, x: spot.xMm * MM, top: height - spot.yMm * MM };
  };
  // Everything below is drawn upright, as the page is shown; the matrix turns it into the file.
  const framed = async (spot: PageSpot, draw: (at: Placed) => void | Promise<void>) => {
    const placed = at(spot);
    const [a, b, c, d, e, f] = frameOf(placed.page).matrix as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    placed.page.pushOperators(pushGraphicsState(), concatTransformationMatrix(a, b, c, d, e, f));
    try {
      await draw(placed);
    } finally {
      placed.page.pushOperators(popGraphicsState());
    }
  };
  for (const { box, text } of numbers) {
    await framed(box, ({ page, x, top }) => {
      const height = box.hMm * MM;
      const line = printable(text);
      const size = Math.min(height * 0.8, (box.wMm * MM) / font.widthOfTextAtSize(line, 1));
      page.drawText(line, { x, y: top - height * 0.75, size, font, color: INK });
    });
  }
  for (const signature of input.signatures) {
    const image = signature.image ? await tryEmbed(doc, signature.image) : null;
    const stamp = signature.stamp ? await tryEmbed(doc, signature.stamp) : null;
    if (!image && !stamp) continue;
    await framed(signature.spot, ({ page, width, x, top }) => {
      if (stamp) {
        const stampWidth = 28 * MM;
        page.drawImage(stamp, {
          x: Math.max(x - 10 * MM, 0),
          y: top - (stampWidth * stamp.height) / stamp.width,
          width: stampWidth,
          height: (stampWidth * stamp.height) / stamp.width,
          opacity: 0.85,
        });
      }
      if (image) {
        drawTurned(page, image, {
          x,
          top,
          width: signature.widthMm * MM,
          max: Math.max(width - x, 10 * MM),
          rotation: signature.rotation,
        });
      }
    });
  }
  if (input.qr) {
    const qr = input.qr;
    await framed(qr.spot, async ({ page, x, top }) => {
      const size = qr.sizeMm * MM;
      const image = await doc.embedPng(await qrPng(qr.url, 300));
      page.drawImage(image, { x, y: top - size, width: size, height: size });
      const lines = [printable(qr.code), printable(qr.label)];
      lines.forEach((text, i) => {
        page.drawText(text, {
          x,
          y: top - size - 8 - i * 7,
          size: i === 0 ? 7 : 5.5,
          font,
          color: MUTED,
        });
      });
    });
  }
  return doc.save();
}

export async function pdfText(bytes: Uint8Array): Promise<string> {
  try {
    const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
    return text;
  } catch {
    return "";
  }
}
