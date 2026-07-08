import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import {
  ensureBlock,
  ensureIgnoreLines,
  fileContainsMarker,
  ignoreFileContainsAll,
} from "../src/core/files.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-dev-files-"));
});

afterEach(async () => {
  await fs.remove(tmp);
});

const START = "<!-- BLOCK_START -->";
const BLOCK = `${START}\nhello world\n<!-- BLOCK_END -->`;

describe("ensureBlock", () => {
  it("creates a new file with header + block", async () => {
    const file = path.join(tmp, "CLAUDE.md");
    const change = await ensureBlock(file, START, BLOCK, "# Header");
    expect(change).toBe("created");
    const content = await fs.readFile(file, "utf8");
    expect(content).toContain("# Header");
    expect(content).toContain("hello world");
  });

  it("appends the block to an existing file without the marker", async () => {
    const file = path.join(tmp, "CLAUDE.md");
    await fs.writeFile(file, "# Existing user content\n");
    const change = await ensureBlock(file, START, BLOCK);
    expect(change).toBe("updated");
    const content = await fs.readFile(file, "utf8");
    expect(content).toContain("# Existing user content");
    expect(content).toContain(START);
  });

  it("is idempotent when the marker is already present", async () => {
    const file = path.join(tmp, "CLAUDE.md");
    await ensureBlock(file, START, BLOCK, "# Header");
    const change = await ensureBlock(file, START, BLOCK, "# Header");
    expect(change).toBe("unchanged");
    const content = await fs.readFile(file, "utf8");
    // Marker must appear exactly once.
    const occurrences = content.split(START).length - 1;
    expect(occurrences).toBe(1);
  });

  it("never overwrites existing user content", async () => {
    const file = path.join(tmp, "CLAUDE.md");
    const userContent = "# My important notes\nkeep me\n";
    await fs.writeFile(file, userContent);
    await ensureBlock(file, START, BLOCK);
    const content = await fs.readFile(file, "utf8");
    expect(content).toContain("keep me");
  });

  it("does not duplicate when the start marker was stripped but end remains", async () => {
    // Simulates an external tool removing the start comment while leaving the
    // block body + end marker. With an endMarker provided, we must not append
    // a second copy.
    const END = "<!-- BLOCK_END -->";
    const file = path.join(tmp, "CLAUDE.md");
    await fs.writeFile(file, "# Header\n\n## Some Block\nbody\n<!-- BLOCK_END -->\n");
    const change = await ensureBlock(file, START, BLOCK, "", END);
    expect(change).toBe("unchanged");
    const content = await fs.readFile(file, "utf8");
    expect(content.split(END).length - 1).toBe(1);
  });
});

describe("ensureIgnoreLines", () => {
  it("creates a new ignore file with all lines", async () => {
    const file = path.join(tmp, ".gitignore");
    const { change, added } = await ensureIgnoreLines(file, [
      ".graphify/",
      "graph.json",
    ]);
    expect(change).toBe("created");
    expect(added).toEqual([".graphify/", "graph.json"]);
  });

  it("appends only missing lines", async () => {
    const file = path.join(tmp, ".gitignore");
    await fs.writeFile(file, "node_modules/\n.graphify/\n");
    const { change, added } = await ensureIgnoreLines(file, [
      ".graphify/",
      "graph.json",
    ]);
    expect(change).toBe("updated");
    expect(added).toEqual(["graph.json"]);
  });

  it("is unchanged when all lines already present", async () => {
    const file = path.join(tmp, ".gitignore");
    await fs.writeFile(file, ".graphify/\ngraph.json\n");
    const { change, added } = await ensureIgnoreLines(file, [
      ".graphify/",
      "graph.json",
    ]);
    expect(change).toBe("unchanged");
    expect(added).toEqual([]);
  });

  it("does not duplicate lines across repeated runs", async () => {
    const file = path.join(tmp, ".gitignore");
    await ensureIgnoreLines(file, [".graphify/", "graph.json"]);
    await ensureIgnoreLines(file, [".graphify/", "graph.json"]);
    const content = await fs.readFile(file, "utf8");
    const count = content.split("\n").filter((l) => l.trim() === "graph.json").length;
    expect(count).toBe(1);
  });
});

describe("read-only checks", () => {
  it("ignoreFileContainsAll reports missing lines", async () => {
    const file = path.join(tmp, ".gitignore");
    await fs.writeFile(file, ".graphify/\n");
    const res = await ignoreFileContainsAll(file, [".graphify/", "graph.json"]);
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(["graph.json"]);
  });

  it("ignoreFileContainsAll returns all missing for absent file", async () => {
    const file = path.join(tmp, "nope.gitignore");
    const res = await ignoreFileContainsAll(file, [".graphify/"]);
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual([".graphify/"]);
  });

  it("fileContainsMarker detects the marker", async () => {
    const file = path.join(tmp, "CLAUDE.md");
    await ensureBlock(file, START, BLOCK);
    expect(await fileContainsMarker(file, START)).toBe(true);
    expect(await fileContainsMarker(file, "<!-- NOPE -->")).toBe(false);
  });
});
