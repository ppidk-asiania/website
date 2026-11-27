import type { MemberProfile } from "@website/domain/members";
import type { Dictionary, Language } from "@/i18n/dictionaries";
import { countryName } from "@/lib/country-names";

/** "Asia/Shanghai (UTC+8)" */
function zoneLabel(zone: string, now: Date): string {
  const offset = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value;
  return offset ? `${zone} (${offset.replace("GMT", "UTC")})` : zone;
}

/** The saved profile, read-only; "Edit Profile" opens the form. */
export function ProfileView(props: {
  t: Dictionary["profile"];
  language: Language;
  profile: MemberProfile;
  chapters: { countryCode: string; name: string }[];
  now: Date;
}) {
  const { t, profile: p, language } = props;
  const date = new Intl.DateTimeFormat(language, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const join = (parts: (string | undefined)[]) => parts.filter(Boolean).join(", ");
  const item = (label: string, value: string) => (
    <div key={label}>
      <dt>{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
  const abroad = p.addressAbroad;
  const home = p.addressIndonesia;
  const emergency = p.emergencyContact;
  return (
    <>
      <dl className="site-settings-grid" data-cols="3">
        {item(t.fullName, p.fullName)}
        {item(t.gender, t.genders[p.gender])}
        {item(t.dateOfBirth, date.format(new Date(`${p.dateOfBirth}T00:00:00Z`)))}
        {item(
          t.ppiCountry,
          props.chapters.find((c) => c.countryCode === p.ppiCountry)?.name ??
            countryName(p.ppiCountry, language),
        )}
        {item(t.university, p.university)}
        {item(t.educationLevel, t.levels[p.educationLevel])}
        {item(t.majors, p.majors.join(", "))}
        {item(t.yearOfEntry, String(p.yearOfEntry))}
        {item(t.graduationYear, String(p.estimatedGraduationYear))}
      </dl>
      <hr className="site-settings-rule" />
      <dl className="site-settings-grid" data-cols="2">
        {item(
          t.abroad,
          join([
            abroad.line1,
            abroad.line2,
            abroad.city,
            abroad.stateOrProvince,
            abroad.postalCode,
            countryName(abroad.countryCode, language),
          ]),
        )}
        {item(
          t.indonesia,
          join([home.line1, home.line2, home.city, home.province, home.postalCode]),
        )}
        {item(
          t.whatsapp,
          `${p.whatsappNumber} · ${p.whatsappVerifiedAt ? t.whatsappVerified : t.whatsappNotVerified}`,
        )}
        {item(
          t.emergencyPhone,
          [emergency.phone, join([emergency.name, emergency.relationship])]
            .filter(Boolean)
            .join(" · "),
        )}
        {item(t.timezone, zoneLabel(p.timezone, props.now))}
      </dl>
    </>
  );
}
