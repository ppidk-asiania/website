import type { FeaturedImage } from "@website/domain/content";
import {
  chapterRegion,
  type Chapter,
  type ChapterRegion,
  type ChapterRisk,
  type SocialLink,
} from "@website/domain/organizations";

export interface ChapterItem {
  id: string;
  version: number;
  name: string;
  slug: string;
  countryCode: string;
  region: ChapterRegion;
  country: string;
  timezone: string;
  utcOffset: string;
  active: boolean;
  logo: FeaturedImage | null;
  contactName: string;
  contactPublic: string;
  description: string;
  role: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  instagram: string | null;
  socials: SocialLink[];
  memberCount: number;
  conditions: string[];
  risk: ChapterRisk;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function utcOffset(timeZone: string): string {
  const name = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value;
  return name === "GMT" || !name ? "UTC+00:00" : name.replace("GMT", "UTC");
}

export function toChapterItem(c: Chapter): ChapterItem {
  return {
    id: c.id,
    version: c.version,
    name: c.name,
    slug: c.slug,
    countryCode: c.countryCode,
    region: chapterRegion(c.countryCode),
    country: regionNames.of(c.countryCode) ?? c.countryCode,
    timezone: c.timezone,
    utcOffset: utcOffset(c.timezone),
    active: c.active,
    logo: c.logo,
    contactName: c.contactName,
    contactPublic: c.contactPublic,
    description: c.description,
    role: c.role,
    phone: c.phone,
    website: c.website,
    email: c.email,
    instagram: c.instagram,
    socials: [...c.socials],
    memberCount: c.memberCount,
    conditions: [...c.conditions],
    risk: c.risk,
  };
}
