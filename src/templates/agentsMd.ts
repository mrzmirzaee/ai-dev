export const AI_DEV_AGENTS_START = "<!-- AI_DEV_AGENTS_START -->";
export const AI_DEV_AGENTS_END = "<!-- AI_DEV_AGENTS_END -->";

export const AGENTS_MD_HEADER = `# AGENTS.md

This file provides shared guidance for AI coding agents working in this repository.
`;

export const AGENTS_MD_BLOCK = `${AI_DEV_AGENTS_START}
## AI Development Guidance

### Project Context
- Treat this repository as the source of truth. Prefer existing patterns over introducing new conventions.
- Before large edits, identify the relevant files, modules, routes, and dependencies.
- Keep changes focused, reviewable, and consistent with the current stack.

### Code Navigation
- Use Graphify when available for architecture, dependency, refactor, and impact-analysis questions.
- Read raw source files before making edits, debugging runtime behavior, or changing public APIs.
- Avoid using generated folders, build output, public assets, media, or dependency folders as source context.

### Implementation Style
- Prefer small, typed, maintainable changes.
- Preserve existing formatting, naming, and folder conventions.
- Do not rewrite unrelated files.
- Call out assumptions when requirements are unclear.

### Verification
- Run the most relevant tests, type checks, linters, or build commands before considering work complete.
- If a verification command cannot run, explain what failed and what remains unverified.
${AI_DEV_AGENTS_END}`;
