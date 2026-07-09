import type { AiDevConfig, AiProvider } from "../types.js";

export type PresetName = "default" | "claude" | "opencode" | "frontend" | "backend" | "mobile" | "kmp" | "chabok";

export interface PresetDefinition {
  name: PresetName;
  description: string;
  config: AiDevConfig;
}

export const PRESETS: PresetDefinition[] = [
  {
    name: "default",
    description: "Default ai-dev behavior: Claude Code, Graphify, and recommended MCP guidance.",
    config: {},
  },
  {
    name: "claude",
    description: "Claude Code first setup with CLAUDE.md and recommended MCP tools.",
    config: {
      ai: { providers: ["claude"], primary: "claude" },
      artifacts: { claudeMd: true },
      graph: { backend: "claude-cli" },
      mcp: { context7: true, serena: true, playwright: true },
    },
  },
  {
    name: "opencode",
    description: "OpenCode setup with AGENTS.md and opencode.jsonc; graph build skipped by default.",
    config: {
      ai: { providers: ["opencode"], primary: "opencode" },
      artifacts: { agentsMd: true, opencodeConfig: true, claudeMd: false },
      claude: { updateClaudeMd: false, requireAuth: false },
      graph: { backend: "none" },
      skipGraph: true,
    },
  },
  {
    name: "frontend",
    description: "Frontend-focused setup for Next.js/React projects.",
    config: {
      ai: { providers: ["claude"], primary: "claude" },
      artifacts: { claudeMd: true },
      graph: { backend: "claude-cli" },
      mcp: { context7: true, serena: false, playwright: true },
    },
  },
  {
    name: "backend",
    description: "Backend-focused setup for Node/PHP/Python services.",
    config: {
      ai: { providers: ["claude"], primary: "claude" },
      artifacts: { claudeMd: true },
      graph: { backend: "claude-cli" },
      mcp: { context7: true, serena: true, playwright: false },
    },
  },
  {
    name: "mobile",
    description: "Mobile-focused setup for Android Kotlin projects.",
    config: {
      ai: { providers: ["claude"], primary: "claude" },
      artifacts: { claudeMd: true },
      graph: { backend: "claude-cli" },
      mcp: { context7: true, serena: true, playwright: false },
    },
  },
  {
    name: "kmp",
    description: "Kotlin Multiplatform setup with KMP source-set guidance.",
    config: {
      projectType: "Kotlin Multiplatform",
      ai: { providers: ["claude"], primary: "claude" },
      artifacts: { claudeMd: true },
      graph: { backend: "claude-cli" },
      mcp: { context7: true, serena: true, playwright: false },
    },
  },
  {
    name: "chabok",
    description: "Chabok team default: Claude Code, CLAUDE.md, Context7 + Playwright, code-first graph workflow.",
    config: {
      ai: { providers: ["claude"], primary: "claude" },
      artifacts: { claudeMd: true, agentsMd: false, opencodeConfig: false, cursorRules: false, copilotInstructions: false },
      claude: { updateClaudeMd: true, requireAuth: true },
      graph: { backend: "claude-cli" },
      mcp: { context7: true, serena: false, playwright: true },
    },
  },
];

export function getPreset(name?: string): PresetDefinition | null {
  if (!name) return null;
  return PRESETS.find((preset) => preset.name === name) ?? null;
}

export function providerToPreset(provider?: AiProvider): AiDevConfig {
  if (!provider) return {};
  const preset = getPreset(provider);
  if (preset) return preset.config;
  return { ai: { providers: [provider], primary: provider } };
}

export function mergeConfigs(base: AiDevConfig, override: AiDevConfig): AiDevConfig {
  return {
    ...base,
    ...override,
    ai: { ...base.ai, ...override.ai },
    artifacts: { ...base.artifacts, ...override.artifacts },
    graph: { ...base.graph, ...override.graph },
    claude: { ...base.claude, ...override.claude },
    mcp: { ...base.mcp, ...override.mcp },
  };
}
