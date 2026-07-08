import { commandExists, run } from "./command.js";
import type { AiProvider } from "../types.js";

export interface ProviderInfo {
  key: AiProvider;
  name: string;
  command?: string;
  artifactFiles: string[];
  installHint: string;
}

export interface ProviderStatus extends ProviderInfo {
  available: boolean;
  detail?: string;
}

export const AI_PROVIDERS: ProviderInfo[] = [
  {
    key: "claude",
    name: "Claude Code",
    command: "claude",
    artifactFiles: ["CLAUDE.md"],
    installHint: "Install Claude Code, then run `claude` to authenticate.",
  },
  {
    key: "opencode",
    name: "OpenCode",
    command: "opencode",
    artifactFiles: ["AGENTS.md", "opencode.jsonc"],
    installHint: "Install OpenCode from https://opencode.ai/docs/ and run `opencode`.",
  },
  {
    key: "codex",
    name: "Codex / AGENTS.md",
    artifactFiles: ["AGENTS.md"],
    installHint: "Use AGENTS.md with your Codex-compatible coding agent.",
  },
  {
    key: "cursor",
    name: "Cursor",
    artifactFiles: [".cursor/rules/ai-dev.mdc"],
    installHint: "Open the project in Cursor.",
  },
  {
    key: "copilot",
    name: "GitHub Copilot",
    artifactFiles: [".github/copilot-instructions.md"],
    installHint: "Use GitHub Copilot in VS Code or GitHub Codespaces.",
  },
  {
    key: "generic",
    name: "Generic AI Agent",
    artifactFiles: ["AGENTS.md"],
    installHint: "Use AGENTS.md as shared repository instructions for any coding agent.",
  },
];

export function providerInfo(key: AiProvider): ProviderInfo {
  return AI_PROVIDERS.find((p) => p.key === key) ?? AI_PROVIDERS[0];
}

export async function getProviderStatus(key: AiProvider): Promise<ProviderStatus> {
  const info = providerInfo(key);
  if (!info.command) return { ...info, available: true, detail: "artifact-based provider" };

  const exists = await commandExists(info.command);
  if (!exists) return { ...info, available: false, detail: `${info.command} not found on PATH` };

  if (key === "opencode") {
    const version = await run(info.command, ["--version"]);
    return { ...info, available: true, detail: version.ok ? version.stdout.trim() || "installed" : "installed" };
  }

  return { ...info, available: true, detail: "installed" };
}

export async function getProviderStatuses(keys: AiProvider[]): Promise<ProviderStatus[]> {
  return Promise.all(keys.map(getProviderStatus));
}
