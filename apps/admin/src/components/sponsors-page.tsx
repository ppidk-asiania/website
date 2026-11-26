"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FeaturedImage } from "@website/domain/content";
import { SPONSOR_TIERS, type SponsorTier } from "@website/domain/organizations";
import { deleteSponsorAction, saveSponsorAction } from "@/app/(panel)/sponsors/actions";
import { actionMessage } from "@/components/action-message";
import { publicImage, useImageUpload } from "@/components/image-upload";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { PhotoDrop } from "@/components/ui/photo-drop";
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { UploadBar } from "@/components/ui/upload-bar";

const TIER_LABELS: Record<SponsorTier, string> = {
  platinum: "Platinum",
  gold: "Gold",
  silver: "Silver",
  partner: "Partner",
};

export interface SponsorRow {
  id: string;
  version: number;
  name: string;
  tier: SponsorTier;
  logo: FeaturedImage | null;
  link: string;
  order: number;
  published: boolean;
}

type Form = Omit<SponsorRow, "id" | "version" | "order"> & { order: string };

const emptyForm = (): Form => ({
  name: "",
  tier: "partner",
  logo: null,
  link: "",
  order: "0",
  published: true,
});

/** The sponsors of the active board period: the home page strip and /sponsorship read this list (N5.3). */
export function SponsorsPage({ rows, canEdit }: { rows: SponsorRow[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToastMessage();
  const upload = useImageUpload("speaker");
  const [editing, setEditing] = useState<SponsorRow | "new" | null>(null);
  const [form, setForm] = useState<Form>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const open = (row: SponsorRow | "new") => {
    setForm(row === "new" ? emptyForm() : { ...row, order: String(row.order) });
    setMessage(null);
    setEditing(row);
  };

  const save = async () => {
    if (editing === null) return;
    setBusy(true);
    const current = editing === "new" ? null : editing;
    const result = await saveSponsorAction({
      ...(current ? { id: current.id, version: current.version } : { version: null }),
      name: form.name,
      tier: form.tier,
      logo: form.logo,
      link: form.link,
      order: Number(form.order),
      published: form.published,
    });
    setBusy(false);
    if (!result.ok) return setMessage(actionMessage(result));
    setEditing(null);
    router.refresh();
    toast.show("Sponsor saved");
  };

  const remove = async (row: SponsorRow) => {
    const result = await deleteSponsorAction({ id: row.id, version: row.version });
    if (!result.ok) return toast.show(actionMessage(result));
    router.refresh();
    toast.show("Sponsor deleted");
  };

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Sponsors</h1>
          <p className="admin-page-header__desc">
            Sponsors of the active board period. The public sponsorship page and the home page show
            the published ones, by tier.
          </p>
        </div>
      </div>
      <Card className="admin-list-card">
        <CardBody flush>
          <DataTable
            rowKey={(row) => row.id}
            rows={rows}
            emptyText="No sponsors in this period yet"
            columns={[
              {
                key: "name",
                header: "Sponsor",
                render: (row) => (
                  <>
                    <span className="admin-table__title">{row.name}</span>
                    <span className="admin-table__sub">
                      {TIER_LABELS[row.tier]} · position {row.order}
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
          Add sponsor
        </Button>
      ) : null}
      <Modal
        asForm
        open={editing !== null}
        title={editing === "new" ? "Add sponsor" : "Edit sponsor"}
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
              disabled={busy || upload.busy}
              onClick={() => void save()}
            >
              Save
            </Button>
          </div>
        }
      >
        <div className="admin-form-grid">
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="sponsor-name">
              Name *
            </label>
            <input
              id="sponsor-name"
              className="admin-input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="sponsor-tier">
              Tier
            </label>
            <Select
              id="sponsor-tier"
              value={form.tier}
              onChange={(e) => setForm({ ...form, tier: e.target.value as SponsorTier })}
            >
              {SPONSOR_TIERS.map((t) => (
                <option key={t} value={t}>
                  {TIER_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="sponsor-order">
              Position in the tier
            </label>
            <input
              id="sponsor-order"
              className="admin-input"
              type="number"
              min={0}
              max={999}
              value={form.order}
              onChange={(e) => setForm({ ...form, order: e.target.value })}
            />
          </div>
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="sponsor-link">
              Website (https)
            </label>
            <input
              id="sponsor-link"
              className="admin-input"
              type="url"
              value={form.link}
              onChange={(e) => setForm({ ...form, link: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="sponsor-status">
              Status
            </label>
            <Select
              id="sponsor-status"
              value={form.published ? "public" : "private"}
              onChange={(e) => setForm({ ...form, published: e.target.value === "public" })}
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
            </Select>
          </div>
          <div className="admin-form-grid__full">
            <PhotoDrop
              value={form.logo?.thumbUrl ?? null}
              label="Logo"
              onFile={(file) =>
                void upload.upload(file).then((image) => {
                  const logo = image ? publicImage(image) : null;
                  if (logo) setForm((f) => ({ ...f, logo }));
                })
              }
              onClear={() => setForm({ ...form, logo: null })}
            />
            <UploadBar upload={upload} />
          </div>
          {(message ?? upload.error) ? (
            <p className="admin-field__error admin-form-grid__full" role="alert">
              {message ?? upload.error}
            </p>
          ) : null}
        </div>
      </Modal>
      <ToastBanner message={toast.message} />
    </div>
  );
}
