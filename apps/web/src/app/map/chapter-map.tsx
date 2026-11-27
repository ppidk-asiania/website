"use client";

import { useRef, useState, type ReactNode } from "react";
import { CountryMap, type CountryMapHandle } from "@website/ui";
import type { Language } from "@/i18n/dictionaries";
import { countryName } from "@/lib/country-names";

export function ChapterMap(props: {
  language: Language;
  labels: {
    map: string;
    close: string;
    noInfo: string;
    zoomIn: string;
    zoomOut: string;
    reset: string;
  };
  panels: Readonly<Record<string, ReactNode>>;
  list: ReactNode;
}) {
  const map = useRef<CountryMapHandle>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const show = (target: EventTarget) => {
    const code = (target as Element).closest("[data-code]")?.getAttribute("data-code");
    if (!code) return;
    setSelected(code);
    map.current?.fitTo(code);
  };

  return (
    <div className="site-map">
      <div className="site-map__map">
        <CountryMap
          ref={map}
          locale={props.language}
          labels={props.labels}
          marked={Object.keys(props.panels)}
          selected={selected}
          onSelect={(code) => setSelected((current) => (current === code ? null : code))}
        />
      </div>
      <aside onClick={(e) => show(e.target)}>
        {selected ? (
          <section className="chapter__panel" aria-live="polite">
            <button
              type="button"
              className="chapter__back site-map__close"
              onClick={() => setSelected(null)}
            >
              ← {props.labels.close}
            </button>
            <h2 className="chapter__name">{countryName(selected, props.language)}</h2>
            {props.panels[selected] ?? <p className="chapter__about">{props.labels.noInfo}</p>}
          </section>
        ) : (
          props.list
        )}
      </aside>
    </div>
  );
}
