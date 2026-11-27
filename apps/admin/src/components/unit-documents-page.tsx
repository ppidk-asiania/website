"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  deleteUnitDocumentAction,
  updateUnitDocumentAction,
} from "@/app/(panel)/documents/actions";
import { actionMessage } from "@/components/action-message";
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

export interface UnitDocumentRow {
  id: string;
  version: number;
  orgUnitId: string | null;
  unit: string;
  folder: string;
  title: string;
  fileName: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
  canWrite: boolean;
}

type Folder = { id: string | null; name: string };

type SortKey = "title" | "folder" | "added";
const folderText = (r: UnitDocumentRow) => (r.folder ? `${r.unit} / ${r.folder}` : r.unit);
const sortValue = (r: UnitDocumentRow, key: SortKey): string =>
  key === "title" ? r.title.toLowerCase() : key === "folder" ? folderText(r) : r.uploadedAt;
const filterText = (r: UnitDocumentRow, key: SortKey): string =>
  key === "title" ? r.title : key === "folder" ? folderText(r) : r.uploadedBy;

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function UnitDocumentsPage({
  rows,
  folders,
  periods,
  periodId,
}: {
  rows: UnitDocumentRow[];
  folders: Folder[];
  periods: { id: string; name: string }[];
  periodId: string;
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const [unit, setUnit] = useState("");
  const [modal, setModal] = useState<"add" | UnitDocumentRow | null>(null);
  const [target, setTarget] = useState(folders[0]?.id ?? "");
  const [folder, setFolder] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const [deleting, setDeleting] = useState<UnitDocumentRow | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (unit === "" || (r.orgUnitId ?? "period") === unit) &&
        (!q || r.title.toLowerCase().includes(q) || r.fileName.toLowerCase().includes(q)),
    );
  }, [rows, unit, query]);
  const table = useListTable(shown, sortValue, undefined, filterText);

  const open = (next: "add" | UnitDocumentRow) => {
    setMessage(null);
    setFile(null);
    setTitle(next === "add" ? "" : next.title);
    setFolder(next === "add" ? "" : next.folder);
    setModal(next);
  };

  const save = async () => {
    if (modal === null) return;
    setBusy(true);
    setMessage(null);
    if (modal === "add") {
      if (!file) {
        setBusy(false);
        return setMessage("Choose a file.");
      }
      const query = new URLSearchParams({
        unit: target ?? "",
        folder,
        title: title || file.name,
      });
      const response = await fetch(`/api/unit-documents?${query}`, {
        method: "POST",
        headers: { "x-file-name": encodeURIComponent(file.name) },
        body: file,
      });
      setBusy(false);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        return setMessage(body?.message ?? "The upload failed. Try again.");
      }
    } else {
      const result = await updateUnitDocumentAction({
        id: modal.id,
        version: modal.version,
        title,
        folder,
      });
      setBusy(false);
      if (!result.ok) return setMessage(actionMessage(result));
    }
    setModal(null);
    router.refresh();
    toast.show("Saved");
  };

  const remove = async () => {
    if (!deleting) return;
    const result = await deleteUnitDocumentAction({ id: deleting.id, version: deleting.version });
    setDeleting(null);
    if (!result.ok) return toast.show(actionMessage(result));
    router.refresh();
    toast.show("Deleted; the file is kept for 30 days");
  };

  const columns: Column<UnitDocumentRow>[] = [
    {
      key: "title",
      header: table.header("title", "Document"),
      render: (row) => (
        <>
          <a className="admin-table__title" href={`/api/unit-documents/${row.id}`}>
            {row.title}
          </a>
          <span className="admin-table__sub">
            {row.fileName} · {megabytes(row.size)}
          </span>
        </>
      ),
    },
    { key: "folder", header: table.header("folder", "Folder"), render: folderText },
    {
      key: "added",
      header: table.header("added", "Added"),
      render: (row) => `${row.uploadedBy} · ${row.uploadedAt}`,
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      render: (row) =>
        row.canWrite ? (
          <div className="admin-table__actions">
            <Button
              variant="ghost"
              size="icon"
              icon="edit"
              aria-label="Rename"
              title="Rename"
              onClick={() => open(row)}
            />
            <RowMenu>
              <MenuItem icon="trash" danger onClick={() => setDeleting(row)}>
                Delete<span className="admin-long"> File</span>
              </MenuItem>
            </RowMenu>
          </div>
        ) : null,
    },
  ];

  const clearFilters = () => {
    setQuery("");
    setSearchKey((k) => k + 1);
    table.clearFilters();
    table.setPage(1);
  };
  const units = [...new Map(rows.map((r) => [r.orgUnitId ?? "period", r.unit])).entries()];

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Documents</h1>
          <p className="admin-page-header__desc">
            Working files of each unit. Members of a unit manage their own folder; other officers of
            the same period can read.
          </p>
        </div>
        <div className="admin-page-header__actions">
          {periods.length > 0 ? (
            <Select
              className="admin-select"
              aria-label="Board period"
              value={periodId}
              onChange={(e) => router.push(`/documents?period=${e.target.value}`)}
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          ) : null}
          <Select
            className="admin-select"
            aria-label="Unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          >
            <option value="">All units</option>
            {units.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
          {folders.length > 0 ? (
            <div className="admin-fab">
              <Button variant="primary" size="sm" icon="upload" onClick={() => open("add")}>
                Add File
              </Button>
            </div>
          ) : null}
          <SortMenu columns={columns} />
          <SearchBox
            key={searchKey}
            placeholder="Search by title..."
            label="Search documents"
            onSearch={(value) => {
              setQuery(value);
              table.setPage(1);
            }}
          />
        </div>
      </div>
      <ListCard
        table={table}
        noun="document"
        columns={columns}
        empty={
          <ListEmpty
            noun="document"
            query={query}
            filters={table.filterCount}
            emptyHint="Add the first file."
            onClear={clearFilters}
            addLabel="Add File"
            onAdd={folders.length > 0 ? () => open("add") : null}
          />
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete File?"
        confirmLabel="Delete File"
        icon="trash"
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      >
        {deleting?.title} is removed from the folder. The file itself is kept for 30 days.
      </ConfirmDialog>
      <Modal
        asForm
        open={modal !== null}
        title={modal === "add" ? "Add File" : "Rename File"}
        onClose={() => setModal(null)}
        footer={
          <div className="admin-modal__footer-row">
            <Button variant="outline" icon="chevronLeft" onClick={() => setModal(null)}>
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
          {modal === "add" ? (
            <>
              <div className="admin-field admin-form-grid__full">
                <label className="admin-field__label" htmlFor="udoc-unit">
                  Unit
                </label>
                <Select
                  id="udoc-unit"
                  className="admin-select"
                  value={target ?? ""}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  {folders.map((f) => (
                    <option key={f.id ?? "period"} value={f.id ?? ""}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="admin-field admin-form-grid__full">
                <label className="admin-field__label" htmlFor="udoc-file">
                  File (PDF, Word, Excel, PowerPoint or image, up to 10 MB)
                </label>
                <input
                  id="udoc-file"
                  className="admin-input"
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
            </>
          ) : null}
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="udoc-title">
              Title
            </label>
            <input
              id="udoc-title"
              className="admin-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="udoc-folder">
              Folder (optional)
            </label>
            <input
              id="udoc-folder"
              className="admin-input"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
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
    </div>
  );
}
