import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import {
  configInitCommand,
  configShowCommand,
} from "../src/commands/config.js";
import { ExitCode } from "../src/types.js";

let tmp: string;
let output: string[];
const spies: Array<{ mockRestore: () => void }> = [];

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-dev-cfgcmd-"));
  await fs.writeJson(path.join(tmp, "package.json"), { name: "c" });
  output = [];
  const capture = ((chunk: unknown): boolean => {
    output.push(String(chunk));
    return true;
  }) as never;
  spies.push(vi.spyOn(process.stdout, "write").mockImplementation(capture));
  spies.push(vi.spyOn(process.stderr, "write").mockImplementation(capture));
});

afterEach(async () => {
  for (const s of spies.splice(0)) s.mockRestore();
  await fs.remove(tmp);
});

const printed = () => output.join("");

describe("config init", () => {
  it("creates ai-dev.config.json with valid default JSON", async () => {
    const code = await configInitCommand(tmp);
    expect(code).toBe(ExitCode.Success);
    const file = path.join(tmp, "ai-dev.config.json");
    expect(await fs.pathExists(file)).toBe(true);
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    expect(parsed).toMatchObject({
      skipGraph: false,
      skipMcp: false,
      graph: { backend: "claude-cli" },
      claude: { updateClaudeMd: true, requireAuth: true },
      mcp: { context7: true, serena: true, playwright: true },
    });
    expect(printed()).toContain("Created ai-dev.config.json");
  });

  it("does not overwrite an existing ai-dev.config.json", async () => {
    const file = path.join(tmp, "ai-dev.config.json");
    await fs.writeJson(file, { skipGraph: true });
    const code = await configInitCommand(tmp);
    expect(code).toBe(ExitCode.Success);
    // Original content preserved.
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({
      skipGraph: true,
    });
    expect(printed()).toContain("Config already exists");
  });

  it("does not overwrite when the dotfile variant exists", async () => {
    await fs.writeJson(path.join(tmp, ".ai-dev.json"), { skipMcp: true });
    const code = await configInitCommand(tmp);
    expect(code).toBe(ExitCode.Success);
    expect(await fs.pathExists(path.join(tmp, "ai-dev.config.json"))).toBe(false);
    expect(printed()).toContain(".ai-dev.json");
  });
});

describe("config show", () => {
  it("prints defaults and 'Source: defaults' when no config exists", async () => {
    const code = await configShowCommand(tmp);
    expect(code).toBe(ExitCode.Success);
    const out = printed();
    expect(out).toContain("No config file found. Using defaults.");
    expect(out).toContain("Source: defaults");
    expect(out).toContain('"backend": "claude-cli"');
  });

  it("prints the loaded config and its source file name", async () => {
    await fs.writeJson(path.join(tmp, "ai-dev.config.json"), {
      skipGraph: true,
      mcp: { serena: false },
    });
    const code = await configShowCommand(tmp);
    expect(code).toBe(ExitCode.Success);
    const out = printed();
    expect(out).toContain("Source: ai-dev.config.json");
    expect(out).toContain('"skipGraph": true');
    // normalized: serena false is reflected
    expect(out).toContain('"serena": false');
  });

  it("fails clearly on an invalid config", async () => {
    await fs.writeFile(path.join(tmp, "ai-dev.config.json"), "{ not json");
    const code = await configShowCommand(tmp);
    expect(code).toBe(ExitCode.SetupFailed);
  });
});
