"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NO_RELATION, RECOMMENDATIONS, SCORE_LABELS } from "@website/domain/recruitment";
import { saveAssessmentAction } from "@/app/(panel)/recruitment/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToastMessage } from "@/components/ui/toast";
import {
  RECOMMENDATION_LABELS,
  type AssessmentForm,
  type AssessmentPanel,
} from "./applications-model";

function AssessForm(props: { applicationId: string; form: AssessmentForm }) {
  const { applicationId, form } = props;
  const router = useRouter();
  const toast = useToastMessage();
  const mine = form.mine;
  const [scores, setScores] = useState<Record<string, string>>(
    Object.fromEntries(form.rubric.map((a) => [a.key, String(mine?.scores[a.key] ?? "")])),
  );
  const [recommendation, setRecommendation] = useState<string>(mine?.recommendation ?? "");
  const [note, setNote] = useState(mine?.note ?? "");
  const [related, setRelated] = useState(mine ? mine.relation !== NO_RELATION : false);
  const [relation, setRelation] = useState(
    mine && mine.relation !== NO_RELATION ? mine.relation : "",
  );
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const result = await saveAssessmentAction({
      id: applicationId,
      choiceId: form.choiceId,
      scores: Object.fromEntries(
        Object.entries(scores)
          .filter(([, v]) => v !== "")
          .map(([k, v]) => [k, Number(v)]),
      ),
      recommendation,
      note,
      relation: related ? relation : NO_RELATION,
    });
    setBusy(false);
    toast.show(result.ok ? "Assessment saved" : actionMessage(result));
    if (result.ok) router.refresh();
  };

  return (
    <fieldset className="admin-field">
      <legend className="admin-field__label">
        {form.unitName}: {mine ? "your assessment" : "assess this interview"}
      </legend>
      {form.rubric.map((a) => (
        <div key={a.key} className="admin-field">
          <label className="admin-field__label" htmlFor={`score-${form.choiceId}-${a.key}`}>
            {a.label} (weight {a.weight})
          </label>
          {a.description ? <div className="admin-table__sub">{a.description}</div> : null}
          {a.questions.map((q) => (
            <div key={q} className="admin-table__sub">
              • {q}
            </div>
          ))}
          <Select
            id={`score-${form.choiceId}-${a.key}`}
            className="admin-select"
            value={scores[a.key] ?? ""}
            onChange={(e) => setScores({ ...scores, [a.key]: e.target.value })}
          >
            <option value="">Score…</option>
            {([1, 2, 3, 4] as const).map((n) => (
              <option key={n} value={n}>
                {n} · {SCORE_LABELS[n]}
              </option>
            ))}
          </Select>
        </div>
      ))}
      <div className="admin-field">
        <label className="admin-field__label" htmlFor={`rec-${form.choiceId}`}>
          Recommendation
        </label>
        <Select
          id={`rec-${form.choiceId}`}
          className="admin-select"
          value={recommendation}
          onChange={(e) => setRecommendation(e.target.value)}
        >
          <option value="">Choose…</option>
          {RECOMMENDATIONS.map((r) => (
            <option key={r} value={r}>
              {RECOMMENDATION_LABELS[r]}
            </option>
          ))}
        </Select>
      </div>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor={`note-${form.choiceId}`}>
          Note (needed for a 1, a 4 or &quot;not recommended&quot;)
        </label>
        <textarea
          id={`note-${form.choiceId}`}
          className="admin-input admin-textarea"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor={`related-${form.choiceId}`}>
          <input
            id={`related-${form.choiceId}`}
            type="checkbox"
            checked={related}
            onChange={(e) => setRelated(e.target.checked)}
          />{" "}
          I have a close relation with this applicant
        </label>
        {related ? (
          <input
            className="admin-input"
            aria-label="Describe the relation"
            value={relation}
            onChange={(e) => setRelation(e.target.value)}
          />
        ) : null}
      </div>
      <Button
        variant="outline"
        size="sm"
        icon="check"
        disabled={busy || recommendation === ""}
        onClick={() => void save()}
      >
        Save assessment
      </Button>
    </fieldset>
  );
}

/** Application page: the assessments you may read, the weighted average, and your own form(s). */
export function AssessmentSection(props: { applicationId: string; panel: AssessmentPanel }) {
  const { panel } = props;
  if (panel.items.length === 0 && panel.forms.length === 0) return null;
  return (
    <section aria-label="Interview assessments">
      <h2 className="admin-card__title">Interview assessments</h2>
      {panel.score ? (
        <p>
          Score <strong>{panel.score}</strong>
          {panel.spread ? ` · ${panel.spread}` : ""}
          {panel.withRelation > 0 ? ` · ${panel.withRelation} declared a relation` : ""}
        </p>
      ) : null}
      <ol className="admin-detail-rounds">
        {panel.items.map((a) => (
          <li key={a.id}>
            <strong>{a.interviewer}</strong> ({a.unitName}) · {a.average} · {a.recommendation}
            {a.relation ? ` · relation declared: ${a.relation}` : ""}
            {a.note ? <div className="admin-table__sub">{a.note}</div> : null}
          </li>
        ))}
      </ol>
      {panel.forms.map((form) => (
        <AssessForm key={form.choiceId} applicationId={props.applicationId} form={form} />
      ))}
    </section>
  );
}
