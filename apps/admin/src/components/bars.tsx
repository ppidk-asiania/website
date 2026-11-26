/** A bar in CSS: the share of the largest value. */
export function Bars({ rows }: { rows: ReadonlyArray<{ label: string; count: number }> }) {
  const top = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="admin-bars">
      {rows.map((r) => (
        <li key={r.label} className="admin-bars__row">
          <span className="admin-bars__label">{r.label}</span>
          <span className="admin-bars__track" aria-hidden="true">
            <span className="admin-bars__fill" style={{ width: `${(r.count / top) * 100}%` }} />
          </span>
          <span className="admin-bars__count">{r.count}</span>
        </li>
      ))}
      {rows.length === 0 ? <li className="admin-table__sub">No data yet.</li> : null}
    </ul>
  );
}
