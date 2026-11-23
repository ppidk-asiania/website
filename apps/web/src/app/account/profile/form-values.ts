import type { MemberProfile } from "@website/domain/members";
import type { ProfileFormValues } from "./profile-form";

export const toFormValues = (p: MemberProfile | null): ProfileFormValues | null =>
  p && {
    fullName: p.fullName,
    gender: p.gender,
    dateOfBirth: p.dateOfBirth,
    ppiCountry: p.ppiCountry,
    university: p.university,
    universityId: p.universityId ?? null,
    educationLevel: p.educationLevel,
    majors: [...p.majors],
    yearOfEntry: p.yearOfEntry,
    estimatedGraduationYear: p.estimatedGraduationYear,
    addressAbroad: p.addressAbroad,
    addressIndonesia: p.addressIndonesia,
    whatsappNumber: p.whatsappNumber,
    emergencyContact: p.emergencyContact,
    timezone: p.timezone,
  };
