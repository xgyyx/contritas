import type { ValidateInputResult } from "./types.js";

export function inputValid(_: unknown, params: { result: ValidateInputResult }): boolean {
  return params.result.valid;
}

export function needsClarification(_: unknown, params: { result: ValidateInputResult }): boolean {
  return (
    !params.result.valid &&
    (params.result.output.clarificationQuestions?.length ?? 0) > 0
  );
}
