import { z } from "zod";
import { CursorQuerySchema, pageOf } from "../pagination";

/**
 * Public event DTO. Explicit fields only — internal fields (audit metadata,
 * capacity internals, draft state, author IDs) must never appear here.
 */
export const EventDtoSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable(),
    timezone: z.string(),
    location: z.string().nullable(),
    chapterId: z.string().nullable(),
    registrationOpen: z.boolean(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Event" });
export type EventDto = z.infer<typeof EventDtoSchema>;

export const ListEventsQuerySchema = CursorQuerySchema.extend({
  chapterId: z.string().max(64).optional(),
  /** For polling integrations: only events changed after this instant. */
  updatedSince: z.iso.datetime().optional(),
});
export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;

export const EventPageSchema = pageOf(EventDtoSchema).meta({ id: "EventPage" });
export type EventPage = z.infer<typeof EventPageSchema>;
