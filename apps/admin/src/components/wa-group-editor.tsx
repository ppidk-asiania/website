"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GROUP_KEYWORDS, type WaGroup } from "@website/domain/recruitment";
import { saveWaGroupAction, testWaGroupAction } from "@/app/(panel)/recruitment/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { useToastMessage } from "@/components/ui/toast";

/** Step 11.8: the WhatsApp group of this recruitment; its id is pasted from WAHA. */
export function WaGroupEditor(props: {
  recruitmentId: string;
  version: number;
  group: WaGroup | null;
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const [id, setId] = useState(props.group?.id ?? "");
  const [name, setName] = useState(props.group?.name ?? "");
  const [busy, setBusy] = useState(false);

  const save = async (group: WaGroup | null) => {
    setBusy(true);
    const result = await saveWaGroupAction({
      id: props.recruitmentId,
      version: props.version,
      group,
    });
    setBusy(false);
    toast.show(result.ok ? "WhatsApp group saved" : actionMessage(result));
    if (result.ok) router.refresh();
  };
  const test = async () => {
    setBusy(true);
    const result = await testWaGroupAction({ id: props.recruitmentId });
    setBusy(false);
    toast.show(result.ok ? `Test message: ${result.data.status}` : actionMessage(result));
  };

  return (
    <Card className="admin-list-card">
      <CardBody>
        <h2 className="admin-card__title">WhatsApp group</h2>
        <p className="admin-card__subtitle">
          New applications and interview bookings are posted here. Members with access to this recap
          can send {GROUP_KEYWORDS.map((k) => `/${k}`).join(" ")} in the group.
        </p>
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="wa-group-id">
            Group id (like 120363041@g.us)
          </label>
          <input
            id="wa-group-id"
            className="admin-input"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </div>
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="wa-group-name">
            Group name
          </label>
          <input
            id="wa-group-name"
            className="admin-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button size="sm" icon="check" disabled={busy} onClick={() => void save({ id, name })}>
          Save group
        </Button>{" "}
        <Button
          variant="outline"
          size="sm"
          icon="send"
          disabled={busy || !props.group}
          onClick={() => void test()}
        >
          Send test message
        </Button>{" "}
        <Button
          variant="outline"
          size="sm"
          icon="trash"
          disabled={busy || !props.group}
          onClick={() => void save(null)}
        >
          Remove
        </Button>
      </CardBody>
    </Card>
  );
}
