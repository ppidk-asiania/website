import { z } from "zod";

/** RFC 9457 Problem Details. Served as `application/problem+json`. */
export const ProblemDetailsSchema = z
  .object({
    type: z.string().default("about:blank"),
    title: z.string(),
    status: z.number().int().min(400).max(599),
    detail: z.string().optional(),
    instance: z.string().optional(),
    /** Correlates with server logs; safe to show to integrators. */
    requestId: z.string().optional(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .describe("Field-level validation errors"),
  })
  .meta({ id: "ProblemDetails" });
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/** Stable problem `type` URIs. Integrators may switch on these. */
export const ProblemTypes = {
  validation: "https://api.example.org/problems/validation",
  unauthorized: "https://api.example.org/problems/unauthorized",
  forbidden: "https://api.example.org/problems/forbidden",
  notFound: "https://api.example.org/problems/not-found",
  rateLimited: "https://api.example.org/problems/rate-limited",
  idempotencyKeyRequired: "https://api.example.org/problems/idempotency-key-required",
  internal: "https://api.example.org/problems/internal",
} as const;
