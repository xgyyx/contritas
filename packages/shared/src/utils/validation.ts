import { z } from "zod";
import { stripControlChars } from "./sanitize.js";

export const PROPOSITION_MIN = 10;
export const PROPOSITION_MAX = 2000;
export const USER_RESPONSE_MIN = 1;
export const USER_RESPONSE_MAX = 2000;
export const ITERATE_DETAILS_MAX = 1000;
export const ITERATE_TARGET_MAX = 200;

const propositionField = z
  .string()
  .transform(stripControlChars)
  .pipe(
    z
      .string()
      .min(PROPOSITION_MIN, `Research proposition must be at least ${PROPOSITION_MIN} characters`)
      .max(PROPOSITION_MAX, `Research proposition must not exceed ${PROPOSITION_MAX} characters`)
  );

const userResponseField = z
  .string()
  .transform(stripControlChars)
  .pipe(
    z
      .string()
      .min(USER_RESPONSE_MIN, "Response cannot be empty")
      .max(USER_RESPONSE_MAX, `Response must not exceed ${USER_RESPONSE_MAX} characters`)
  );

const iterateDetailsField = z
  .string()
  .transform(stripControlChars)
  .pipe(
    z
      .string()
      .max(ITERATE_DETAILS_MAX, `Details must not exceed ${ITERATE_DETAILS_MAX} characters`)
  );

const iterateTargetField = z
  .string()
  .transform(stripControlChars)
  .pipe(
    z
      .string()
      .max(ITERATE_TARGET_MAX, `Target must not exceed ${ITERATE_TARGET_MAX} characters`)
  );

export const createResearchSchema = z.object({
  proposition: propositionField,
  language: z.enum(["zh", "en"]).optional(),
  config: z
    .object({
      llmProvider: z.string().optional(),
      llmModel: z.string().optional(),
      searchProvider: z.string().optional(),
    })
    .optional(),
});

export const userRespondSchema = z.object({
  response: userResponseField,
});

export const sessionIdSchema = z.string().regex(
  /^[0-9A-HJKMNP-TV-Z]{26}$/,
  "Invalid session ID format (must be ULID)"
);

export const iterateResearchSchema = z.object({
  type: z.enum(["deep_dive", "add_dimension"]),
  target: iterateTargetField.optional(),
  details: iterateDetailsField.optional(),
});

export type CreateResearchInput = z.infer<typeof createResearchSchema>;
export type UserRespondInput = z.infer<typeof userRespondSchema>;
export type IterateResearchInput = z.infer<typeof iterateResearchSchema>;
