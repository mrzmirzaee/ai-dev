# ai-dev

A cross-platform CLI that bootstraps AI development tooling for any project — especially [Claude Code](https://www.anthropic.com/claude-code) projects. It wires up [Graphify](https://pypi.org/project/graphifyy/) (a codebase knowledge graph), prepares `CLAUDE.md` / ignore files, and surfaces recommended MCP tools, so you get a repeatable setup across every repository instead of configuring each one by hand.

## What it does

Running `ai-dev init` or the interactive `ai-dev wizard` in a project will:

- Detect the project root and project type (React, Vite, Next.js, NestJS, Node.js, Python, PHP/Laravel, or Unknown).
- Check for `uv`, and install or upgrade the `graphifyy` package (executable: `graphify`).
- Locate `graphify` even when it is installed outside your `PATH` (common on Windows).
- Detect Claude Code (`claude` / `claude.cmd`) and print install instructions if missing.
- Run `graphify claude install` to integrate Graphify with Claude Code.
- Create or update `CLAUDE.md`, `.claudeignore`, and `.gitignore` — **without overwriting your content** (managed blocks and lines are added only when missing).
- Optionally build the Graphify graph, handling the semantic-extraction fallback.
- Surface, verify, and install recommended MCP tools (Context7, Serena, Playwright MCP).

Everything is **idempotent**: run it as many times as you like.

## Installation

Run without installing:

```bash
npx ai-dev init
```

Or install globally:

```bash
npm install -g ai-dev
# or
pnpm add -g ai-dev
```

Then:

```bash
ai-dev init
```

### Requirements

- **Node.js** >= 18
- **uv** — required to install `graphifyy`. See the [uv install guide](https://docs.astral.sh/uv/getting-started/installation/).
- **Claude Code** (optional but recommended) — `ai-dev` prints install instructions if it is missing.

## Usage

```bash
ai-dev <command> [options]
```

## Commands

### `ai-dev init`

Bootstraps the current project.

Use `ai-dev init --wizard` or `ai-dev wizard` when you want an interactive first-run setup experience.

Flags:

| Flag | Description |
| --- | --- |
| `-y, --yes` | Non-interactive mode; accept defaults. |
| `--skip-graph` | Skip building the Graphify graph. |
| `--skip-mcp` | Skip MCP guidance and config. |
| `--force` | Continue even if the folder does not look like a project root. |
| `--wizard` | Run the interactive setup wizard first. |

### `ai-dev wizard`

Runs an interactive setup flow that detects the project type, writes `ai-dev.config.json`, lets you choose Graphify/Claude/MCP defaults, and can run `ai-dev init` immediately afterward.

```bash
ai-dev wizard
ai-dev init --wizard
```

### `ai-dev doctor`

Checks environment health and prints a status report grouped by severity (critical / important / optional). For Claude Code it distinguishes: not installed, installed, installed-but-not-authenticated, authenticated-and-ready, session-limited (with reset time when available), an incompatible binary, and the case where the npm package is present but the executable isn't on `PATH`.

```text
✔ Node.js (v22.x)
✔ uv
✔ graphifyy
✔ graphify command
✔ Claude Code CLI installed
! Claude Code session limit (session limit reached; resets 12:10am)
✔ CLAUDE.md
⚠ Graphify graph (not built)
⚠ Context7 MCP (not configured)
```

The final line is a summary state rather than a blanket "healthy":

- `Ready. All checks passed.`
- `Ready with warnings.` — only optional items (e.g. MCPs) missing.
- `Ready for setup, but Graphify graph is not built.` (recommends `ai-dev graph rebuild`)
- `Setup incomplete. Claude Code is not ready.`
- `Setup incomplete. Graphify is not ready.`

Exit codes: `0` when ready (possibly with warnings), `1` when Claude is installed but not usable, `2` when a critical dependency is missing.

`ai-dev doctor --fix` applies safe, idempotent project fixes by running the same file/setup path as `init` with graph build skipped. It is useful when `doctor` reports missing `CLAUDE.md`, `.gitignore`, `.claudeignore`, or Graphify integration.

### `ai-dev update`

Updates installed AI dev tools:

- `uv tool upgrade graphifyy`
- If Claude Code was installed via npm (`@anthropic-ai/claude-code`), runs `npm update -g @anthropic-ai/claude-code`.
- Prints the winget upgrade command for Windows installs.

### `ai-dev graph rebuild`

Rebuilds or refreshes the Graphify graph. It runs `graphify .`, and if that needs semantic extraction (e.g. `no LLM API key found`) it runs `graphify extract . --backend claude-cli`, then reports the *actual* outcome — it never prints a success message unless a `graph.json` was produced or a clear instruction file was written. Depending on what happened it will tell you to:

- open Claude Code and follow the generated `assistant-extract-instructions.md`, then re-run with `--semantic` (see below);
- run `claude` / `claude login` (Claude installed but not authenticated);
- wait for the session reset (Claude authenticated but session-limited);
- reinstall via winget (incompatible binary); or
- set an API key or ignore assets (no provider available).

Graph location is detected tolerantly across Graphify versions (`.graphify/graph.json` or `graphify-out/graph.json`). Full Graphify output is always saved to `.ai-dev-setup.log`; the console shows a concise excerpt.

**`ai-dev graph rebuild --semantic <path>`** builds from a pre-computed semantic extraction file: it verifies the file exists, runs `graphify extract . --semantic <path>`, and confirms a `graph.json` was produced. Windows paths are supported.

```bash
ai-dev graph rebuild --semantic .graphify/.graphify_semantic.json
```

### `ai-dev graph ignore-assets`

Writes (idempotently, in a marked block) a `.graphifyignore` with code-only defaults — ignoring images, docs, and common build folders — so Graphify can build a code-only graph without semantic extraction. It also writes `.ai-dev/graph-ignore-assets-applied.json` so future `graph rebuild` runs know the user already tried this path. Whether Graphify honors `.graphifyignore` depends on your installed Graphify version; the command states this plainly. If Graphify still detects docs/images after the marker exists, `ai-dev` no longer recommends repeating `graph ignore-assets` and instead explains that this Graphify version may not support `.graphifyignore`.

### `ai-dev mcp list` / `doctor` / `install`

Lists, verifies, and installs recommended MCP tools:

- **Context7** — fresh official documentation for libraries/frameworks.
- **Serena** — symbol-aware code navigation.
- **Playwright MCP** — browser automation, UI testing, screenshots.

`ai-dev mcp install <tool>` runs the matching `claude mcp add ...` command for `context7`, `serena`, or `playwright`.

`ai-dev mcp doctor` checks the configured Claude Code MCP server list and reports which enabled tools are missing.

`ai-dev mcp guide` adds an MCP guidance block to `CLAUDE.md`.

## Configuration

`ai-dev` works with zero configuration. For per-project defaults, add an optional `ai-dev.config.json` (or `.ai-dev.json`) at the project root. It is discovered by walking up from the current directory and validated when present — an invalid file fails loudly rather than silently changing behavior.

Supported config files: `ai-dev.config.json` and `.ai-dev.json`. **YAML is not supported yet** (no `.ai-dev.yml`).

Precedence is always **CLI flag > config file > built-in default**, so config sets your defaults while flags still win for a one-off run.

```jsonc
{
  // Override project-type detection
  "projectType": "Next.js",
  // Defaults for `ai-dev init`
  "skipGraph": false,
  "skipMcp": false,
  // Backend used by `graphify extract` during `graph rebuild`
  "graph": { "backend": "claude-cli" },
  // Claude Code behavior
  "claude": {
    "updateClaudeMd": true,  // when false, `init` leaves CLAUDE.md untouched
    "requireAuth": true      // when false, Claude auth/session issues are warnings, not blockers
  },
  // Which MCP tools to recommend (omit or set true to keep; false to hide)
  "mcp": { "context7": true, "serena": true, "playwright": true }
}
```

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `projectType` | enum | auto-detected | Overrides detection in `init`/`doctor`. `--project-type` overrides this. |
| `skipGraph` | boolean | `false` | Default for `init`. `--skip-graph` overrides. |
| `skipMcp` | boolean | `false` | Default for `init`. `--skip-mcp` overrides. |
| `graph.backend` | string | `"claude-cli"` | Backend for `graphify extract`. `--backend` overrides. |
| `claude.updateClaudeMd` | boolean | `true` | When `false`, `init` skips creating/updating `CLAUDE.md` and its MCP block (still writes `.gitignore`/`.claudeignore`). |
| `claude.requireAuth` | boolean | `true` | When `false`, Claude auth/session-limit problems are warnings and don't make `doctor` "Setup incomplete". |
| `mcp.{context7,serena,playwright}` | boolean | `true` | A tool set to `false` is dropped from recommendations and from `doctor`'s optional checks. |

Unknown keys are ignored with a warning (so future additions don't hard-fail an older CLI).

### Config commands

- `ai-dev config init` — write a starter `ai-dev.config.json` (with current defaults) at the project root. It never overwrites an existing `ai-dev.config.json` or `.ai-dev.json`.
- `ai-dev config show` — print the effective, normalized config and its source (`ai-dev.config.json`, `.ai-dev.json`, or `defaults`).

`ai-dev doctor` also reports the config as a row: `✔ ai-dev config (ai-dev.config.json)` when present, or `! ai-dev config (missing, using defaults)` when absent. An invalid config makes `doctor` fail with exit code 1.

## Examples

```bash
# Full setup
npx ai-dev init

# Interactive first-run wizard
ai-dev wizard

# CI-friendly, no graph build
ai-dev init --yes --skip-graph

# Bootstrap a folder that isn't a conventional project root
ai-dev init --force

# Check what's configured
ai-dev doctor

# Apply safe project setup fixes
ai-dev doctor --fix

# Install MCP servers
ai-dev mcp install context7
ai-dev mcp install playwright
ai-dev mcp doctor

# Refresh the graph after big changes
ai-dev graph rebuild
```

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success (for `doctor`: ready, possibly with warnings) |
| `1` | Setup failed / operation errored (for `doctor`: Claude installed but not usable) |
| `2` | Missing required dependency (e.g. `uv`, `graphifyy`, or Claude not installed) |

## Troubleshooting

### `graphify` is not recognized

`uv` installs tool executables into a directory that may not be on your `PATH` yet. `ai-dev` probes the common locations automatically, but if you invoke `graphify` yourself, add the relevant directory to `PATH`:

- Windows: `%USERPROFILE%\.local\bin`, `%APPDATA%\uv\bin`, or `%APPDATA%\uv\tools\graphifyy\Scripts`
- macOS/Linux: `~/.local/bin`

Then restart your terminal.

### PowerShell execution policy

If npm/global CLIs fail to run in PowerShell with a script-execution error, allow signed local scripts for your user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### Claude Code not found

Install it with one of:

```bash
winget install Anthropic.ClaudeCode --source winget   # Windows
npm install -g @anthropic-ai/claude-code               # any platform
```

### Graphify semantic extraction step

Some graphs require a semantic pass. When Graphify writes assistant instructions to `.graphify/scratch/assistant-extract-instructions.md`, `ai-dev graph rebuild` prints the exact next steps. Open Claude Code and run:

> Read `.graphify/scratch/assistant-extract-instructions.md` and follow its instructions exactly.

After Claude produces `.graphify/.graphify_semantic.json`, finish the build with:

```bash
ai-dev graph rebuild --semantic .graphify/.graphify_semantic.json
```

If Claude Code is not authenticated, run `claude` / `claude login` first; if it's session-limited, wait for the reset time shown and re-run `ai-dev graph rebuild`. For asset-heavy frontends where you only want a code graph, run `ai-dev graph ignore-assets` and rebuild. If rebuild still reports docs/images afterward, your Graphify version likely does not honor `.graphifyignore`; use Claude Code after reset, set a provider API key, or run Graphify on a code-only subdirectory manually if appropriate.

Full Graphify output for any failed run is saved to `.ai-dev-setup.log`.

## Windows notes

- `ai-dev` checks for both `claude` and `claude.cmd`.
- `graphify` is resolved from known `uv` install directories when it is not on `PATH`.
- Unicode status marks fall back to ASCII on terminals that cannot render them.

## Development

```bash
pnpm install
pnpm dev -- doctor          # run the CLI from source
pnpm test                   # run the test suite (vitest)
pnpm build                  # build to dist/ (ESM, with shebang)
pnpm lint                   # type-check
```

## License

MIT — see [LICENSE](./LICENSE).
