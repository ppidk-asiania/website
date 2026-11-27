"use client";

import { useEffect, useState } from "react";
import { isPageChange } from "./page-change";

const GIVE_UP_MS = 10_000;

/**
 * Thin bar at the top of the window while a link is loading its page.
 * `route` is the current path and query; the bar ends when it changes.
 */
export function NavigationProgress({ route }: { route: string }) {
  const [state, setState] = useState({ route, pending: false });
  if (state.route !== route) setState({ route, pending: false });

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (event.altKey || link.hasAttribute("download")) return;
      if (link.target && link.target !== "_self") return;
      if (isPageChange(location.href, link.href)) setState((s) => ({ ...s, pending: true }));
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!state.pending) return;
    // shortcut: a redirect back to the same URL never changes `route`; stop the bar after 10 s.
    const timer = setTimeout(() => setState((s) => ({ ...s, pending: false })), GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [state.pending]);

  return <div className="ui-progress" data-pending={state.pending} aria-hidden="true" />;
}
