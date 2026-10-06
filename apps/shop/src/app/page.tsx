import { AppShell, StatusBadge } from "@platform/ui";
import { money } from "@platform/domain/shop";

export const revalidate = 300;

export default function ShopHomePage() {
  const zero = money(0, "USD");
  return (
    <AppShell title="Shop">
      <p>
        <StatusBadge label="shop: ok" status="ok" />
      </p>
      <p>
        Cart total: {zero.amountMinor} {zero.currency}
      </p>
    </AppShell>
  );
}
