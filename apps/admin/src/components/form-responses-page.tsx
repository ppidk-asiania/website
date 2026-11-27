"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { QuestionSummary } from "@website/domain/forms";
import { exportFormResponsesAction } from "@/app/(panel)/forms/actions";
import { Bars } from "@/components/bars";
import { actionMessage } from "@/components/action-message";
import { downloadCsv } from "@/components/csv";
import { esc } from "@/components/format";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import type { Column } from "@/components/ui/data-table";
import {
  ListCard,
  ListEmpty,
  SearchBox,
  SortMenu,
  Tabs,
  useListTable,
} from "@/components/ui/list-controls";
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
  const [view, setView] = useState<"responses" | "results">("responses");
  const [query, setQuery] = useState("");
  const [searchKey, setSearchKey] = useState(0);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.rows.filter((r) => !q || r.cells.some((c) => c.toLowerCase().includes(q)));
  }, [props.rows, query]);
  // A column key is the position of the question in the row.
  const table = useListTable(shown, (row, key: string) =>
    (row.cells[Number(key)] ?? "").toLowerCase(),
  );
  const showResults = props.summaries.length > 0 && props.rows.length > 0;

  const columns: Column<ResponseRow>[] = props.header.map((text, i) => ({
    key: String(i),
    header: table.header(String(i), text),
    render: (row) => <span className="admin-table__title">{row.cells[i]}</span>,
  }));
  const clearFilters = () => {
    setQuery("");
    setSearchKey((k) => k + 1);
    table.clearFilters();
    table.setPage(1);
  };

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
          {view === "responses" ? (
            <>
              <SortMenu columns={columns} />
              <SearchBox
                key={searchKey}
                placeholder="Search answers..."
                label="Search responses"
                onSearch={(value) => {
                  setQuery(value);
                  table.setPage(1);
                }}
              />
            </>
          ) : null}
        </div>
      </div>
      <Tabs
        label="Response views"
        tabs={[
          { key: "responses", label: "Responses", count: props.total },
          ...(showResults ? [{ key: "results" as const, label: "Results" }] : []),
        ]}
        active={view}
        onSelect={setView}
      />
      {view === "results" && showResults ? (
        <Card className="admin-list-card">
          <CardBody>
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
      {view === "responses" ? (
        <ListCard
          table={table}
          noun="response"
          columns={columns}
          empty={
            <ListEmpty
              noun="response"
              query={query}
              filters={table.filterCount}
              emptyHint="Answers appear here when people submit the form."
              onClear={clearFilters}
            />
          }
        />
      ) : null}
      <ToastBanner message={toast.message} />
    </div>
  );
}
