import type { Metadata } from "next";
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

/** The member's own ticket: for a paid event, how to pay and the state of the payment (N1.3). */
export default async function EventTicketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isValidSlug(slug)) notFound();
  const user = await getSignedInUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/events/${slug}/ticket`)}`);
  const ticket = await eventTicket(slug, user);
  if (!ticket) notFound();
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)].events;
  const { event, fee, mine } = ticket;
  const amount =
    mine.amountMinor ??
    (mine.feeCategory ? feeAmount(fee, mine.feeCategory, mine.registeredAt) : null);
  const category = fee.categories.find((c) => c.id === mine.feeCategory);

  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{event.title}</h1>
      {category && amount !== null && (
        <p>
          {category.label} · {t.amountDue}:{" "}
          <strong>{formatMoney({ amountMinor: amount, currency: fee.currency })}</strong>
        </p>
      )}
      {mine.payment === "verified" ? (
        <p role="status" className="site-notice">
          {t.proofVerified}
        </p>
      ) : mine.status === "waitlisted" ? (
        <p className="site-notice">{t.waitlisted}</p>
      ) : (
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
      )}
      <p>
        <a href={`/events/${event.slug}`}>{event.title}</a>
      </p>
    </main>
  );
}
