import Link from "next/link";
import { RECOMMENDATIONS, type RecruitmentRecap } from "@website/domain/recruitment";
import { QUEUE_TABS, RECOMMENDATION_LABELS } from "@/components/applications-model";

/** A bar in CSS: the share of the largest value. */
function Bars({ rows }: { rows: ReadonlyArray<{ label: string; count: number }> }) {
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

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="admin-card">
    <div className="admin-card__header">
      <h2 className="admin-card__title">{title}</h2>
    </div>
    <div className="admin-card__body">{children}</div>
  </section>
);

/** Step 11.7: read-only numbers of a recruitment (or of every recruitment of the period). */
export function RecapPage(props: {
  recruitment: { id: string; title: string };
  wholePeriod: boolean;
  recap: RecruitmentRecap;
}) {
  const { recap } = props;
  const { interviews } = recap;
  const base = `/recruitment/${props.recruitment.id}`;
  const tabLabel = new Map<string, string>(QUEUE_TABS.map((t) => [t.key, t.label]));
  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Recruitment &gt; Recap</h1>
          <p className="admin-page-header__desc">
            {props.wholePeriod ? "Every recruitment of the period" : props.recruitment.title} ·{" "}
            {recap.total} applications from {recap.people} people. Drafts are not counted.
          </p>
        </div>
        <div className="admin-page-header__actions">
          <Link
            className="admin-btn admin-btn--outline admin-btn--sm"
            href={`${base}/applications`}
          >
            Applicants
          </Link>
          <Link
            className="admin-btn admin-btn--outline admin-btn--sm"
            href={props.wholePeriod ? `${base}/recap` : `${base}/recap?scope=period`}
          >
            {props.wholePeriod ? "This recruitment" : "Every recruitment of the period"}
          </Link>
        </div>
      </div>
      <div className="admin-dashboard">
        <div className="admin-stat-grid">
          {recap.stages.map((s) => (
            <div key={s.key} className="admin-stat-card">
              <span className="admin-stat-card__label">{tabLabel.get(s.key)}</span>
              <span className="admin-stat-card__value">{s.count}</span>
            </div>
          ))}
        </div>
        <Card title="Interest per unit">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Choice 1</th>
                <th>Choice 2</th>
                <th>Accepted</th>
                <th>Quota</th>
              </tr>
            </thead>
            <tbody>
              {recap.units.map((u) => (
                <tr key={u.orgUnitId}>
                  <td>{u.name}</td>
                  <td>{u.choice1}</td>
                  <td>{u.choice2}</td>
                  <td>{u.accepted}</td>
                  <td>{u.quota}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="admin-stat-grid admin-stat-grid--wide">
          <Card title="By chapter">
            <Bars rows={recap.spread.chapter} />
          </Card>
          <Card title="By level">
            <Bars rows={recap.spread.level} />
          </Card>
          <Card title="Ten largest campuses">
            <Bars rows={recap.spread.campus} />
          </Card>
          <Card title="By year of entry">
            <Bars rows={recap.spread.entryYear} />
          </Card>
          <Card title="By gender">
            <Bars rows={recap.spread.gender} />
          </Card>
        </div>
        <Card title="Interviews">
          <p className="admin-table__sub">
            {interviews.scheduled} scheduled · {interviews.attended} attended · {interviews.absent}{" "}
            absent · {interviews.assessed} assessed · {interviews.relationDeclared} declared a
            relation
          </p>
          <h3 className="admin-card__subtitle">Average per aspect (1-4)</h3>
          <Bars rows={interviews.aspects.map((a) => ({ label: a.label, count: a.average }))} />
          <h3 className="admin-card__subtitle">Recommendations</h3>
          <Bars
            rows={RECOMMENDATIONS.map((r) => ({
              label: RECOMMENDATION_LABELS[r],
              count: interviews.recommendations[r],
            }))}
          />
        </Card>
      </div>
    </div>
  );
}
