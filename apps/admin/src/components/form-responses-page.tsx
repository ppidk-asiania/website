"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { QuestionSummary } from "@website/domain/forms";
import { exportFormResponsesAction } from "@/app/(panel)/forms/actions";
import { Bars } from "@/components/bars";
import { actionMessage } from "@/components/action-message";
import { downloadCsv } from "@/components/csv";
import { esc } from "@/components/format";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";

interface ResponseRow {
  id: string;
  cells: string[];
}

export function FormResponsesPage(props: {
  id: string;
  title: string;
  total: number;
  header: string[];
  rows: ResponseRow[];
  canExport: boolean;
  /** One summary per question of the current version, from the newest answers shown. */
  summaries: QuestionSummary[];
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const [busy, setBusy] = useState(false);

  const columns: Column<ResponseRow>[] = props.header.map((text, i) => ({
    key: String(i),
    header: text,
    render: (row) => <span className="admin-table__title">{row.cells[i]}</span>,
  }));

  const exportCsv = async () => {
    setBusy(true);
    const result = await exportFormResponsesAction({ id: props.id });
    setBusy(false);
    if (!result.ok) {
      toast.show(actionMessage(result));
      return;
    }
    const slug = result.data.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    downloadCsv(`responses-${slug || "form"}`, [
      result.data.header.map(esc),
      ...result.data.rows.map((row) => row.map(esc)),
    ]);
    toast.show(`${result.data.rows.length} responses exported`);
  };

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Forms &gt; Responses</h1>
          <p className="admin-page-header__desc">
            {props.title} — {props.total} {props.total === 1 ? "response" : "responses"}
            {props.rows.length < props.total ? ` (newest ${props.rows.length} shown)` : ""}. Answers
            are personal data: export only what you need.
          </p>
        </div>
        <div className="admin-page-header__actions">
          <Button
            variant="outline"
            size="sm"
            icon="chevronLeft"
            onClick={() => router.push("/forms")}
          >
            Back
          </Button>
          <div className="admin-fab">
            {props.canExport ? (
              <Button
                variant="outline"
                size="sm"
                icon="download"
                disabled={busy || props.total === 0}
                onClick={() => exportCsv()}
              >
                Export CSV
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {props.summaries.length > 0 && props.rows.length > 0 ? (
        <Card className="admin-list-card">
          <CardBody>
            <h2 className="admin-section-title">Results</h2>
            {props.summaries.map((s) => (
              <section key={s.id} aria-label={s.label}>
                <h3 className="admin-table__title">{s.label}</h3>
                <p className="admin-table__sub">
                  {s.answered} {s.answered === 1 ? "answer" : "answers"}
                  {s.kind === "rating" && s.average !== null
                    ? ` · average ${s.average} of ${s.max}`
                    : ""}
                  {s.kind === "number" && s.average !== null
                    ? ` · min ${s.min} · average ${s.average} · max ${s.max}`
                    : ""}
                </p>
                {s.kind === "choice" || s.kind === "rating" ? (
                  <Bars
                    rows={s.rows.map((r) => ({
                      label: `${r.label} · ${r.percent}%`,
                      count: r.count,
                    }))}
                  />
                ) : null}
                {s.kind === "text" ? (
                  <ul>
                    {s.latest.map((t, i) => (
                      <li key={i} className="admin-table__sub">
                        {t}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </CardBody>
        </Card>
      ) : null}
      <Card className="admin-list-card">
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={props.rows}
            rowKey={(row) => row.id}
            emptyText="No responses yet"
          />
        </CardBody>
      </Card>
      <ToastBanner message={toast.message} />
    </div>
  );
}
