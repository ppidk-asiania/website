import "server-only";
import { z } from "zod";
import type { AiFeature, AiUsageRow } from "@website/domain/ai";
import {
  DraftOutputSchema,
  type DraftRequest,
  type MinutesDrafter,
} from "@website/domain/meetings";

const DRAFT_TOOL = {
  name: "minutes_draft",
  description: "Meeting minutes drafted from a transcript.",
  input_schema: z.toJSONSchema(DraftOutputSchema),
};

const SYSTEM =
  "You draft meeting minutes for an Indonesian student association. Write in the language of " +
  "the transcript, factual and short, in the third person. Use ONLY what the transcript says: " +
  "no invented decisions, names or numbers. For each agenda item give the discussion and the " +
  "decisions; leave an item out when the transcript does not cover it. Action items: only " +
  "explicit follow-ups; picUid must be one of the participant ids given, or null; dueOn only " +
  "when a date is said (YYYY-MM-DD), else null.";

const ModelAnswer = z.object({
  usage: z
    .object({
      input_tokens: z.number().default(0),
      output_tokens: z.number().default(0),
      cache_creation_input_tokens: z.number().nullish(),
      cache_read_input_tokens: z.number().nullish(),
    })
    .optional(),
  content: z.array(
    z.object({ type: z.string(), name: z.string().optional(), input: z.unknown().optional() }),
  ),
});
type ModelAnswer = z.infer<typeof ModelAnswer>;

export interface ModelRequest {
  readonly max_tokens: number;
  readonly system: string;
  readonly tools: readonly unknown[];
  readonly tool_choice: unknown;
  readonly messages: readonly unknown[];
}
export type CallModel = (
  feature: AiFeature,
  uid: string,
  request: ModelRequest,
) => Promise<ModelAnswer>;

/**
 * The one place that talks to Anthropic: picks the model for the feature and writes the usage row
 * (token counts only) as soon as the answer arrives, before the caller validates it.
 */
export function createCallModel(config: {
  apiKey: string;
  fetchImpl: typeof fetch;
  modelFor: (feature: AiFeature) => Promise<string>;
  recordUsage: (row: AiUsageRow) => Promise<void>;
  now: () => Date;
}): CallModel {
  return async (feature, uid, request) => {
    const model = await config.modelFor(feature);
    const response = await config.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, ...request }),
    });
    if (!response.ok) throw new Error(`anthropic_${response.status}`);
    const parsed = ModelAnswer.safeParse(await response.json());
    const answer: ModelAnswer = parsed.success ? parsed.data : { content: [] };
    await config.recordUsage({
      feature,
      model,
      uid,
      at: config.now(),
      input: answer.usage?.input_tokens ?? 0,
      output: answer.usage?.output_tokens ?? 0,
      cacheWrite: answer.usage?.cache_creation_input_tokens ?? 0,
      cacheRead: answer.usage?.cache_read_input_tokens ?? 0,
    });
    return answer;
  };
}

export function createAnthropicDrafter(callModel: CallModel): MinutesDrafter {
  return {
    async draft(request: DraftRequest) {
      const answer = await callModel("minutes", request.uid, {
        max_tokens: 8000,
        system: SYSTEM,
        tools: [DRAFT_TOOL],
        tool_choice: { type: "tool", name: DRAFT_TOOL.name },
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              meeting: request.title,
              agenda: request.agenda,
              participants: request.participants,
              transcript: request.transcript,
            }),
          },
        ],
      });
      const call = answer.content.find((c) => c.type === "tool_use" && c.name === DRAFT_TOOL.name);
      const draft = DraftOutputSchema.safeParse(call?.input);
      if (!draft.success) throw new Error("anthropic_invalid_answer");
      return draft.data;
    },
  };
}
