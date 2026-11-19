"use client";

import { useState } from "react";
import { AI_FEATURES, AI_MODELS, type AiFeature, type summarizeUsage } from "@website/domain/ai";
import { saveAiSettingsAction } from "@/app/(panel)/ai/actions";
import { ChoiceField, FormModal, text } from "@/components/program-ui";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

const FEATURE_LABELS: Record<AiFeature, string> = {
  minutes: "Minutes draft",
  proofCheck: "Proof check",
  applicationAnalysis: "Application analysis",
};
const modelLabel = (id: string) => AI_MODELS.find((m) => m.id === id)?.label ?? id;
const usd = (n: number) => `$${n.toFixed(2)}`;

type Usage = ReturnType<typeof summarizeUsage>;
export interface AiCardData {
  readonly keyTail: string | null;
  readonly version: number | null;
  readonly models: Record<AiFeature, string>;
  readonly thisMonth: Usage;
  readonly lastMonth: Usage;
}

export function AiCard({ data }: { data: AiCardData }) {
  const [editing, setEditing] = useState(false);
  const usage = (label: string, u: Usage) => (
    <tr>
      <td>{label}</td>
      <td>{u.requests}</td>
      <td>{u.tokens.toLocaleString("en")}</td>
      <td>
        {usd(u.cost)}
        {u.unpriced.length > 0 ? (
          <div>
            No price known, not counted:{" "}
            {u.unpriced
              .map((p) => `${p.model} (${p.requests} requests, ${p.tokens} tokens)`)
              .join(", ")}
          </div>
        ) : null}
      </td>
    </tr>
  );
  return (
    <Card>
      <CardHeader
        title="AI"
        subtitle={
          data.keyTail
            ? `Key ends in ${data.keyTail} (set in the environment). Estimates only; official bill: console.anthropic.com`
            : "No ANTHROPIC_API_KEY: AI buttons are off."
        }
        actions={
          <Button size="sm" variant="outline" icon="settings" onClick={() => setEditing(true)}>
            Models
          </Button>
        }
      />
      <CardBody>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Model</th>
              </tr>
            </thead>
            <tbody>
              {AI_FEATURES.map((f) => (
                <tr key={f}>
                  <td>{FEATURE_LABELS[f]}</td>
                  <td>{modelLabel(data.models[f])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Requests</th>
                <th>Tokens</th>
                <th>Estimated cost</th>
              </tr>
            </thead>
            <tbody>
              {usage("This month", data.thisMonth)}
              {usage("Last month", data.lastMonth)}
            </tbody>
          </table>
        </div>
      </CardBody>
      <FormModal
        open={editing}
        title="AI models"
        onClose={() => setEditing(false)}
        onSubmit={(form) =>
          saveAiSettingsAction({
            version: data.version,
            models: Object.fromEntries(AI_FEATURES.map((f) => [f, text(form, f)])),
          })
        }
      >
        {AI_FEATURES.map((f) => (
          <ChoiceField
            key={f}
            label={FEATURE_LABELS[f]}
            name={f}
            defaultValue={data.models[f]}
            options={AI_MODELS.map((m) => ({ value: m.id, label: m.label }))}
          />
        ))}
      </FormModal>
    </Card>
  );
}
