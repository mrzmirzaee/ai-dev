import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import {
  loadConfig,
  findConfigFile,
  ConfigError,
  resolveInitOptions,
  resolveBackend,
  resolveProjectType,
  resolveMcpEnabled,
  enabledMcpTools,
  CONFIG_DEFAULTS,
} from "../src/core/config.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-dev-config-"));
});
afterEach(async () => {
  await fs.remove(tmp);
});

describe("findConfigFile", () => {
  it("finds ai-dev.config.json in the current dir", async () => {
    await fs.writeJson(path.join(tmp, "ai-dev.config.json"), {});
    expect(findConfigFile(tmp)).toBe(path.join(tmp, "ai-dev.config.json"));
  });

  it("finds the dotfile variant", async () => {
    await fs.writeJson(path.join(tmp, ".ai-dev.json"), {});
    expect(findConfigFile(tmp)).toBe(path.join(tmp, ".ai-dev.json"));
  });

  it("walks up to a parent dir", async () => {
    await fs.writeJson(path.join(tmp, "ai-dev.config.json"), {});
    const sub = path.join(tmp, "a", "b");
    await fs.ensureDir(sub);
    expect(findConfigFile(sub)).toBe(path.join(tmp, "ai-dev.config.json"));
  });

  it("stops at a project-root marker (does not leak from a parent repo)", async () => {
    await fs.writeJson(path.join(tmp, "ai-dev.config.json"), {});
    const child = path.join(tmp, "child");
    await fs.ensureDir(child);
    await fs.writeJson(path.join(child, "package.json"), { name: "c" });
    // Searching from child stops at child's package.json before reaching tmp.
    expect(findConfigFile(child)).toBeNull();
  });

  it("returns null when no config exists", async () => {
    expect(findConfigFile(tmp)).toBeNull();
  });
});

describe("loadConfig", () => {
  it("returns empty config when no file is present", async () => {
    const { config, filePath } = await loadConfig(tmp);
    expect(config).toEqual({});
    expect(filePath).toBeNull();
  });

  it("parses a valid config", async () => {
    await fs.writeJson(path.join(tmp, "ai-dev.config.json"), {
      skipGraph: true,
      graph: { backend: "gemini" },
      mcp: { serena: false },
    });
    const { config } = await loadConfig(tmp);
    expect(config.skipGraph).toBe(true);
    expect(config.graph?.backend).toBe("gemini");
    expect(config.mcp?.serena).toBe(false);
  });

  it("throws ConfigError on malformed JSON", async () => {
    await fs.writeFile(path.join(tmp, "ai-dev.config.json"), "{ not json ");
    await expect(loadConfig(tmp)).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError on a schema violation (wrong type)", async () => {
    await fs.writeJson(path.join(tmp, "ai-dev.config.json"), {
      skipGraph: "yes",
    });
    await expect(loadConfig(tmp)).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError on an invalid projectType enum value", async () => {
    await fs.writeJson(path.join(tmp, "ai-dev.config.json"), {
      projectType: "Rails",
    });
    await expect(loadConfig(tmp)).rejects.toBeInstanceOf(ConfigError);
  });

  it("warns (but does not fail) on unrecognized keys", async () => {
    await fs.writeJson(path.join(tmp, "ai-dev.config.json"), {
      skipGraph: true,
      bogusKey: 1,
    });
    const { config, warnings } = await loadConfig(tmp);
    expect(config.skipGraph).toBe(true);
    expect(warnings.some((w) => w.includes("bogusKey"))).toBe(true);
  });
});

describe("resolveInitOptions (flag > config > default)", () => {
  it("uses defaults when nothing is set", () => {
    const o = resolveInitOptions({}, {});
    expect(o.skipGraph).toBe(CONFIG_DEFAULTS.skipGraph);
    expect(o.skipMcp).toBe(CONFIG_DEFAULTS.skipMcp);
  });

  it("config overrides defaults", () => {
    const o = resolveInitOptions({}, { skipGraph: true });
    expect(o.skipGraph).toBe(true);
  });

  it("flag overrides config", () => {
    const o = resolveInitOptions({ skipGraph: false }, { skipGraph: true });
    expect(o.skipGraph).toBe(false);
  });

  it("an explicit true flag wins over config false", () => {
    const o = resolveInitOptions({ skipMcp: true }, { skipMcp: false });
    expect(o.skipMcp).toBe(true);
  });
});

describe("resolveBackend (flag > config > default)", () => {
  it("defaults to claude-cli", () => {
    expect(resolveBackend(undefined, {})).toBe("claude-cli");
  });
  it("config overrides default", () => {
    expect(resolveBackend(undefined, { graph: { backend: "openai" } })).toBe(
      "openai",
    );
  });
  it("flag overrides config", () => {
    expect(resolveBackend("gemini", { graph: { backend: "openai" } })).toBe(
      "gemini",
    );
  });
});

describe("resolveProjectType (flag > config > detected)", () => {
  it("falls back to detected", () => {
    expect(resolveProjectType("Vite", {})).toBe("Vite");
  });
  it("config overrides detected", () => {
    expect(resolveProjectType("Vite", { projectType: "Next.js" })).toBe(
      "Next.js",
    );
  });
  it("flag overrides config and detected", () => {
    expect(
      resolveProjectType("Vite", { projectType: "Next.js" }, "Node.js"),
    ).toBe("Node.js");
  });
});

describe("MCP toggles", () => {
  it("all enabled by default", () => {
    expect(resolveMcpEnabled({})).toEqual({
      context7: true,
      serena: true,
      playwright: true,
    });
    expect(enabledMcpTools({})).toHaveLength(3);
  });

  it("disabling one filters it out", () => {
    const tools = enabledMcpTools({ mcp: { serena: false } });
    expect(tools.map((t) => t.key)).toEqual(["context7", "playwright"]);
  });

  it("disabling all yields an empty list", () => {
    const tools = enabledMcpTools({
      mcp: { context7: false, serena: false, playwright: false },
    });
    expect(tools).toHaveLength(0);
  });
});
