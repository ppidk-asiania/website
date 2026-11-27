/** True when following `href` from the page at `current` loads another page of the same site. */
export function isPageChange(current: string, href: string): boolean {
  const from = new URL(current);
  const to = new URL(href, from);
  return to.origin === from.origin && to.pathname + to.search !== from.pathname + from.search;
}
