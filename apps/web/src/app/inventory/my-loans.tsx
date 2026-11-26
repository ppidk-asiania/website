"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";

export interface MyLoan {
  id: string;
  item: string;
  quantity: number;
  period: string;
  status: keyof Dictionary["inventory"]["mine"]["states"];
  overdue: boolean;
  note: string | null;
}

/** The member's own requests, with the two steps they may take themselves. */
export function MyLoans(props: { loans: MyLoan[]; labels: Dictionary["inventory"]["mine"] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { labels } = props;

  const step = async (id: string, what: "return" | "cancel") => {
    setBusy(true);
    try {
      await fetch(`/api/inventory/loans/${id}?do=${what}`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (props.loans.length === 0) return <p>{labels.empty}</p>;
  return (
    <ul>
      {props.loans.map((loan) => (
        <li key={loan.id}>
          <strong>
            {loan.quantity} × {loan.item}
          </strong>{" "}
          · {loan.period} · {loan.overdue ? labels.overdue : labels.states[loan.status]}
          {loan.note ? <span className="site-muted"> · {loan.note}</span> : null}{" "}
          {loan.status === "handed_over" ? (
            <button
              type="button"
              className="ui-button"
              disabled={busy}
              onClick={() => void step(loan.id, "return")}
            >
              {labels.askReturn}
            </button>
          ) : null}
          {loan.status === "pending" || loan.status === "approved" ? (
            <button
              type="button"
              className="ui-button"
              disabled={busy}
              onClick={() => void step(loan.id, "cancel")}
            >
              {labels.cancel}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
