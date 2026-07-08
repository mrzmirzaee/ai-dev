/**
 * Templated, marker-wrapped blocks written into CLAUDE.md.
 *
 * Blocks are wrapped in HTML comment markers so they can be detected and
 * (re)written idempotently without disturbing surrounding user content.
 */

export const AI_DEV_SETUP_START = "<!-- AI_DEV_SETUP_START -->";
export const AI_DEV_SETUP_END = "<!-- AI_DEV_SETUP_END -->";

export const AI_DEV_MCP_START = "<!-- AI_DEV_MCP_START -->";
export const AI_DEV_MCP_END = "<!-- AI_DEV_MCP_END -->";

/**
 * Core Graphify + response-style guidance block for CLAUDE.md.
 */
export const CLAUDE_MD_SETUP_BLOCK = `${AI_DEV_SETUP_START}
## AI Development Setup

### Graphify Usage
For codebase, architecture, dependency, refactor, and impact-analysis questions:
1. Query the existing Graphify knowledge graph before reading raw source files.
2. Use targeted graph traversal first, then inspect only the relevant files.
3. Read raw source files when modifying, debugging, or when the graph does not provide enough detail.
4. If the working tree changed significantly, refresh the graph before relying on it.

### Response Style
- Prefer concise, implementation-focused answers.
- Mention which files/components are relevant before editing.
- Avoid broad rewrites unless explicitly requested.
${AI_DEV_SETUP_END}`;

/**
 * Optional MCP guidance block for CLAUDE.md.
 */
export const CLAUDE_MD_MCP_BLOCK = `${AI_DEV_MCP_START}
## MCP Tools

Recommended Model Context Protocol servers for this project:

- **Context7** — fresh, official documentation for libraries and frameworks.
- **Serena** — symbol-aware code navigation and editing.
- **Playwright MCP** — browser automation, UI testing, and screenshots.

Prefer these tools over guessing APIs or manually browsing docs. Run
\`ai-dev mcp list\` for details and setup guidance.
${AI_DEV_MCP_END}`;

/**
 * The initial file body when CLAUDE.md does not yet exist. The setup block is
 * appended separately so the same idempotent logic handles new and existing
 * files.
 */
export const CLAUDE_MD_HEADER = `# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.
`;
