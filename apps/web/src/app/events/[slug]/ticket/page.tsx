import type { Metadata } from "next";
import QRCode from "qrcode";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { feeAmount } from "@website/domain/events";
import { formatMoney, isValidSlug } from "@website/domain/shared";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { eventTicket } from "@/server/events";
import { getSignedInUser } from "@/server/session";
import { ProofForm } from "./proof-form";

export const instant = false;
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The member's own ticket: the QR for the door, and for a paid event how to pay and the state of the payment (N1.3, N1.4). */
export default async function EventTicketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isValidSlug(slug)) notFound();
  const user = await getSignedInUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/events/${slug}/ticket`)}`);
  const ticket = await eventTicket(slug, user);
  if (!ticket) notFound();
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)].events;
  const { event, fee, mine, ticketToken, showOnTicket } = ticket;
  const amount =
    fee && mine.amountMinor === null && mine.feeCategory
      ? feeAmount(fee, mine.feeCategory, mine.registeredAt)
      : mine.amountMinor;
  const category = fee?.categories.find((c) => c.id === mine.feeCategory);
  const qr = ticketToken
    ? await QRCode.toDataURL(ticketToken, { errorCorrectionLevel: "M", margin: 2, width: 260 })
    : null;

  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{event.title}</h1>
      {fee && category && amount !== null && (
        <p>
          {category.label} · {t.amountDue}:{" "}
          <strong>{formatMoney({ amountMinor: amount, currency: fee.currency })}</strong>
        </p>
      )}
      {mine.status === "waitlisted" ? (
        <p className="site-notice">{t.waitlisted}</p>
      ) : mine.status === "confirmed" &&
        mine.payment !== "unpaid" &&
        mine.payment !== "submitted" &&
        mine.payment !== "rejected" ? (
        <section aria-labelledby="ticket-qr">
          {mine.payment === "verified" && (
            <p role="status" className="site-notice">
              {t.proofVerified}
            </p>
          )}
          <h2 id="ticket-qr">{t.ticket}</h2>
          {user.name && (
            <p>
              {t.ticketHolder}: <strong>{user.name}</strong>
            </p>
          )}
          {category && <p>{category.label}</p>}
          {showOnTicket && <p>{showOnTicket}</p>}
          {qr ? (
            <>
              <p>{t.ticketShow}</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing to optimise */}
              <img src={qr} alt={t.ticketQrAlt} width={260} height={260} />
            </>
          ) : (
            <p className="site-muted">{t.ticketNoQr}</p>
          )}
        </section>
      ) : fee ? (
        <>
          <p className="site-muted">{t.payFirst}</p>
          <section aria-labelledby="ticket-pay">
            <h2 id="ticket-pay">{t.ticketPay}</h2>
            {fee.instructions && <p style={{ whiteSpace: "pre-line" }}>{fee.instructions}</p>}
            {fee.payImage && (
              // eslint-disable-next-line @next/next/no-img-element -- Storage serves sized WebP
              <img
                src={fee.payImage.url}
                width={fee.payImage.width}
                height={fee.payImage.height}
                alt=""
              />
            )}
            {mine.payment === "rejected" && (
              <p role="alert" className="site-notice">
                <strong>{t.proofRejected}</strong>
                {mine.paymentNote && <> {mine.paymentNote}</>}
              </p>
            )}
            {mine.payment === "submitted" ? (
              <p role="status" className="site-notice">
                {t.proofSent}
              </p>
            ) : (
              <ProofForm
                slug={slug}
                labels={{ upload: t.uploadProof, hint: t.proofHint, failed: t.proofFailed }}
              />
            )}
          </section>
        </>
      ) : null}
      <p>
        <a href={`/events/${event.slug}`}>{event.title}</a>
      </p>
    </main>
  );
}
