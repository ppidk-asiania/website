"use client";

import { useState } from "react";
import { checkProofAction, queueAnalysisAction } from "@/app/(panel)/recruitment/actions";
import { actionMessage } from "@/components/action-message";
import { formatInZone } from "@/components/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ApplicationAnalysis, ProofCheck } from "@website/domain/recruitment";

const FIELDS = {
  name: "Name",
  campus: "Campus",
  level: "Level",
  programme: "Programme",
  entryYear: "Entry year",
  chapter: "Chapter",
} as const;
const TONES = { match: "success", differs: "danger", unreadable: "neutral" } as const;
const ACTIVE = { yes: "Active status stated", no: "Not active", unreadable: "Unreadable" } as const;
const utc = (d: Date) => `${formatInZone(d.toISOString(), "UTC")} UTC`;

/** Notes for the committee (`recruitment.ai` only): never a score, never a recommendation. */
export function ApplicationAiPanel(props: {
  applicationId: string;
  units: Readonly<Record<string, string>>;
  analysis: ApplicationAnalysis | null;
  proofCheck: ProofCheck | null;
  hasProof: boolean;
  onMessage: (text: string) => void;
  onDone: () => void;
}) {
  const { applicationId, units, analysis, proofCheck, hasProof } = props;
  const [busy, setBusy] = useState(false);
  const waiting = analysis?.status === "queued" || analysis?.status === "running";

  const call = async (
    action: typeof queueAnalysisAction | typeof checkProofAction,
    done: string,
  ) => {
    setBusy(true);
    const result = await action({ id: applicationId });
    setBusy(false);
    props.onMessage(result.ok ? done : actionMessage(result));
    if (result.ok) props.onDone();
  };

  return (
    <div className="admin-form-separator">
      <span className="admin-field__label">AI analysis</span>
      <p>
        <Button
          variant="outline"
          size="sm"
          icon="send"
          disabled={busy || waiting}
          onClick={() => void call(queueAnalysisAction, "Analysis queued")}
        >
          Run analysis
        </Button>{" "}
        {analysis?.status === "queued" ? "Queued: it runs within a few minutes." : null}
        {analysis?.status === "running" ? "Running." : null}
        {analysis?.status === "failed"
          ? `Failed (${analysis.error ?? "unknown"}). Run it again.`
          : null}
        {analysis?.status === "done" && analysis.finishedAt
          ? `Done ${utc(analysis.finishedAt)}.`
          : null}
      </p>
      {analysis?.result ? (
        <>
          <p>{analysis.result.summary}</p>
          {analysis.result.units.map((u) => (
            <div key={u.orgUnitId}>
              <strong>{units[u.orgUnitId] ?? u.orgUnitId}</strong>
              <ul>
                {u.supporting.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <em>Interview questions</em>
              <ul>
                {u.questions.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          ))}
          {analysis.result.checks.length > 0 ? (
            <>
              <strong>To check</strong>
              <ul>
                {analysis.result.checks.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
      {analysis && analysis.skipped.length > 0 ? (
        <p>Not read: {analysis.skipped.map((s) => `${s.label} (${s.reason})`).join(", ")}</p>
      ) : null}

      <span className="admin-field__label">Proof check</span>
      <p>
        <Button
          variant="outline"
          size="sm"
          icon="check"
          disabled={busy || !hasProof}
          onClick={() => void call(checkProofAction, "Proof checked")}
        >
          Check proof
        </Button>{" "}
        {hasProof ? null : "No proof uploaded."}
        {proofCheck ? `Last check ${utc(proofCheck.at)}.` : null}
      </p>
      {proofCheck ? (
        <dl className="admin-detail-list">
          {(Object.keys(FIELDS) as (keyof typeof FIELDS)[]).map((f) => (
            <div key={f} className="admin-detail-list__row">
              <dt>{FIELDS[f]}</dt>
              <dd>
                <Badge tone={TONES[proofCheck.result.fields[f]]}>
                  {proofCheck.result.fields[f]}
                </Badge>
              </dd>
            </div>
          ))}
          <div className="admin-detail-list__row">
            <dt>Active status</dt>
            <dd>{ACTIVE[proofCheck.result.activeStatus]}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
