"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FeaturedImage } from "@website/domain/content";
import { FINANCE_CURRENCIES } from "@website/domain/finance";
import type { DonationState } from "@website/domain/organizations";
import { formatMoney } from "@website/domain/shared";
import {
  rejectDonationAction,
  saveDonationChannelAction,
  verifyDonationAction,
} from "@/app/(panel)/finance/donations/actions";
import { actionMessage } from "@/components/action-message";
import { publicImage, useImageUpload } from "@/components/image-upload";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Column } from "@/components/ui/data-table";
import {
  ListCard,
  ListEmpty,
  MenuItem,
  RowMenu,
  SearchBox,
  SortMenu,
  Tabs,
  useListTable,
} from "@/components/ui/list-controls";
import { Modal } from "@/components/ui/modal";
import { PhotoDrop } from "@/components/ui/photo-drop";
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { UploadBar } from "@/components/ui/upload-bar";

export interface ChannelRow {
  id: string;
  version: number;
  label: string;
  details: string;
  image: FeaturedImage | null;
  currency: string;
  published: boolean;
}

export interface DonationItem {
  id: string;
  channel: string;
  donor: string;
  amountMinor: number;
  currency: string;
  message: string | null;
  shownAs: string | null;
  status: DonationState;
  note: string | null;
  date: string;
  /** The checker is the donor: someone else must decide. */
  own: boolean;
}

type View = "donations" | "channels";
type DonationKey = "donor" | "amount" | "status";
type ChannelKey = "label" | "status";
const donationSort = (r: DonationItem, key: DonationKey): string | number =>
  key === "donor" ? r.donor.toLowerCase() : key === "amount" ? r.amountMinor : r.status;
const donationText = (r: DonationItem, key: DonationKey): string =>
  key === "donor"
    ? r.donor
    : key === "amount"
      ? formatMoney({ amountMinor: r.amountMinor, currency: r.currency })
      : r.status;
const channelSort = (r: ChannelRow, key: ChannelKey): string =>
  key === "label" ? r.label.toLowerCase() : String(r.published);
const channelText = (r: ChannelRow, key: ChannelKey): string =>
  key === "label" ? r.label : r.published ? "Public" : "Hidden";

const TONES = { pending: "warn", verified: "success", rejected: "danger" } as const;
const emptyChannel = (): Omit<ChannelRow, "id" | "version"> => ({
  label: "",
  details: "",
  image: null,
  currency: "IDR",
  published: true,
});

/** Donation channels and the donations to check (N5.4): a verified donation becomes one cash book line. */
export function DonationsPage(props: {
  channels: ChannelRow[];
  donations: DonationItem[];
  canExport: boolean;
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const upload = useImageUpload("banner");
  const [editing, setEditing] = useState<ChannelRow | "new" | null>(null);
  const [form, setForm] = useState(emptyChannel());
  const [rejecting, setRejecting] = useState<DonationItem | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<View>("donations");
  const [query, setQuery] = useState("");
  const [searchKey, setSearchKey] = useState(0);

  const q = query.trim().toLowerCase();
  const shownDonations = useMemo(
    () =>
      props.donations.filter(
        (r) =>
          view !== "donations" ||
          !q ||
          [r.donor, r.channel].some((v) => v.toLowerCase().includes(q)),
      ),
    [props.donations, view, q],
  );
  const shownChannels = useMemo(
    () =>
      props.channels.filter((r) => view !== "channels" || !q || r.label.toLowerCase().includes(q)),
    [props.channels, view, q],
  );
  const donationTable = useListTable(shownDonations, donationSort, undefined, donationText);
  const channelTable = useListTable(shownChannels, channelSort, undefined, channelText);
  const table = view === "donations" ? donationTable : channelTable;

  const openChannel = (row: ChannelRow | "new") => {
    setForm(row === "new" ? emptyChannel() : row);
    setMessage(null);
    setEditing(row);
  };

  const saveChannel = async () => {
    if (editing === null) return;
    setBusy(true);
    const current = editing === "new" ? null : editing;
    const result = await saveDonationChannelAction({
      ...(current ? { id: current.id, version: current.version } : { version: null }),
      label: form.label,
      details: form.details,
      image: form.image,
      currency: form.currency,
      published: form.published,
    });
    setBusy(false);
    if (!result.ok) return setMessage(actionMessage(result));
    setEditing(null);
    router.refresh();
    toast.show("Channel saved");
  };

  const decide = async (item: DonationItem, verify: boolean) => {
    setBusy(true);
    const result = verify
      ? await verifyDonationAction({ id: item.id })
      : await rejectDonationAction({ id: item.id, note });
    setBusy(false);
    if (!result.ok) return toast.show(actionMessage(result));
    setRejecting(null);
    setNote("");
    router.refresh();
    toast.show(verify ? "Donation verified and added to the cash book" : "Donation rejected");
  };

  const switchView = (next: View) => {
    setView(next);
    setQuery("");
    setSearchKey((k) => k + 1);
    donationTable.setPage(1);
    channelTable.setPage(1);
  };
  const clearFilters = () => {
    setQuery("");
    setSearchKey((k) => k + 1);
    table.clearFilters();
    table.setPage(1);
  };

  const donationColumns: Column<DonationItem>[] = [
    {
      key: "donor",
      header: donationTable.header("donor", "Donation"),
      render: (row) => (
        <>
          <span className="admin-table__title">{row.donor}</span>
          <span className="admin-table__sub">
            {row.channel} · {row.date} · shown as {row.shownAs ?? "Anonymous"}
            {row.message ? ` · "${row.message}"` : ""}
          </span>
        </>
      ),
    },
    {
      key: "amount",
      header: donationTable.header("amount", "Amount"),
      render: (row) => formatMoney({ amountMinor: row.amountMinor, currency: row.currency }),
    },
    {
      key: "status",
      header: donationTable.header("status", "Status"),
      render: (row) => (
        <>
          <Badge tone={TONES[row.status]}>{row.status}</Badge>
          {row.note ? <span className="admin-table__sub">{row.note}</span> : null}
        </>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      render: (row) => (
        <div className="admin-table__actions">
          {row.status === "pending" ? (
            <Button
              variant="ghost"
              size="icon"
              icon="check"
              aria-label="Verify"
              title={row.own ? "Someone else must check your donation" : "Verify"}
              disabled={busy || row.own}
              onClick={() => void decide(row, true)}
            />
          ) : null}
          <RowMenu>
            <MenuItem
              icon="eye"
              onClick={() => window.open(`/api/donation-proofs/${row.id}`, "_blank")}
            >
              View<span className="admin-long"> Proof</span>
            </MenuItem>
            {row.status === "pending" ? (
              <MenuItem
                icon="x"
                danger
                disabled={busy || row.own}
                onClick={() => setRejecting(row)}
              >
                Reject
              </MenuItem>
            ) : null}
          </RowMenu>
        </div>
      ),
    },
  ];

  const channelColumns: Column<ChannelRow>[] = [
    {
      key: "label",
      header: channelTable.header("label", "Channel"),
      render: (row) => (
        <>
          <span className="admin-table__title">{row.label}</span>
          <span className="admin-table__sub">{row.currency}</span>
        </>
      ),
    },
    {
      key: "status",
      header: channelTable.header("status", "Status"),
      render: (row) => (
        <Badge tone={row.published ? "success" : "neutral"}>
          {row.published ? "Public" : "Hidden"}
        </Badge>
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
            icon="edit"
            aria-label="Edit"
            title="Edit"
            onClick={() => openChannel(row)}
          />
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Donations</h1>
          <p className="admin-page-header__desc">
            Members send a proof of transfer; a verified donation is one income line in the cash
            book. A hidden channel keeps its past donations.
          </p>
        </div>
        <div className="admin-page-header__actions">
          <div className="admin-fab">
            {view === "donations" && props.canExport ? (
              <Button variant="outline" size="sm" icon="download" href="/api/donations/export">
                Export CSV
              </Button>
            ) : null}
            {view === "channels" ? (
              <Button variant="primary" size="sm" icon="plus" onClick={() => openChannel("new")}>
                Add Channel
              </Button>
            ) : null}
          </div>
          {view === "donations" ? (
            <SortMenu columns={donationColumns} />
          ) : (
            <SortMenu columns={channelColumns} />
          )}
          <SearchBox
            key={`${view}${searchKey}`}
            placeholder={view === "donations" ? "Search by donor..." : "Search by channel..."}
            label="Search"
            onSearch={(value) => {
              setQuery(value);
              table.setPage(1);
            }}
          />
        </div>
      </div>

      <Tabs
        label="Donation lists"
        tabs={[
          { key: "donations", label: "Donations", count: props.donations.length },
          { key: "channels", label: "Channels", count: props.channels.length },
        ]}
        active={view}
        onSelect={switchView}
      />

      {view === "donations" ? (
        <ListCard
          table={donationTable}
          noun="donation"
          columns={donationColumns}
          empty={
            <ListEmpty
              noun="donation"
              query={query}
              filters={donationTable.filterCount}
              emptyHint="Donations appear here when members send a proof."
              onClear={clearFilters}
            />
          }
        />
      ) : (
        <ListCard
          table={channelTable}
          noun="channel"
          columns={channelColumns}
          empty={
            <ListEmpty
              noun="channel"
              query={query}
              filters={channelTable.filterCount}
              emptyHint="Add the first channel."
              onClear={clearFilters}
              addLabel="Add Channel"
              onAdd={() => openChannel("new")}
            />
          }
        />
      )}
      <Modal
        asForm
        open={editing !== null}
        title={editing === "new" ? "Add Channel" : "Edit Channel"}
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
              onClick={() => void saveChannel()}
            >
              Save
            </Button>
          </div>
        }
      >
        <div className="admin-form-grid">
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="channel-label">
              Name *
            </label>
            <input
              id="channel-label"
              className="admin-input"
              required
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="channel-currency">
              Currency
            </label>
            <Select
              id="channel-currency"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            >
              {FINANCE_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="channel-status">
              Status
            </label>
            <Select
              id="channel-status"
              value={form.published ? "public" : "hidden"}
              onChange={(e) => setForm({ ...form, published: e.target.value === "public" })}
            >
              <option value="public">Public</option>
              <option value="hidden">Hidden</option>
            </Select>
          </div>
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="channel-details">
              How to send (account number, holder name) *
            </label>
            <textarea
              id="channel-details"
              className="admin-input admin-textarea"
              rows={4}
              required
              value={form.details}
              onChange={(e) => setForm({ ...form, details: e.target.value })}
            />
          </div>
          <div className="admin-form-grid__full">
            <PhotoDrop
              value={form.image?.thumbUrl ?? null}
              label="QR code"
              onFile={(file) =>
                void upload.upload(file).then((image) => {
                  const next = image ? publicImage(image) : null;
                  if (next) setForm((f) => ({ ...f, image: next }));
                })
              }
              onClear={() => setForm({ ...form, image: null })}
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
      <Modal
        asForm
        open={rejecting !== null}
        title="Reject donation"
        onClose={() => setRejecting(null)}
        footer={
          <div className="admin-modal__footer-row">
            <Button variant="outline" icon="chevronLeft" onClick={() => setRejecting(null)}>
              Back
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={busy || note.trim().length < 3}
              onClick={() => rejecting && void decide(rejecting, false)}
            >
              Reject
            </Button>
          </div>
        }
      >
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="donation-reject-note">
            Reason (the donor reads it)
          </label>
          <textarea
            id="donation-reject-note"
            className="admin-input admin-textarea"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </Modal>
      <ToastBanner message={toast.message} />
    </div>
  );
}
