import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { catalogue } from "@/server/inventory";

export const metadata: Metadata = { title: "Inventaris · Inventory" };
export const instant = false;

export default async function InventoryPage() {
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)].inventory;
  const items = await catalogue();

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
    </main>
  );
}
