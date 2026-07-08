/**
 * Line sets appended (idempotently) to ignore files.
 *
 * Lines are added only when missing, so existing user entries and ordering
 * are preserved.
 */

/** Entries common to both .gitignore and .claudeignore. */
export const COMMON_IGNORE_LINES: string[] = [
  ".graphify/",
  "graphify-out/",
  "graph.json",
  ".ai-dev-setup.log",
];

/** Additional entries that only belong in .claudeignore. */
export const CLAUDEIGNORE_EXTRA_LINES: string[] = [
  "node_modules/",
  "dist/",
  "build/",
  ".next/",
  ".vite/",
  "coverage/",
  "pnpm-lock.yaml",
];

/** Full set of lines expected in .gitignore. */
export const GITIGNORE_LINES: string[] = [...COMMON_IGNORE_LINES];

/** Full set of lines expected in .claudeignore. */
export const CLAUDEIGNORE_LINES: string[] = [
  ...COMMON_IGNORE_LINES,
  ...CLAUDEIGNORE_EXTRA_LINES,
];

/** Header comment used when we add a managed group of ignore lines. */
export const IGNORE_SECTION_HEADER = "# Added by ai-dev";

/** Markers for the managed block inside .graphifyignore. */
export const GRAPHIFY_IGNORE_START = "# AI_DEV_GRAPHIFY_IGNORE_START";
export const GRAPHIFY_IGNORE_END = "# AI_DEV_GRAPHIFY_IGNORE_END";

/**
 * Code-only graph defaults for `.graphifyignore`. Excludes assets and docs
 * that would otherwise require semantic extraction, letting Graphify build a
 * code-only graph without an LLM provider.
 */
export const GRAPHIFY_IGNORE_LINES: string[] = [
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.webp",
  "*.gif",
  "*.svg",
  "*.ico",
  "*.pdf",
  "*.md",
  "*.txt",
  "public/",
  "assets/",
  "node_modules/",
  ".next/",
  "dist/",
  "build/",
  "coverage/",
];

/** The marker-wrapped `.graphifyignore` block. */
export const GRAPHIFY_IGNORE_BLOCK = `${GRAPHIFY_IGNORE_START}
# AI Dev / Graphify code-only graph defaults
${GRAPHIFY_IGNORE_LINES.join("\n")}
${GRAPHIFY_IGNORE_END}`;
