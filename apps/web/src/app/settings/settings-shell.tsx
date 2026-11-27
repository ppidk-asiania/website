import type { ReactNode } from "react";
import { FieldIcon } from "@/components/site-field-icon";
import type { DICTIONARIES } from "@/i18n/dictionaries";

type Dictionary = (typeof DICTIONARIES)[keyof typeof DICTIONARIES];

/** The settings frame: tabs on the left (one page per tab), the open tab on the right. */
export function SettingsShell(props: {
  d: Dictionary;
  tab: "profile" | "account" | "signature";
  /** Replaces the tab name as the heading, e.g. "Edit Profile". */
  title?: string | undefined;
  /** A button beside the heading. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const tabs = [
    { id: "profile", label: props.d.account.profile, icon: "user" },
    { id: "account", label: props.d.account.account, icon: "gear" },
    { id: "signature", label: props.d.signature.title, icon: "pen" },
  ] as const;
  return (
    <main className="site-settings">
      <nav className="site-settings-nav" aria-label={props.d.account.settings}>
        <p className="site-settings-heading">{props.d.account.settings}</p>
        {tabs.map((tab) => (
          <a
            key={tab.id}
            href={`/settings/${tab.id}`}
            aria-current={tab.id === props.tab ? "page" : undefined}
          >
            <FieldIcon name={tab.icon} className="site-settings-icon" />
            {tab.label}
          </a>
        ))}
      </nav>
      <section className="site-settings-body">
        <div className="site-settings-head">
          <h1>{props.title ?? tabs.find((tab) => tab.id === props.tab)?.label}</h1>
          {props.action}
        </div>
        {props.children}
      </section>
    </main>
  );
}
