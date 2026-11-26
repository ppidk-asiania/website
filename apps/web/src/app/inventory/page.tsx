import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { isLoanOverdue } from "@website/domain/inventory";
import { catalogue, myLoans, myOffers } from "@/server/inventory";
import { getSignedInUser } from "@/server/session";
import { LoanForm } from "./loan-form";
import { MyLoans } from "./my-loans";
import { OfferForm } from "./offer-form";

export const metadata: Metadata = { title: "Inventaris · Inventory" };
export const instant = false;

export default async function InventoryPage() {
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)].inventory;
  const items = await catalogue();
  const user = await getSignedInUser();
  const today = new Date().toISOString().slice(0, 10);
  const mine = user ? await myLoans(user.uid) : [];
  const offers = user ? await myOffers(user.uid) : [];

  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{t.title}</h1>
      <p>{t.intro}</p>
      {items.length === 0 ? <p>{t.empty}</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- Storage serves sized WebP
              <img src={item.image.thumbUrl} alt="" width={96} loading="lazy" />
            ) : null}
            <strong>{item.name}</strong>
            {item.category ? <span className="site-muted"> · {item.category}</span> : null}
            <p>
              {item.available > 0 ? `${item.available} ${t.available}` : t.none}
              {item.condition === "damaged" ? ` · ${t.damaged}` : ""}
            </p>
            {item.description ? <p>{item.description}</p> : null}
          </li>
        ))}
      </ul>
      {items.length > 0 ? (
        <section aria-labelledby="loan-request">
          <h2 id="loan-request">{t.request.title}</h2>
          <LoanForm
            items={items.map((i) => ({ id: i.id, name: i.name }))}
            signedIn={user !== null}
            labels={t.request}
          />
        </section>
      ) : null}
      {user ? (
        <section aria-labelledby="my-loans">
          <h2 id="my-loans">{t.mine.title}</h2>
          <MyLoans
            labels={t.mine}
            loans={mine.map((l) => ({
              id: l.id,
              item: l.itemName,
              quantity: l.quantity,
              period: `${l.from} → ${l.to}`,
              status: l.status,
              overdue: isLoanOverdue(l, today),
              note: l.status === "rejected" ? l.note : null,
            }))}
          />
        </section>
      ) : null}
      {user ? (
        <section aria-labelledby="offer-item">
          <h2 id="offer-item">{t.offer.title}</h2>
          <OfferForm labels={t.offer} />
          {offers.length > 0 ? (
            <>
              <h3>{t.offer.mine}</h3>
              <ul>
                {offers.map((o) => (
                  <li key={o.id}>
                    {o.quantity} × {o.name} · {t.offer.states[o.status]}
                    {o.status === "rejected" && o.note ? ` · ${o.note}` : ""}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
