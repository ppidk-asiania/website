import { AppShell, StatusBadge } from "@website/ui";
import { money } from "@website/domain/store";

export default function StoreHomePage() {
  const zero = money(0, "USD");
  return (
    <AppShell title="Store">
      <p>
        <StatusBadge label="store: ok" status="ok" />
      </p>
      <p>
        Cart total: {zero.amountMinor} {zero.currency}
      </p>
    </AppShell>
  );
}
