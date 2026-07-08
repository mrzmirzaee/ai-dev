import { describe, it, expect, vi } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import type { AiDevConfig } from "../src/types.js";

// Keep this test focused on provider artifact generation. initCommand normally
// performs best-effort dependency setup for uv/graphify; mock those checks so
// the test is deterministic and never invokes real package installs.
vi.mock("../src/core/graphify.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/graphify.js")>();
  return {
    ...actual,
    hasUv: vi.fn(async () => true),
    installOrUpdateGraphify: vi.fn(async () => true),
    isGraphifyAvailable: vi.fn(async () => true),
    runGraphifyClaudeInstall: vi.fn(async () => true),
    buildGraph: vi.fn(async () => ({ kind: "built", graphPath: "/x/graph.json" })),
  };
});

import { initCommand } from "../src/commands/init.js";
import { resolveInitOptions } from "../src/core/config.js";

describe("v2 provider artifacts", () => {
  it("creates AGENTS.md and opencode.jsonc for OpenCode without CLAUDE.md", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-dev-provider-"));
    try {
      await fs.writeJson(path.join(tmp, "package.json"), { name: "x" });
      const config: AiDevConfig = {
        skipGraph: true,
        ai: { providers: ["opencode", "codex"], primary: "opencode" },
        artifacts: { claudeMd: false, agentsMd: true, opencodeConfig: true },
        graph: { backend: "none" },
        claude: { updateClaudeMd: false, requireAuth: false },
      };

      const code = await initCommand(
        resolveInitOptions({ yes: true, skipGraph: true, force: true }, config),
        tmp,
        { config },
      );

      expect(code).toBe(0);
      expect(await fs.pathExists(path.join(tmp, "AGENTS.md"))).toBe(true);
      expect(await fs.pathExists(path.join(tmp, "opencode.jsonc"))).toBe(true);
      expect(await fs.pathExists(path.join(tmp, "CLAUDE.md"))).toBe(false);
    } finally {
      await fs.remove(tmp);
    }
  });
});
