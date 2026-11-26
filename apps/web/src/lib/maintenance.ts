export const MAINTENANCE_RETRY_AFTER_SECONDS = 3600;

/** Printed QR codes (`/verify`), images (`/files`), uptime checks and sign-in keep working. */
export const isMaintenanceExempt = (path: string): boolean =>
  path === "/health" ||
  path === "/verify" ||
  path.startsWith("/verify/") ||
  path.startsWith("/files/") ||
  path === "/api/session" ||
  path.startsWith("/api/session/");

const PAGE = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>PPIDK Asia-Oseania</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:20vh auto;padding:0 1rem;line-height:1.5}</style></head>
<body><h1>Sedang dalam pemeliharaan</h1><p>Situs akan kembali sebentar lagi. Terima kasih atas kesabaran Anda.</p>
<h2>Down for maintenance</h2><p>We will be back shortly. Thank you for your patience.</p></body></html>`;

/** A static answer: no database, no cookies, no layout. */
export function maintenanceResponse(path: string): Response {
  const headers = {
    "Retry-After": String(MAINTENANCE_RETRY_AFTER_SECONDS),
    "Cache-Control": "no-store",
  };
  return path.startsWith("/api/")
    ? Response.json({ error: "maintenance" }, { status: 503, headers })
    : new Response(PAGE, {
        status: 503,
        headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
      });
}
