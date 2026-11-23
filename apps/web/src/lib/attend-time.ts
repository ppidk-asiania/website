import type { Language } from "../i18n/dictionaries";

/** "20.10 WIB" (id) or "20:10 GMT+7" (en): the hour and the zone, in the reader's zone. */
export function formatAttendTime(iso: string, timeZone: string, language: Language): string {
  return new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}
