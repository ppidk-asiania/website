"use client";

import QRCode from "qrcode";
import { useState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import { linkWhatsappAction } from "./actions";

interface Code {
  readonly text: string;
  readonly url: string;
  readonly qr: string;
}

export function WhatsappLink(props: { t: Dictionary["profile"]; verified: boolean }) {
  const { t } = props;
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<Code | null>(null);
  const [failed, setFailed] = useState(false);

  const create = async () => {
    setBusy(true);
    setFailed(false);
    const result = await linkWhatsappAction();
    if (!result.ok) {
      setCode(null);
      setFailed(true);
    } else {
      const qr = await QRCode.toDataURL(result.url, { errorCorrectionLevel: "M", margin: 2 });
      setCode({ text: result.text, url: result.url, qr });
    }
    setBusy(false);
  };

  return (
    <div className="ui-form">
      <p>{props.verified ? t.whatsappVerified : t.whatsappNotVerified}</p>
      <button className="ui-button" type="button" disabled={busy} onClick={() => void create()}>
        {t.whatsappLink}
      </button>
      {code && (
        <>
          <p>{t.whatsappSteps}</p>
          <p>
            <code>{code.text}</code>
          </p>
          <p>
            <a href={code.url} target="_blank" rel="noopener noreferrer">
              {t.whatsappOpen}
            </a>
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing to optimise */}
          <img src={code.qr} alt={t.whatsappQr} width={220} height={220} />
        </>
      )}
      {failed && (
        <p role="alert" className="ui-message">
          {t.whatsappFailed}
        </p>
      )}
    </div>
  );
}
