import { describe, it, expect } from "vitest";
import {
  interpretClaudeProbe,
  getClaudeStatus,
  parseResetTime,
} from "../src/core/claude.js";

describe("interpretClaudeProbe", () => {
  it("detects not-authenticated from 'Not logged in'", () => {
    const r = interpretClaudeProbe(1, "", "Error: Not logged in. Run claude login.");
    expect(r.state).toBe("not-authenticated");
  });

  it("detects session limit and parses the reset time", () => {
    const r = interpretClaudeProbe(
      1,
      "You've hit your session limit. Your limit resets 12:10am.",
      "",
    );
    expect(r.state).toBe("session-limited");
    expect(r.resetTime).toBe("12:10am");
  });

  it("detects an incompatible Windows binary", () => {
    const r = interpretClaudeProbe(
      1,
      "",
      "This app is not compatible with the version of Windows you're running.",
    );
    expect(r.state).toBe("incompatible");
  });

  it("reports ready on a zero exit", () => {
    const r = interpretClaudeProbe(0, "pong", "");
    expect(r.state).toBe("ready");
  });

  it("reports installed (unknown) on other non-zero exits", () => {
    const r = interpretClaudeProbe(2, "", "some unexpected failure");
    expect(r.state).toBe("installed");
  });
});

describe("parseResetTime", () => {
  it("extracts a time near the word reset", () => {
    expect(parseResetTime("limit resets 9:45 PM tonight")).toBe("9:45pm");
  });
  it("returns undefined when no time is present", () => {
    expect(parseResetTime("no time here")).toBeUndefined();
  });
});

describe("getClaudeStatus (injected deps)", () => {
  it("reports npm-only when the package exists but exe is missing", async () => {
    const status = await getClaudeStatus({
      resolveExe: async () => null,
      npmInstalled: async () => true,
      runProbe: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });
    expect(status.state).toBe("npm-only");
    expect(status.installed).toBe(false);
    expect(status.npmPackage).toBe(true);
    expect(status.execInPath).toBe(false);
  });

  it("reports not-installed when neither exe nor package exist", async () => {
    const status = await getClaudeStatus({
      resolveExe: async () => null,
      npmInstalled: async () => false,
      runProbe: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });
    expect(status.state).toBe("not-installed");
  });

  it("reports ready when the probe succeeds", async () => {
    const status = await getClaudeStatus({
      resolveExe: async () => "/usr/local/bin/claude",
      npmInstalled: async () => true,
      runProbe: async () => ({ exitCode: 0, stdout: "pong", stderr: "" }),
    });
    expect(status.state).toBe("ready");
    expect(status.installed).toBe(true);
    expect(status.execPath).toBe("/usr/local/bin/claude");
  });

  it("reports session-limited from a probe with reset time", async () => {
    const status = await getClaudeStatus({
      resolveExe: async () => "/usr/local/bin/claude",
      npmInstalled: async () => true,
      runProbe: async () => ({
        exitCode: 1,
        stdout: "You've hit your session limit; resets 3:30am",
        stderr: "",
      }),
    });
    expect(status.state).toBe("session-limited");
    expect(status.resetTime).toBe("3:30am");
  });
});
