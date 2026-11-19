"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_RUBRIC, SCORE_LABELS, type RubricAspect } from "@website/domain/recruitment";
import { saveInterviewRubricAction } from "@/app/(panel)/recruitment/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useToastMessage } from "@/components/ui/toast";

interface Row {
  key: string;
  label: string;
  description: string;
  questions: string;
  weight: string;
}

const toRows = (aspects: readonly RubricAspect[]): Row[] =>
  aspects.map((a) => ({
    key: a.key,
    label: a.label,
    description: a.description,
    questions: a.questions.join("\n"),
    weight: String(a.weight),
  }));

/** The committee edits the interview rubric; saving the default stores nothing. Scores already given keep their own copy. */
export function RubricEditor(props: {
  recruitmentId: string;
  version: number;
  aspects: readonly RubricAspect[];
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const [rows, setRows] = useState(toRows(props.aspects));
  const [busy, setBusy] = useState(false);
  const change = (i: number, patch: Partial<Row>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setBusy(true);
    const result = await saveInterviewRubricAction({
      id: props.recruitmentId,
      version: props.version,
      rubric: rows.map((r) => ({
        key: r.key,
        label: r.label,
        description: r.description,
        questions: r.questions
          .split("\n")
          .map((q) => q.trim())
          .filter(Boolean),
        weight: Number(r.weight),
      })),
    });
    setBusy(false);
    toast.show(result.ok ? "Rubric saved" : actionMessage(result));
    if (result.ok) router.refresh();
  };

  return (
    <Card className="admin-list-card">
      <CardBody>
        <h2 className="admin-card__title">Interview rubric</h2>
        <p className="admin-card__subtitle">
          Scale 1-4:{" "}
          {Object.entries(SCORE_LABELS)
            .map(([n, l]) => `${n} ${l.toLowerCase()}`)
            .join(" · ")}
          . A change never alters assessments already saved.
        </p>
        {rows.map((r, i) => (
          <fieldset key={r.key} className="admin-field">
            <label className="admin-field__label" htmlFor={`rubric-label-${r.key}`}>
              Aspect {i + 1}
            </label>
            <input
              id={`rubric-label-${r.key}`}
              className="admin-input"
              value={r.label}
              onChange={(e) => change(i, { label: e.target.value })}
            />
            <textarea
              aria-label={`Description of aspect ${i + 1}`}
              className="admin-input admin-textarea"
              rows={2}
              value={r.description}
              onChange={(e) => change(i, { description: e.target.value })}
            />
            <textarea
              aria-label={`Guide questions of aspect ${i + 1}, one per line`}
              className="admin-input admin-textarea"
              rows={2}
              value={r.questions}
              onChange={(e) => change(i, { questions: e.target.value })}
            />
            <Select
              aria-label={`Weight of aspect ${i + 1}`}
              className="admin-select"
              value={r.weight}
              onChange={(e) => change(i, { weight: e.target.value })}
            >
              {[1, 2, 3, 4, 5].map((w) => (
                <option key={w} value={w}>
                  Weight {w}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              size="sm"
              icon="trash"
              disabled={rows.length === 1}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </fieldset>
        ))}
        <Button
          variant="outline"
          size="sm"
          icon="plus"
          onClick={() =>
            setRows([
              ...rows,
              {
                key: `aspect-${Date.now().toString(36)}`,
                label: "",
                description: "",
                questions: "",
                weight: "1",
              },
            ])
          }
        >
          Add an aspect
        </Button>{" "}
        <Button
          variant="outline"
          size="sm"
          icon="undo"
          onClick={() => setRows(toRows(DEFAULT_RUBRIC))}
        >
          Back to the default
        </Button>{" "}
        <Button size="sm" icon="check" disabled={busy} onClick={() => void save()}>
          Save rubric
        </Button>
      </CardBody>
    </Card>
  );
}
