import { logger } from "../core/logger.js";
import { ExitCode, type ExitCodeValue } from "../types.js";

const PROMPTS: Record<string, string> = {
  default: "Read CLAUDE.md first and follow it. Inspect the relevant project context before editing. Use minimal, safe changes. Run the verification commands listed in CLAUDE.md after changes when practical.",
  bugfix: "Read CLAUDE.md first. Reproduce or inspect the issue, identify the smallest safe fix, avoid unrelated refactors, then run the most relevant verification command.",
  feature: "Read CLAUDE.md first. Identify the affected modules/routes/components, implement the feature with minimal safe changes, preserve existing patterns, and run relevant verification commands.",
  refactor: "Read CLAUDE.md first. Map related files before editing, keep behavior unchanged, avoid broad rewrites, and verify with tests/type checks/build after the refactor.",
  review: "Read CLAUDE.md first. Review the changed files for correctness, regressions, architecture fit, security, and missing verification. Do not make changes unless explicitly asked.",
};

export async function promptCommand(kind = "default"): Promise<ExitCodeValue> {
  const prompt = PROMPTS[kind] ?? PROMPTS.default;
  logger.heading(`ai-dev prompt${kind === "default" ? "" : ` ${kind}`}`);
  logger.raw(prompt);
  return ExitCode.Success;
}
