import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";

export const CreateRegistrationRequestSchema = z
  .object({
    eventId: safeId,
    fullName: safeText(200),
    email: z.email().max(320),
    chapterId: safeId.optional(),
  })
  .strict()
  .meta({ id: "CreateRegistrationRequest" });
export type CreateRegistrationRequest = z.infer<typeof CreateRegistrationRequestSchema>;

export const RegistrationDtoSchema = z
  .object({
    id: z.string(),
    eventId: z.string(),
    status: z.enum(["pending_confirmation", "confirmed", "waitlisted", "cancelled"]),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "Registration" });
export type RegistrationDto = z.infer<typeof RegistrationDtoSchema>;
