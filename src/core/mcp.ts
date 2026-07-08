/**
 * Recommended MCP (Model Context Protocol) servers.
 *
 * v1 does not auto-install these — it surfaces what they are and how they help
 * so the developer can add them deliberately.
 */
export interface McpTool {
  key: "context7" | "serena" | "playwright";
  name: string;
  purpose: string;
  install: string;
}

export const RECOMMENDED_MCP_TOOLS: McpTool[] = [
  {
    key: "context7",
    name: "Context7",
    purpose: "Fresh official documentation for libraries and frameworks.",
    install: "claude mcp add context7 -- npx -y @upstash/context7-mcp",
  },
  {
    key: "serena",
    name: "Serena",
    purpose: "Symbol-aware code navigation and editing.",
    install:
      "claude mcp add serena -- uvx --from git+https://github.com/oraios/serena serena start-mcp-server",
  },
  {
    key: "playwright",
    name: "Playwright MCP",
    purpose: "Browser automation, UI testing, and screenshots.",
    install: "claude mcp add playwright -- npx -y @playwright/mcp@latest",
  },
];
