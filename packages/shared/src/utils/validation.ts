import { z } from "zod";

export const createResearchSchema = z.object({
  proposition: z.string().min(10, "Research proposition must be at least 10 characters"),
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
  response: z.string().min(1, "Response cannot be empty"),
});

export const sessionIdSchema = z.string().regex(
  /^[0-9A-HJKMNP-TV-Z]{26}$/,
  "Invalid session ID format (must be ULID)"
);

export const iterateResearchSchema = z.object({
  type: z.enum(["deep_dive", "add_dimension"]),
  target: z.string().optional(),
  details: z.string().optional(),
});

export type CreateResearchInput = z.infer<typeof createResearchSchema>;
export type UserRespondInput = z.infer<typeof userRespondSchema>;
export type IterateResearchInput = z.infer<typeof iterateResearchSchema>;
