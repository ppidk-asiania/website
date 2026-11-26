"use client";

import { useState } from "react";
import {
  COMMITTEE_SEATS,
  APPLICATION_KINDS,
  COMMITTEE_TEMPLATES,
  type ApplicationForm,
  committeeGaps,
  type CommitteeSeat,
  type Division,
} from "@website/domain/events";
import {
  findCommitteePeopleAction,
  listCommitteeApplicantsAction,
  loadCommitteeAction,
  placeCommitteeApplicantAction,
  saveCommitteeAction,
} from "@/app/(panel)/events/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

interface Seat {
  userId: string | null;
  name: string;
  shownName: string;
  divisionId: string;
  seat: CommitteeSeat;
}

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

/**
 * Divisions and people of one event (N1.5). The first division is the event board. A seat gives rights on this
 * event only: any seat scans tickets and sees the short registrant list, the board sees the full one. Rights end
 * 14 days after the event.
 */
export interface PublicFormChoice {
  id: string;
  title: string;
}

type Applicants = Extract<
  Awaited<ReturnType<typeof listCommitteeApplicantsAction>>,
  { ok: true }
>["data"];

const KIND_LABELS: Record<ApplicationForm["kind"], string> = {
  volunteer: "Volunteer sign-up",
  committee: "Committee application (accounts)",
};

export function EventCommitteePanel(props: {
  eventId: string;
  forms: PublicFormChoice[];
  show: (message: string) => void;
}) {
  const { eventId, forms, show } = props;
  const [links, setLinks] = useState<ApplicationForm[]>([]);
  const [applicants, setApplicants] = useState<Applicants | null>(null);
  const [choice, setChoice] = useState<Record<string, { divisionId: string; seat: CommitteeSeat }>>(
    {},
  );
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [members, setMembers] = useState<Seat[]>([]);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<
    Array<{ uid: string; name: string | null; email: string | null }>
  >([]);
  const [helper, setHelper] = useState("");

  const load = async () => {
    setBusy(true);
    const result = await loadCommitteeAction({ eventId });
    setBusy(false);
    if (!result.ok) return show(actionMessage(result));
    setVersion(result.data.version);
    setDivisions([...result.data.divisions]);
    setMembers(result.data.members.map((m) => ({ ...m })));
    setLinks([...result.data.applicationForms]);
    setLoaded(true);
  };

  const save = async () => {
    setBusy(true);
    const result = await saveCommitteeAction({
      eventId,
      version,
      committee: {
        applicationForms: links,
        divisions: divisions.map((d) => ({ ...d, name: d.name.trim() })),
        members: members.map(({ userId, name, divisionId, seat }) => ({
          userId,
          name: userId ? "" : name.trim(),
          divisionId,
          seat,
        })),
      },
    });
    setBusy(false);
    if (!result.ok) return show(actionMessage(result));
    setVersion(result.data.version);
    show("Committee saved");
  };

  const applyTemplate = (key: keyof typeof COMMITTEE_TEMPLATES) => {
    const rows = COMMITTEE_TEMPLATES[key];
    const ids = new Map(rows.map((r) => [r.name, newId()]));
    setDivisions(
      rows.map((r) => ({
        id: ids.get(r.name) as string,
        name: r.name,
        parentId: r.parent ? (ids.get(r.parent) ?? null) : null,
        quota: r.quota,
        description: "",
      })),
    );
    setMembers([]);
  };

  const search = async () => {
    const result = await findCommitteePeopleAction({ query });
    if (!result.ok) return show(actionMessage(result));
    setFound(result.data);
  };

  const loadApplicants = async () => {
    const result = await listCommitteeApplicantsAction({ eventId });
    if (!result.ok) return show(actionMessage(result));
    setApplicants(result.data);
  };
  const decide = async (
    formId: string,
    responseId: string,
    placement:
      { outcome: "rejected" } | { outcome: "placed"; divisionId: string; seat: CommitteeSeat },
  ) => {
    setBusy(true);
    const result = await placeCommitteeApplicantAction({ eventId, formId, responseId, placement });
    setBusy(false);
    if (!result.ok) return show(actionMessage(result));
    show(placement.outcome === "placed" ? "Placed on the committee" : "Rejected");
    // The seat was written by the server: reload both lists.
    await Promise.all([load(), loadApplicants()]);
  };

  const first = divisions[0]?.id ?? "";
  const addMember = (person: Pick<Seat, "userId" | "name" | "shownName">) => {
    if (first === "") return show("Add a division first (the first one is the event board).");
    setMembers([...members, { ...person, divisionId: first, seat: "member" }]);
    setFound([]);
    setQuery("");
    setHelper("");
  };
  const patchDivision = (i: number, change: Partial<Division>) =>
    setDivisions(divisions.map((d, at) => (at === i ? { ...d, ...change } : d)));
  const patchMember = (i: number, change: Partial<Seat>) =>
    setMembers(members.map((m, at) => (at === i ? { ...m, ...change } : m)));
  const gaps = committeeGaps({ divisions, members });

  if (!loaded) {
    return (
      <div className="admin-form-grid__full">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}>
          Open the committee
        </Button>
      </div>
    );
  }

  return (
    <fieldset className="admin-form-grid__full admin-event-committee">
      <legend className="admin-field__label">Committee</legend>
      {divisions.length === 0 ? (
        <p>
          Start from a template:{" "}
          {(Object.keys(COMMITTEE_TEMPLATES) as Array<keyof typeof COMMITTEE_TEMPLATES>).map(
            (k) => (
              <Button key={k} variant="outline" size="sm" onClick={() => applyTemplate(k)}>
                {k}
              </Button>
            ),
          )}
        </p>
      ) : null}
      {divisions.map((d, i) => (
        <div key={d.id} className="admin-form-grid">
          <div className="admin-field">
            <label className="admin-field__label" htmlFor={`division-name-${d.id}`}>
              {i === 0 ? "Event board" : "Division"}
            </label>
            <input
              id={`division-name-${d.id}`}
              className="admin-input"
              value={d.name}
              onChange={(e) => patchDivision(i, { name: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor={`division-parent-${d.id}`}>
              Under
            </label>
            <Select
              id={`division-parent-${d.id}`}
              value={d.parentId ?? ""}
              disabled={i === 0}
              onChange={(e) => patchDivision(i, { parentId: e.target.value || null })}
            >
              <option value="">(top level)</option>
              {divisions
                .filter((p) => p.parentId === null && p.id !== d.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor={`division-quota-${d.id}`}>
              People wanted
            </label>
            <input
              id={`division-quota-${d.id}`}
              className="admin-input"
              inputMode="numeric"
              value={d.quota ?? ""}
              onChange={(e) =>
                patchDivision(i, { quota: e.target.value ? Number(e.target.value) : null })
              }
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={
              i === 0 ||
              members.some((m) => m.divisionId === d.id) ||
              divisions.some((c) => c.parentId === d.id)
            }
            onClick={() => setDivisions(divisions.filter((_, at) => at !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        icon="plus"
        onClick={() =>
          setDivisions([
            ...divisions,
            { id: newId(), name: "", parentId: null, quota: null, description: "" },
          ])
        }
      >
        Add division
      </Button>
      {gaps.length > 0 ? (
        <p role="status">{gaps.map((g) => `${g.name} ${g.filled} of ${g.quota}`).join(" · ")}</p>
      ) : null}
      <h3 className="admin-section-title">People</h3>
      {members.map((m, i) => (
        <div key={m.userId ?? `${m.name}-${i}`} className="admin-form-grid">
          <span className="admin-table__title">
            {m.shownName}
            {m.userId ? "" : " (outside helper)"}
          </span>
          <Select
            aria-label={`Division of ${m.shownName}`}
            value={m.divisionId}
            onChange={(e) => patchMember(i, { divisionId: e.target.value })}
          >
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label={`Seat of ${m.shownName}`}
            value={m.seat}
            onChange={(e) => patchMember(i, { seat: e.target.value as CommitteeSeat })}
          >
            {COMMITTEE_SEATS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMembers(members.filter((_, at) => at !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
      <div className="admin-field">
        <label className="admin-field__label" htmlFor="committee-search">
          Find an account (name or e-mail)
        </label>
        <input
          id="committee-search"
          className="admin-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={query.trim().length < 2}
          onClick={() => void search()}
        >
          Search
        </Button>
      </div>
      <ul>
        {found.map((p) => (
          <li key={p.uid}>
            <Button
              variant="outline"
              size="sm"
              disabled={members.some((m) => m.userId === p.uid)}
              onClick={() =>
                addMember({ userId: p.uid, name: "", shownName: p.name ?? p.email ?? p.uid })
              }
            >
              Add {p.name ?? "(no name)"} · {p.email}
            </Button>
          </li>
        ))}
      </ul>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor="committee-helper">
          Or type the name of a helper without an account
        </label>
        <input
          id="committee-helper"
          className="admin-input"
          value={helper}
          onChange={(e) => setHelper(e.target.value)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={helper.trim() === ""}
          onClick={() => addMember({ userId: null, name: helper.trim(), shownName: helper.trim() })}
        >
          Add helper
        </Button>
      </div>
      <h3 className="admin-section-title">Applications</h3>
      <p className="admin-field__hint">
        Link a public form of the Forms page: a guest form for volunteers, or an account form for
        committee applications. Save the committee, then place the answers below.
      </p>
      {links.map((link, i) => (
        <div key={link.formId} className="admin-form-grid">
          <Select
            aria-label="Form"
            value={link.formId}
            onChange={(e) =>
              setLinks(links.map((l, at) => (at === i ? { ...l, formId: e.target.value } : l)))
            }
          >
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Kind"
            value={link.kind}
            onChange={(e) =>
              setLinks(
                links.map((l, at) =>
                  at === i ? { ...l, kind: e.target.value as ApplicationForm["kind"] } : l,
                ),
              )
            }
          >
            {APPLICATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLinks(links.filter((_, at) => at !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        icon="plus"
        disabled={links.length >= 4 || forms.every((f) => links.some((l) => l.formId === f.id))}
        onClick={() => {
          const free = forms.find((f) => !links.some((l) => l.formId === f.id));
          if (free) setLinks([...links, { formId: free.id, kind: "volunteer" }]);
        }}
      >
        Link a form
      </Button>
      <Button variant="outline" size="sm" icon="check" disabled={busy} onClick={() => void save()}>
        Save committee
      </Button>
      <Button variant="outline" size="sm" onClick={() => void loadApplicants()}>
        Show applicants
      </Button>
      {applicants?.map((form) => (
        <div key={form.formId}>
          <h4 className="admin-section-title">
            {form.title} · {KIND_LABELS[form.kind]}
          </h4>
          {form.rows.length === 0 ? <p>No answers yet.</p> : null}
          {form.rows.map((row) => {
            const pick = choice[row.responseId] ?? { divisionId: first, seat: "member" as const };
            return (
              <div key={row.responseId} className="admin-form-grid">
                <div>
                  <span className="admin-table__title">{row.name || row.email}</span>
                  <span className="admin-table__sub">
                    {row.email}
                    {row.answers.map((a) => ` · ${a.label}: ${a.value}`).join("")}
                  </span>
                </div>
                {row.outcome ? (
                  <span>
                    {row.outcome === "placed"
                      ? `Placed: ${row.seat} of ${divisions.find((d) => d.id === row.divisionId)?.name ?? "?"}`
                      : "Rejected"}
                  </span>
                ) : (
                  <>
                    <Select
                      aria-label={`Division of ${row.name || row.email}`}
                      value={pick.divisionId}
                      onChange={(e) =>
                        setChoice({
                          ...choice,
                          [row.responseId]: { ...pick, divisionId: e.target.value },
                        })
                      }
                    >
                      {divisions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                    <Select
                      aria-label={`Seat of ${row.name || row.email}`}
                      value={pick.seat}
                      onChange={(e) =>
                        setChoice({
                          ...choice,
                          [row.responseId]: { ...pick, seat: e.target.value as CommitteeSeat },
                        })
                      }
                    >
                      {COMMITTEE_SEATS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy || pick.divisionId === ""}
                      onClick={() =>
                        void decide(form.formId, row.responseId, { outcome: "placed", ...pick })
                      }
                    >
                      Place
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void decide(form.formId, row.responseId, { outcome: "rejected" })
                      }
                    >
                      Reject
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </fieldset>
  );
}
