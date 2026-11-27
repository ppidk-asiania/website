"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { nextStatuses, type ApplicationStatus } from "@website/domain/opportunities";
import {
  deleteApplicationAction,
  reviewApplicationAction,
} from "@/app/(panel)/opportunities/actions";
import { actionMessage } from "@/components/action-message";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Column } from "@/components/ui/data-table";
import {
  ListCard,
  ListEmpty,
  MenuItem,
  RowMenu,
  SearchBox,
  SortMenu,
  useListTable,
} from "@/components/ui/list-controls";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";

export interface ApplicantRow {
  id: string;
  name: string;
  email: string;
  coverLetter: string;
  status: ApplicationStatus;
  note: string;
  appliedAt: string;
}

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  interview: "Interview",
  offered: "Offered",
  rejected: "Rejected",
};
const STATUS_TONES: Record<ApplicationStatus, BadgeTone> = {
  submitted: "neutral",
  under_review: "warn",
  interview: "primary",
  offered: "success",
  rejected: "danger",
};

type SortKey = "applicant" | "applied" | "status";
const sortValue = (r: ApplicantRow, key: SortKey): string =>
  key === "applicant" ? r.name.toLowerCase() : key === "applied" ? r.appliedAt : r.status;
const filterText = (r: ApplicantRow, key: SortKey): string =>
  key === "applicant" ? r.name : key === "applied" ? r.appliedAt : STATUS_LABELS[r.status];

/** The applicants of one posting: open the CV, move the status along, keep a note, delete (N6.2). */
export function OpportunityApplicantsPage(props: {
  title: string;
  rows: ApplicantRow[];
  canEdit: boolean;
}) {
  const { rows, canEdit } = props;
  const router = useRouter();
  const toast = useToastMessage();
  const [editing, setEditing] = useState<ApplicantRow | null>(null);
  const [status, setStatus] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const [deleting, setDeleting] = useState<ApplicantRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => !q || `${r.name} ${r.email}`.toLowerCase().includes(q));
  }, [rows, query]);
  const table = useListTable(filtered, sortValue, undefined, filterText);

  const open = (row: ApplicantRow) => {
    setEditing(row);
    setStatus("");
    setNote(row.note);
    setMessage(null);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    const result = await reviewApplicationAction({
      id: editing.id,
      status: status === "" ? null : status,
      note,
    });
    setBusy(false);
    if (!result.ok) return setMessage(actionMessage(result));
    setEditing(null);
    router.refresh();
    toast.show("Application saved");
  };

  const remove = async () => {
    if (!deleting) return;
    const result = await deleteApplicationAction({ id: deleting.id });
    setDeleting(null);
    if (!result.ok) return toast.show(actionMessage(result));
    router.refresh();
    toast.show("Application deleted");
  };

  const columns: Column<ApplicantRow>[] = [
    {
      key: "applicant",
      header: table.header("applicant", "Applicant"),
      render: (row) => (
        <>
          <span className="admin-table__title">{row.name}</span>
          <span className="admin-table__sub">{row.email}</span>
        </>
      ),
    },
    { key: "applied", header: table.header("applied", "Applied"), render: (row) => row.appliedAt },
    {
      key: "status",
      header: table.header("status", "Status"),
      render: (row) => (
        <>
          <Badge tone={STATUS_TONES[row.status]}>{STATUS_LABELS[row.status]}</Badge>
          {row.note ? <span className="admin-table__sub">has a note</span> : null}
        </>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      render: (row) => (
        <div className="admin-table__actions">
          <Button
            variant="ghost"
            size="icon"
            icon="eye"
            aria-label="Open CV"
            title="Open CV"
            href={`/api/opportunity-cvs/${row.id}`}
            target="_blank"
          />
          {canEdit ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                icon="edit"
                aria-label="Review"
                title="Review"
                onClick={() => open(row)}
              />
              <RowMenu>
                <MenuItem icon="trash" danger onClick={() => setDeleting(row)}>
                  Delete<span className="admin-long"> Application</span>
                </MenuItem>
              </RowMenu>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  const clearFilters = () => {
    setQuery("");
    setSearchKey((k) => k + 1);
    table.clearFilters();
    table.setPage(1);
  };

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Opportunities &gt; Applicants</h1>
          <p className="admin-page-header__desc">
            {props.title}. The applicant is told when the status changes; the note stays internal.
          </p>
        </div>
        <div className="admin-page-header__actions">
          <div className="admin-fab">
            <Button variant="outline" size="sm" icon="chevronLeft" href="/opportunities">
              Back
            </Button>
          </div>
          <SortMenu columns={columns} />
          <SearchBox
            key={searchKey}
            placeholder="Search by name or e-mail..."
            label="Search applicants"
            onSearch={(value) => {
              setQuery(value);
              table.setPage(1);
            }}
          />
        </div>
      </div>

      <ListCard
        table={table}
        noun="applicant"
        columns={columns}
        empty={
          <ListEmpty
            noun="applicant"
            query={query}
            filters={table.filterCount}
            emptyHint="Nobody has applied on the platform yet."
            onClear={clearFilters}
          />
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete Application?"
        confirmLabel="Delete Application"
        icon="trash"
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      >
        The application of {deleting?.name} and the CV file are removed for good. This is recorded
        in the audit log.
      </ConfirmDialog>
      <Modal
        asForm
        open={editing !== null}
        title="Review Application"
        subtitle={editing?.name}
        onClose={() => setEditing(null)}
        footer={
          <div className="admin-modal__footer-row">
            <Button variant="outline" icon="chevronLeft" onClick={() => setEditing(null)}>
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              icon="cloud"
              disabled={busy}
              onClick={() => void save()}
            >
              Save
            </Button>
          </div>
        }
      >
        {editing ? (
          <div className="admin-form-grid">
            <div className="admin-field admin-form-grid__full">
              <span className="admin-field__label">Cover letter</span>
              <p>{editing.coverLetter}</p>
            </div>
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="applicant-status">
                Status (now: {STATUS_LABELS[editing.status]})
              </label>
              <Select
                id="applicant-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">Keep the status</option>
                {nextStatuses(editing.status).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="applicant-note">
                Internal note
              </label>
              <textarea
                id="applicant-note"
                className="admin-input admin-textarea"
                rows={3}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {message ? (
              <p className="admin-field__error admin-form-grid__full" role="alert">
                {message}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <ToastBanner message={toast.message} />
    </div>
  );
}
