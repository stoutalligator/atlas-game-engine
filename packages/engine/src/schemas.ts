import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared low-level schemas
// ---------------------------------------------------------------------------

export const ChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

/**
 * Question schema for assumption_drift.
 * Enforces:
 *  - choices array length between 3 and 6 (per spec)
 *  - answer must match one of the choice ids
 */
export const AssumptionDriftQuestionSchema = z
  .object({
    id: z.string().min(1),
    scenario: z.string().min(1),
    drift: z.string().min(1),
    prompt: z.string().min(1),
    // TODO: enforce a strict enum if more choiceStyle values are defined in future packs
    choiceStyle: z.string(),
    choices: z
      .array(ChoiceSchema)
      .min(3, "choices must have at least 3 items")
      .max(6, "choices must have at most 6 items"),
    answer: z.string().min(1),
    solution: z.object({
      text: z.string().min(1),
    }),
  })
  .superRefine((q, ctx) => {
    const choiceIds = q.choices.map((c) => c.id);
    if (!choiceIds.includes(q.answer)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `answer "${q.answer}" must be one of the choice ids: [${choiceIds.join(", ")}]`,
        path: ["answer"],
      });
    }
  });

// ---------------------------------------------------------------------------
// Pack envelope — game-type-agnostic wrapper
// ---------------------------------------------------------------------------

export const GamePackMetaSchema = z.object({
  difficulty: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const AssumptionDriftPayloadSchema = z.object({
  instructions: z.string(),
  questions: z.array(AssumptionDriftQuestionSchema).min(1),
});

/**
 * Full AssumptionDrift pack schema.
 * Used by the engine to validate incoming JSON before play.
 */
export const AssumptionDriftPackSchema = z.object({
  schemaVersion: z.number().int().positive(),
  gameType: z.literal("assumption_drift"),
  gameId: z.string().min(1),
  packId: z.string().min(1),
  title: z.string().min(1),
  meta: GamePackMetaSchema,
  payload: AssumptionDriftPayloadSchema,
});

/**
 * Generic envelope — validate any supported pack.
 * Additional game types should be added to this discriminated union.
 *
 * Game-type registry: add new z.discriminatedUnion branches here as new
 * gameType values are introduced.
 */
export const GamePackSchema = z.discriminatedUnion("gameType", [
  AssumptionDriftPackSchema,
]);
