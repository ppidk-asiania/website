import { z } from "zod";

export const CreateRegistrationRequestSchema = z
  .object({
    eventId: z.string().min(1).max(64),
    fullName: z.string().trim().min(1).max(200),
    email: z.email().max(320),
    chapterId: z.string().max(64).optional(),
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
