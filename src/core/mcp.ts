import { run } from "./command.js";

/**
 * Recommended MCP (Model Context Protocol) servers.
 */
export interface McpTool {
  key: "context7" | "serena" | "playwright";
  name: string;
  purpose: string;
  command: string;
  args: string[];
  install: string;
}

export const RECOMMENDED_MCP_TOOLS: McpTool[] = [
  {
    key: "context7",
    name: "Context7",
    purpose: "Fresh official documentation for libraries and frameworks.",
    command: "claude",
    args: ["mcp", "add", "context7", "--", "npx", "-y", "@upstash/context7-mcp"],
    install: "claude mcp add context7 -- npx -y @upstash/context7-mcp",
  },
  {
    key: "serena",
    name: "Serena",
    purpose: "Symbol-aware code navigation and editing.",
    command: "claude",
    args: [
      "mcp",
      "add",
      "serena",
      "--",
      "uvx",
      "--from",
      "git+https://github.com/oraios/serena",
      "serena",
      "start-mcp-server",
    ],
    install:
      "claude mcp add serena -- uvx --from git+https://github.com/oraios/serena serena start-mcp-server",
  },
  {
    key: "playwright",
    name: "Playwright MCP",
    purpose: "Browser automation, UI testing, and screenshots.",
    command: "claude",
    args: ["mcp", "add", "playwright", "--", "npx", "-y", "@playwright/mcp@latest"],
    install: "claude mcp add playwright -- npx -y @playwright/mcp@latest",
  },
];

export type McpKey = McpTool["key"];

export function getMcpTool(key: string): McpTool | undefined {
  return RECOMMENDED_MCP_TOOLS.find((tool) => tool.key === key);
}

export async function listConfiguredMcpServers(): Promise<{
  ok: boolean;
  configured: Set<string>;
  stdout: string;
  stderr: string;
}> {
  const res = await run("claude", ["mcp", "list"]);
  const output = `${res.stdout}\n${res.stderr}`;
  const configured = new Set<string>();
  for (const tool of RECOMMENDED_MCP_TOOLS) {
    const pattern = new RegExp(`(^|\\s|[-_*])${tool.key}($|\\s|[-_*])`, "i");
    if (pattern.test(output) || output.toLowerCase().includes(tool.name.toLowerCase())) {
      configured.add(tool.key);
    }
  }
  return { ok: res.ok, configured, stdout: res.stdout, stderr: res.stderr };
}

export async function isMcpToolConfigured(key: McpKey): Promise<boolean> {
  const list = await listConfiguredMcpServers();
  return list.configured.has(key);
}

export async function installMcpTool(tool: McpTool): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
}> {
  const res = await run(tool.command, tool.args);
  return { ok: res.ok, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
}
