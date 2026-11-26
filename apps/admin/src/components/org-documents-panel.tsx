"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ORG_DOCUMENT_TYPES, type OrgDocumentType } from "@website/domain/organizations";
import {
  deleteOrgDocumentAction,
  saveOrgDocumentAction,
} from "@/app/(panel)/organizations/actions";
import { actionMessage } from "@/components/action-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";

export const ORG_DOCUMENT_TYPE_LABELS: Record<OrgDocumentType, string> = {
  statutes: "Statutes (AD/ART)",
  guideline: "Guideline",
  other: "Other",
};

export interface OrgDocumentRow {
  id: string;
  version: number;
  type: OrgDocumentType;
  title: string;
  versionLabel: string;
  date: string;
  file: { path: string; name: string; size: number } | null;
  link: string | null;
  published: boolean;
}

interface Form {
  type: OrgDocumentType;
  title: string;
  versionLabel: string;
  date: string;
  link: string;
  published: boolean;
}

const emptyForm = (): Form => ({
  type: "statutes",
  title: "",
  versionLabel: "",
  date: new Date().toISOString().slice(0, 10),
  link: "",
  published: true,
});

export function OrgDocumentsPanel({ rows, canEdit }: { rows: OrgDocumentRow[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToastMessage();
  const [editing, setEditing] = useState<OrgDocumentRow | "new" | null>(null);
  const [form, setForm] = useState<Form>(emptyForm());
  const [pdf, setPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const open = (row: OrgDocumentRow | "new") => {
    setForm(row === "new" ? emptyForm() : { ...row, link: row.link ?? "" });
    setPdf(null);
    setMessage(null);
    setEditing(row);
  };

  const save = async () => {
    if (editing === null) return;
    setBusy(true);
    setMessage(null);
    const current = editing === "new" ? null : editing;
    let file = current?.file ?? null;
    if (pdf) {
      const response = await fetch("/api/org-documents", {
        method: "POST",
        headers: { "x-file-name": encodeURIComponent(pdf.name) },
        body: pdf,
      });
      if (!response.ok) {
        setBusy(false);
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        return setMessage(body?.message ?? "The upload failed. Try again.");
      }
      file = (await response.json()) as OrgDocumentRow["file"];
    }
    // A link replaces the file and the other way round: exactly one of them is sent.
    const usesLink = form.link.trim() !== "" && !pdf;
    const result = await saveOrgDocumentAction({
      ...(current ? { id: current.id, version: current.version } : { version: null }),
      ...form,
      file: usesLink ? null : file,
      link: usesLink ? form.link : "",
    });
    setBusy(false);
    if (!result.ok) return setMessage(actionMessage(result));
    setEditing(null);
    router.refresh();
    toast.show("Document saved");
  };

  const remove = async (row: OrgDocumentRow) => {
    const result = await deleteOrgDocumentAction({ id: row.id, version: row.version });
    if (!result.ok) return toast.show(actionMessage(result));
    router.refresh();
    toast.show("Document deleted");
  };

  return (
    <>
      <Card className="admin-list-card">
        <CardBody flush>
          <DataTable
            rowKey={(row) => row.id}
            rows={rows}
            emptyText="No organisation documents yet"
            columns={[
              {
                key: "title",
                header: "Document",
                render: (row) => (
                  <>
                    <span className="admin-table__title">{row.title}</span>
                    <span className="admin-table__sub">
                      {ORG_DOCUMENT_TYPE_LABELS[row.type]}
                      {row.versionLabel ? ` · ${row.versionLabel}` : ""} · {row.date}
                    </span>
                  </>
                ),
              },
              {
                key: "published",
                header: "Status",
                render: (row) => (
                  <Badge tone={row.published ? "success" : "neutral"}>
                    {row.published ? "Public" : "Private"}
                  </Badge>
                ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (row) =>
                  canEdit ? (
                    <div className="admin-table__actions">
                      <Button size="sm" variant="outline" icon="edit" onClick={() => open(row)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        icon="trash"
                        onClick={() => void remove(row)}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : null,
              },
            ]}
          />
        </CardBody>
      </Card>
      {canEdit ? (
        <Button variant="primary" icon="plus" onClick={() => open("new")}>
          Add document
        </Button>
      ) : null}
      <Modal
        asForm
        open={editing !== null}
        title={editing === "new" ? "Add document" : "Edit document"}
        subtitle="A new version of the same title is added as a new row; older versions stay downloadable."
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
        <div className="admin-form-grid">
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="orgdoc-type">
              Type
            </label>
            <Select
              id="orgdoc-type"
              className="admin-select"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as OrgDocumentType })}
            >
              {ORG_DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ORG_DOCUMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="orgdoc-status">
              Status
            </label>
            <Select
              id="orgdoc-status"
              className="admin-select"
              value={form.published ? "public" : "private"}
              onChange={(e) => setForm({ ...form, published: e.target.value === "public" })}
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
            </Select>
          </div>
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="orgdoc-title">
              Title *
            </label>
            <input
              id="orgdoc-title"
              className="admin-input"
              required
              minLength={3}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="orgdoc-version">
              Version label
            </label>
            <input
              id="orgdoc-version"
              className="admin-input"
              placeholder="e.g. 2026 revision"
              value={form.versionLabel}
              onChange={(e) => setForm({ ...form, versionLabel: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="orgdoc-date">
              Date *
            </label>
            <input
              id="orgdoc-date"
              className="admin-input"
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="orgdoc-file">
              PDF (up to 10 MB)
              {editing !== "new" && editing?.file ? ` — now: ${editing.file.name}` : ""}
            </label>
            <input
              id="orgdoc-file"
              className="admin-input"
              type="file"
              accept="application/pdf"
              onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="orgdoc-link">
              Or a link (https)
            </label>
            <input
              id="orgdoc-link"
              className="admin-input"
              type="url"
              value={form.link}
              onChange={(e) => setForm({ ...form, link: e.target.value })}
            />
          </div>
          {message ? (
            <p className="admin-field__error admin-form-grid__full" role="alert">
              {message}
            </p>
          ) : null}
        </div>
      </Modal>
      <ToastBanner message={toast.message} />
    </>
  );
}
