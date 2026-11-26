import "server-only";
import type { SqlLoanWebStore } from "@website/db/sql";
import { MemberLoanSchema, OutsiderLoanSchema } from "@website/domain/inventory";
import { MAX_PROOF_BYTES } from "@website/domain/members";
import type { Message } from "@website/domain/messaging";
import { isPdf, RuleViolationError } from "@website/domain/shared";
import { jsonError, readBodyLimited } from "@website/security";

export interface LoanRequestDeps {
  readonly loans: Pick<
    SqlLoanWebStore,
    "requestAsMember" | "requestAsOutsider" | "askReturn" | "cancel"
  >;
  readonly storage: {
    save(
      path: string,
      bytes: Uint8Array,
      options: { visibility: "private"; contentType: "application/octet-stream" },
    ): Promise<unknown>;
    remove(path: string): Promise<void>;
  };
  readonly send: (message: Message, key: string) => Promise<unknown>;
  readonly captcha: (token: string) => Promise<boolean>;
  readonly profileComplete: (userId: string) => Promise<boolean>;
  readonly now: () => Date;
  readonly uuid: () => string;
}

type User = { readonly uid: string; readonly email: string | null } | null;
type Refusal = "invalid" | "profile" | "captcha" | "too_large" | "not_pdf" | "unavailable";

const noStore = { "Cache-Control": "private, no-store" };
const refused = (error: Refusal, status = 400) =>
  Response.json({ ok: false, error }, { status, headers: noStore });
const created = () => Response.json({ ok: true }, { status: 201, headers: noStore });

const RECEIVED: readonly [string, string] = [
  "Permintaan peminjamanmu sudah kami terima dan menunggu persetujuan.",
  "We received your loan request and it is waiting for approval.",
];

/** Requests to borrow an item (N7.2): a member with a complete profile, or an outsider with a signed statement. */
export function createLoanRequests(deps: LoanRequestDeps) {
  const today = () => deps.now().toISOString().slice(0, 10);
  const receipt = (to: string, id: string) =>
    deps.send(
      {
        channel: "email",
        to,
        subject: "Peminjaman diterima / Loan request received",
        text: `${RECEIVED[0]}\n\n${RECEIVED[1]}`,
        html: `<p>${RECEIVED[0]}</p><p>${RECEIVED[1]}</p>`,
      },
      `loan:${id}:received`,
    );

  /** A signed-in member: the request is a small JSON body. */
  const member = async (user: User, request: Request): Promise<Response> => {
    if (!user) return jsonError("unauthenticated");
    const bytes = await readBodyLimited(request, 8_192);
    if (bytes === null) return refused("too_large", 413);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return refused("invalid");
    }
    const parsed = MemberLoanSchema.safeParse(body);
    if (!parsed.success) return refused("invalid");
    if (!(await deps.profileComplete(user.uid))) return refused("profile", 403);
    const id = deps.uuid();
    try {
      await deps.loans.requestAsMember(id, user.uid, parsed.data, deps.now(), today());
    } catch (error) {
      if (error instanceof RuleViolationError) return refused("unavailable", 409);
      throw error;
    }
    if (user.email) await receipt(user.email, id);
    return created();
  };

  /** An outsider: the fields travel in the query string, the signed statement (a PDF) is the body. */
  const outsider = async (request: Request): Promise<Response> => {
    const query = new URL(request.url).searchParams;
    const parsed = OutsiderLoanSchema.safeParse({
      itemId: query.get("item") ?? "",
      quantity: Number(query.get("quantity")),
      purpose: query.get("purpose") ?? "",
      place: query.get("place") ?? "",
      from: query.get("from") ?? "",
      to: query.get("to") ?? "",
      name: query.get("name") ?? "",
      email: query.get("email") ?? "",
      phone: query.get("phone") ?? "",
    });
    if (!parsed.success) return refused("invalid");
    if (!(await deps.captcha(request.headers.get("x-captcha-token") ?? ""))) {
      return refused("captcha", 403);
    }
    const bytes = await readBodyLimited(request, MAX_PROOF_BYTES);
    if (bytes === null) return refused("too_large", 413);
    if (!isPdf(bytes)) return refused("not_pdf");
    const id = deps.uuid();
    const path = `inventory/statements/${id}.pdf`;
    await deps.storage.save(path, bytes, {
      visibility: "private",
      contentType: "application/octet-stream", // served by the file extension
    });
    try {
      await deps.loans.requestAsOutsider(id, parsed.data, path, deps.now(), today());
    } catch (error) {
      await deps.storage.remove(path);
      if (error instanceof RuleViolationError) return refused("unavailable", 409);
      throw error;
    }
    await receipt(parsed.data.email, id);
    return created();
  };

  /** The member asks to return an item, or cancels a request that is not out yet. */
  const step = async (user: User, id: string, what: "return" | "cancel"): Promise<Response> => {
    if (!user) return jsonError("unauthenticated");
    try {
      if (what === "return") await deps.loans.askReturn(id, user.uid, deps.now());
      else await deps.loans.cancel(id, user.uid, deps.now());
    } catch (error) {
      if (error instanceof RuleViolationError) return refused("unavailable", 409);
      throw error;
    }
    return Response.json({ ok: true }, { headers: noStore });
  };

  return { member, outsider, step };
}
