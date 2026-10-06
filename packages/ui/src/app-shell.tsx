import type { ReactNode } from "react";

/**
 * Presentational only. UI components never fetch data, read env, or make
 * authorization decisions — they render what server code already decided.
 */
export function AppShell(props: { title: string; children: ReactNode }) {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 720,
        margin: "4rem auto",
        padding: "0 1rem",
      }}
    >
      <h1 style={{ fontSize: "1.75rem", marginBottom: "1rem" }}>{props.title}</h1>
      {props.children}
    </main>
  );
}

export function StatusBadge(props: { label: string; status: "ok" | "warn" }) {
  const color = props.status === "ok" ? "#166534" : "#92400e";
  return (
    <span data-testid="status-badge" style={{ color, fontWeight: 600 }}>
      {props.label}
    </span>
  );
}
