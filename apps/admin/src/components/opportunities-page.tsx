"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FeaturedImage } from "@website/domain/content";
import {
  OPPORTUNITY_TYPES,
  opportunityPhase,
  type OpportunityStatus,
  type OpportunityType,
} from "@website/domain/opportunities";
import {
  createOpportunityAction,
  deleteOpportunityAction,
  setOpportunityStatusAction,
  updateOpportunityAction,
} from "@/app/(panel)/opportunities/actions";
import { actionMessage } from "@/components/action-message";
import { publicImage, useImageUpload } from "@/components/image-upload";
import { Badge } from "@/components/ui/badge";
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
import { PhotoDrop } from "@/components/ui/photo-drop";
import {
  joinBlocks,
  newBlock,
  RichTextStack,
  splitBlocks,
  type RichTextBlock,
} from "@/components/ui/rich-text-box";
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { UploadBar } from "@/components/ui/upload-bar";

export const TYPE_LABELS: Record<OpportunityType, string> = {
  internship: "Internship",
  full_time: "Full time",
  part_time: "Part time",
  volunteer: "Volunteer",
  scholarship: "Scholarship",
};

export interface OpportunityRow {
  id: string;
  version: number;
  title: string;
  organization: string;
  country: string;
  city: string;
  type: OpportunityType;
  description: string;
  requirements: string;
  deadline: string | null;
  applyUrl: string;
  image: FeaturedImage | null;
  status: OpportunityStatus;
  chapterId: string | null;
  owner: string;
  clicks: number;
  canEdit: boolean;
}

type Form = {
  title: string;
  organization: string;
  country: string;
  city: string;
  type: OpportunityType;
  deadline: string;
  applyUrl: string;
  image: FeaturedImage | null;
  status: OpportunityStatus;
  chapterId: string;
  description: RichTextBlock[];
  requirements: RichTextBlock[];
};

const emptyForm = (chapterId: string): Form => ({
  title: "",
  organization: "",
  country: "",
  city: "",
  type: "internship",
  deadline: "",
  applyUrl: "",
  image: null,
  status: "open",
  chapterId,
  description: [newBlock()],
  requirements: [newBlock()],
});

const blocksOf = (html: string) => (html ? splitBlocks(html) : [newBlock()]);

const today = () => new Date().toISOString().slice(0, 10);
const stateOf = (r: OpportunityRow) =>
  opportunityPhase({ status: r.status, deadline: r.deadline, deletedAt: null }, today());
const STATE_LABELS = { open: "Open", past: "Past deadline", archived: "Closed", hidden: "" };

type SortKey = "posting" | "type" | "status" | "clicks";
const sortValue = (r: OpportunityRow, key: SortKey): string | number =>
  key === "posting"
    ? r.title.toLowerCase()
    : key === "type"
      ? TYPE_LABELS[r.type]
      : key === "status"
        ? STATE_LABELS[stateOf(r)]
        : r.clicks;
const filterText = (r: OpportunityRow, key: SortKey): string =>
  key === "posting" ? r.title : key === "clicks" ? String(r.clicks) : String(sortValue(r, key));

/** The opportunities board: postings of the region and of chapters (N6.1). */
export function OpportunitiesPage(props: {
  rows: OpportunityRow[];
  owners: { value: string; label: string }[];
}) {
  const { rows, owners } = props;
  const router = useRouter();
  const toast = useToastMessage();
  const upload = useImageUpload("thumbnail");
  const inline = useImageUpload("thumbnail");
  const [editing, setEditing] = useState<OpportunityRow | "new" | null>(null);
  const [form, setForm] = useState<Form>(emptyForm(""));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const [deleting, setDeleting] = useState<OpportunityRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) => !q || [r.title, r.organization, r.country].some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, query]);
  const table = useListTable(filtered, sortValue, undefined, filterText);
  const canAdd = owners.length > 0;

  const open = (row: OpportunityRow | "new") => {
    setForm(
      row === "new"
        ? emptyForm(owners[0]?.value ?? "")
        : {
            title: row.title,
            organization: row.organization,
            country: row.country,
            city: row.city,
            type: row.type,
            deadline: row.deadline ?? "",
            applyUrl: row.applyUrl,
            image: row.image,
            status: row.status,
            chapterId: row.chapterId ?? "",
            description: blocksOf(row.description),
            requirements: blocksOf(row.requirements),
          },
    );
    setMessage(null);
    setEditing(row);
  };

  const save = async () => {
    if (editing === null) return;
    setBusy(true);
    const current = editing === "new" ? null : editing;
    const fields = {
      title: form.title,
      organization: form.organization,
      country: form.country,
      city: form.city,
      type: form.type,
      description: joinBlocks(form.description),
      requirements: joinBlocks(form.requirements),
      deadline: form.deadline || null,
      applyUrl: form.applyUrl,
      image: form.image,
      status: form.status,
    };
    // A posting keeps the chapter it was made for: only a new one sends it.
    const result = current
      ? await updateOpportunityAction({ id: current.id, version: current.version, ...fields })
      : await createOpportunityAction({ ...fields, chapterId: form.chapterId || null });
    setBusy(false);
    if (!result.ok) return setMessage(actionMessage(result));
    setEditing(null);
    router.refresh();
    toast.show("Posting saved");
  };

  const toggleStatus = async (row: OpportunityRow) => {
    const result = await setOpportunityStatusAction({
      id: row.id,
      version: row.version,
      status: row.status === "open" ? "closed" : "open",
    });
    if (!result.ok) return toast.show(actionMessage(result));
    router.refresh();
    toast.show(row.status === "open" ? "Posting closed" : "Posting reopened");
  };

  const remove = async () => {
    if (!deleting) return;
    const result = await deleteOpportunityAction({ id: deleting.id, version: deleting.version });
    setDeleting(null);
    if (!result.ok) return toast.show(actionMessage(result));
    router.refresh();
    toast.show("Posting deleted");
  };

  const columns: Column<OpportunityRow>[] = [
    {
      key: "posting",
      header: table.header("posting", "Posting"),
      render: (row) => (
        <>
          <span className="admin-table__title">{row.title}</span>
          <span className="admin-table__sub">
            {row.organization} · {row.country} · {row.owner}
          </span>
        </>
      ),
    },
    { key: "type", header: table.header("type", "Type"), render: (row) => TYPE_LABELS[row.type] },
    {
      key: "status",
      header: table.header("status", "Status"),
      render: (row) => {
        const state = stateOf(row);
        return (
          <>
            <Badge tone={state === "open" ? "success" : state === "past" ? "warn" : "neutral"}>
              {STATE_LABELS[state]}
            </Badge>
            {row.deadline ? <span className="admin-table__sub">until {row.deadline}</span> : null}
          </>
        );
      },
    },
    {
      key: "clicks",
      header: table.header("clicks", "Apply clicks"),
      align: "right",
      render: (row) => row.clicks,
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      render: (row) =>
        row.canEdit ? (
          <div className="admin-table__actions">
            <Button
              variant="ghost"
              size="icon"
              icon="edit"
              aria-label="Edit"
              title="Edit"
              onClick={() => open(row)}
            />
            <RowMenu>
              <MenuItem
                icon={row.status === "open" ? "lock" : "undo"}
                onClick={() => void toggleStatus(row)}
              >
                {row.status === "open" ? "Close" : "Reopen"}
                <span className="admin-long"> Posting</span>
              </MenuItem>
              <MenuItem icon="trash" danger onClick={() => setDeleting(row)}>
                Delete<span className="admin-long"> Posting</span>
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

  const uploadInline = async (file: File) => (await inline.upload(file))?.url ?? null;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Opportunities</h1>
          <p className="admin-page-header__desc">
            Jobs, internships, volunteer work and scholarships on the public Opportunities page.
            Closed postings move to the archive.
          </p>
        </div>
        <div className="admin-page-header__actions">
          {canAdd ? (
            <div className="admin-fab">
              <Button variant="primary" size="sm" icon="plus" onClick={() => open("new")}>
                Add Posting
              </Button>
            </div>
          ) : null}
          <SortMenu columns={columns} />
          <SearchBox
            key={searchKey}
            placeholder="Search by title, organisation or country..."
            label="Search postings"
            onSearch={(value) => {
              setQuery(value);
              table.setPage(1);
            }}
          />
        </div>
      </div>

      <ListCard
        table={table}
        noun="posting"
        columns={columns}
        empty={
          <ListEmpty
            noun="posting"
            query={query}
            filters={table.filterCount}
            emptyHint="Post the first opportunity."
            onClear={clearFilters}
            addLabel="Add Posting"
            onAdd={canAdd ? () => open("new") : null}
          />
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete Posting?"
        confirmLabel="Delete Posting"
        icon="trash"
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      >
        {deleting?.title} leaves the board and the archive.
      </ConfirmDialog>
      <Modal
        asForm
        open={editing !== null}
        title={editing === "new" ? "Add Posting" : "Edit Posting"}
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
              disabled={busy || upload.busy || inline.busy}
              onClick={() => void save()}
            >
              Save
            </Button>
          </div>
        }
      >
        <div className="admin-form-grid">
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="opp-title">
              Title *
            </label>
            <input
              id="opp-title"
              className="admin-input"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="opp-org">
              Organisation *
            </label>
            <input
              id="opp-org"
              className="admin-input"
              required
              value={form.organization}
              onChange={(e) => setForm({ ...form, organization: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="opp-type">
              Type
            </label>
            <Select
              id="opp-type"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as OpportunityType })}
            >
              {OPPORTUNITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="opp-country">
              Country *
            </label>
            <input
              id="opp-country"
              className="admin-input"
              required
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="opp-city">
              City
            </label>
            <input
              id="opp-city"
              className="admin-input"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="opp-deadline">
              Deadline
            </label>
            <input
              id="opp-deadline"
              className="admin-input"
              type="date"
              value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="opp-status">
              Status
            </label>
            <Select
              id="opp-status"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as OpportunityStatus })}
            >
              <option value="open">Open</option>
              <option value="closed">Closed (archive)</option>
            </Select>
          </div>
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="opp-link">
              Apply link (https)
            </label>
            <input
              id="opp-link"
              className="admin-input"
              type="url"
              value={form.applyUrl}
              onChange={(e) => setForm({ ...form, applyUrl: e.target.value })}
            />
            <span className="admin-field__hint">
              Leave empty to let people apply on the platform.
            </span>
          </div>
          {editing === "new" && owners.length > 1 ? (
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="opp-owner">
                Posted for
              </label>
              <Select
                id="opp-owner"
                value={form.chapterId}
                onChange={(e) => setForm({ ...form, chapterId: e.target.value })}
              >
                {owners.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="admin-form-grid__full">
            <RichTextStack
              blocks={form.description}
              onChange={(description) => setForm((f) => ({ ...f, description }))}
              uploadImage={uploadInline}
              label="Description"
            />
          </div>
          <div className="admin-form-grid__full">
            <RichTextStack
              blocks={form.requirements}
              onChange={(requirements) => setForm((f) => ({ ...f, requirements }))}
              uploadImage={uploadInline}
              label="Requirements"
            />
            <UploadBar upload={inline} />
          </div>
          <div className="admin-form-grid__full">
            <PhotoDrop
              value={form.image?.thumbUrl ?? null}
              label="Image"
              onFile={(file) =>
                void upload.upload(file).then((image) => {
                  const picked = image ? publicImage(image) : null;
                  if (picked) setForm((f) => ({ ...f, image: picked }));
                })
              }
              onClear={() => setForm({ ...form, image: null })}
            />
            <UploadBar upload={upload} />
          </div>
          {(message ?? upload.error ?? inline.error) ? (
            <p className="admin-field__error admin-form-grid__full" role="alert">
              {message ?? upload.error ?? inline.error}
            </p>
          ) : null}
        </div>
      </Modal>
      <ToastBanner message={toast.message} />
    </div>
  );
}
