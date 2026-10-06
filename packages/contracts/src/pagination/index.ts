import { z } from "zod";

/** Opaque cursor pagination. Offsets are not offered (unstable under concurrent writes). */
export const CursorQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CursorQuery = z.infer<typeof CursorQuerySchema>;

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
