"use client";

import jsQR from "jsqr";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckInOutcome } from "@website/domain/events";
import {
  attendanceAction,
  checkInAction,
  scanTicketAction,
  undoCheckInAction,
} from "@/app/(panel)/events/[id]/scan/actions";
import { actionMessage } from "@/components/action-message";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import type { Attendee, Card as ResultCard } from "@/server/event-checkin";

const OUTCOMES: Record<CheckInOutcome, { text: string; tone: BadgeTone }> = {
  checked_in: { text: "Checked in", tone: "success" },
  already: { text: "Already checked in", tone: "warn" },
  not_paid: { text: "Not paid", tone: "danger" },
  waitlisted: { text: "On the waiting list", tone: "danger" },
  cancelled: { text: "Cancelled", tone: "danger" },
  unknown: { text: "Not a ticket for this event", tone: "danger" },
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export interface Attendance {
  title: string;
  practice: boolean;
  present: number;
  registered: number;
  people: Attendee[];
}

/** The door scanner (N1.4): present / registered on top, a camera that reads ticket QR codes, and a name search. */
export function EventScanPage({ eventId, initial }: { eventId: string; initial: Attendance }) {
  const toast = useToastMessage();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<Attendance>(initial);
  const [card, setCard] = useState<ResultCard | null>(null);
  const [query, setQuery] = useState("");
  const [camera, setCamera] = useState(false);
  const busy = useRef(false);
  const last = useRef({ token: "", at: 0 });

  const refresh = useCallback(async () => {
    const result = await attendanceAction({ eventId });
    if (result.ok) setData(result.data);
    else toast.show(actionMessage(result));
  }, [eventId, toast]);

  const scanned = useCallback(
    async (token: string) => {
      // The same code stays in front of the camera for a second or two: ask once.
      const now = Date.now();
      if (busy.current || (last.current.token === token && now - last.current.at < 4000)) return;
      busy.current = true;
      last.current = { token, at: now };
      const result = await scanTicketAction({ eventId, token });
      busy.current = false;
      if (!result.ok) return toast.show(actionMessage(result));
      setCard(result.data);
      void refresh();
    },
    [eventId, refresh, toast],
  );

  useEffect(() => {
    if (!camera) return;
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const tick = () => {
      const v = video.current;
      const c = canvas.current;
      if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
        const width = 480;
        const height = Math.round((v.videoHeight / v.videoWidth) * width) || 360;
        c.width = width;
        c.height = height;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(v, 0, 0, width, height);
          const found = jsQR(ctx.getImageData(0, 0, width, height).data, width, height);
          if (found?.data) void scanned(found.data.trim());
        }
      }
      if (!stopped) frame = requestAnimationFrame(tick);
    };
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play();
        }
        frame = requestAnimationFrame(tick);
      })
      .catch(() => {
        setCamera(false);
        toast.show("The camera is not available. Search by name instead.");
      });
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camera, scanned, toast]);

  const act = async (person: Attendee, undo: boolean) => {
    const input = { eventId, userId: person.userId };
    const result = undo ? await undoCheckInAction(input) : await checkInAction(input);
    if (!result.ok) return toast.show(actionMessage(result));
    if (!undo) setCard(result.data as ResultCard);
    toast.show(undo ? "Check-in undone" : "Checked in");
    void refresh();
  };

  const people = data.people.filter((p) =>
    p.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">
            {`${data.present} / ${data.registered} present`}
          </h1>
          <p className="admin-page-header__desc">
            {data.title}
            {data.practice
              ? " · Practice: it is before the event day, so scans show their result and store nothing."
              : ""}
          </p>
        </div>
        <div className="admin-page-header__actions">
          <Button
            variant={camera ? "outline" : "primary"}
            size="sm"
            icon="eye"
            onClick={() => setCamera(!camera)}
          >
            {camera ? "Stop camera" : "Start camera"}
          </Button>
        </div>
      </div>
      {camera ? (
        <Card>
          <CardBody>
            <video ref={video} muted playsInline aria-label="Camera" style={{ maxWidth: "100%" }} />
            <canvas ref={canvas} hidden />
          </CardBody>
        </Card>
      ) : null}
      {card ? (
        <Card>
          <CardBody>
            <div role="status">
              <Badge tone={OUTCOMES[card.outcome].tone}>{OUTCOMES[card.outcome].text}</Badge>
              {card.name ? <strong> {card.name}</strong> : null}
              {card.category ? ` · ${card.category}` : ""}
              {card.at && (card.outcome === "already" || card.outcome === "checked_in")
                ? ` · ${clock(card.at)}`
                : ""}
              {card.practice ? " · practice, nothing stored" : ""}
            </div>
          </CardBody>
        </Card>
      ) : null}
      <div className="admin-field">
        <label className="admin-field__label" htmlFor="scan-search">
          Search by name
        </label>
        <input
          id="scan-search"
          className="admin-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <Card className="admin-list-card">
        <CardBody flush>
          <ul className="admin-scan-list">
            {people.map((p) => (
              <li key={p.userId} className="admin-scan-list__row">
                <span>
                  <span className="admin-table__title">{p.name || "(no name)"}</span>
                  <span className="admin-table__sub">
                    {p.category ? `${p.category} · ` : ""}
                    {p.checkedInAt ? `Present ${clock(p.checkedInAt)} (${p.method})` : ""}
                  </span>
                </span>
                {p.outcome === "checked_in" ? (
                  <Button
                    size="sm"
                    variant="primary"
                    icon="check"
                    onClick={() => void act(p, false)}
                  >
                    Check in
                  </Button>
                ) : p.canUndo ? (
                  <Button size="sm" variant="outline" onClick={() => void act(p, true)}>
                    Undo
                  </Button>
                ) : (
                  <Badge tone={OUTCOMES[p.outcome].tone}>{OUTCOMES[p.outcome].text}</Badge>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <ToastBanner message={toast.message} />
    </div>
  );
}
