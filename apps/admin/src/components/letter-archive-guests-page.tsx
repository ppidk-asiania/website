"use client";

import type { ReactNode } from "react";
import { type Column } from "@/components/ui/data-table";
import { formatInZone } from "@/components/format";
import { ListCard, ListEmpty, useListTable } from "@/components/ui/list-controls";

export interface ArchiveGuestItem {
  id: string;
  name: string;
  email: string;
  institution: string;
  at: string;
}

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const columns: Column<ArchiveGuestItem>[] = [
  {
    key: "name",
    header: "Name",
    width: "30%",
    render: (g) => <div className="admin-table__title">{g.name}</div>,
  },
  { key: "email", header: "E-mail", width: "30%", render: (g) => g.email },
  { key: "institution", header: "Institution", width: "25%", render: (g) => g.institution },
  {
    key: "at",
    header: "Signed",
    width: "15%",
    render: (g) => formatInZone(g.at, browserZone(), false),
  },
];

/** Read-only: the guest book is personal data, so there is no export and no edit. */
export function LetterArchiveGuestsPage(props: {
  initial: ArchiveGuestItem[];
  sectionTabs: ReactNode;
}) {
  const table = useListTable(props.initial, (g: ArchiveGuestItem) => g.at);
  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Letter &gt; Archive guests</h1>
          <p className="admin-page-header__desc">
            Who opened the public letter archive (newest 300). Each row is deleted 12 months after
            the visit.
          </p>
        </div>
      </div>
      {props.sectionTabs}
      <ListCard
        table={table}
        noun="guest"
        columns={columns}
        empty={
          <ListEmpty
            noun="guest"
            query=""
            filters={0}
            emptyHint="Nobody has opened the archive yet."
            onClear={() => undefined}
          />
        }
      />
    </div>
  );
}
