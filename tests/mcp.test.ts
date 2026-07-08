import { describe, expect, it, vi } from "vitest";
import { parseConfiguredMcpServers } from "../src/core/mcp.js";

describe("parseConfiguredMcpServers", () => {
  it("parses real Claude MCP list output by server key", () => {
    const output = `claude.ai Figma: https://mcp.figma.com/mcp - ✔ Connected
context7: npx -y @upstash/context7-mcp - ✔ Connected
playwright: npx -y @playwright/mcp@latest - ✔ Connected`;

    const configured = parseConfiguredMcpServers(output);

    expect(configured.has("context7")).toBe(true);
    expect(configured.has("playwright")).toBe(true);
    expect(configured.has("serena")).toBe(false);
  });

  it("matches package names as a fallback", () => {
    const output = `docs: npx -y @upstash/context7-mcp - ✔ Connected
browser: npx -y @playwright/mcp@latest - ✔ Connected
code: uvx --from git+https://github.com/oraios/serena serena start-mcp-server - ✔ Connected`;

    const configured = parseConfiguredMcpServers(output);

    expect(configured.has("context7")).toBe(true);
    expect(configured.has("playwright")).toBe(true);
    expect(configured.has("serena")).toBe(true);
  });
});

describe("mcp install output", () => {
  it("does not duplicate MCP in Playwright install success labels", async () => {
    vi.resetModules();
    vi.doMock("../src/core/mcp.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/core/mcp.js")>();
      return {
        ...actual,
        installMcpTool: vi.fn(async () => ({ ok: true, stdout: "", stderr: "" })),
      };
    });

    const { mcpInstallCommand } = await import("../src/commands/mcp.js");
    const writes: string[] = [];
    const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });
    const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });

    try {
      const code = await mcpInstallCommand("playwright");
      expect(code).toBe(0);
      const output = writes.join("");
      expect(output).toContain("Playwright MCP installed");
      expect(output).not.toContain("MCP MCP installed");
    } finally {
      out.mockRestore();
      err.mockRestore();
      vi.doUnmock("../src/core/mcp.js");
    }
  });
});
