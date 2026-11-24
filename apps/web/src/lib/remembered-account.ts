// The last signed-in account, kept in this browser so the header can show it while the server
// checks the session. The server's answer always wins: a signed-out answer forgets it.
const KEY = "site-account";

export interface RememberedAccount {
  name: string;
  initials: string;
  picture: string | null;
}

export function parseAccount(raw: string | null): RememberedAccount | null {
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { name, initials, picture } = value as Record<string, unknown>;
    if (typeof name !== "string" || typeof initials !== "string") return null;
    const safePicture = typeof picture === "string" && picture.startsWith("https://");
    return { name, initials, picture: safePicture ? picture : null };
  } catch {
    return null;
  }
}

export function readAccount(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberAccount(account: RememberedAccount | null): void {
  try {
    if (account) localStorage.setItem(KEY, JSON.stringify(account));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode or blocked storage: the header just waits for the server.
  }
}
