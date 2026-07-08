import path from "node:path";
import os from "node:os";

/** True when running on Windows. */
export const isWindows = process.platform === "win32";

/**
 * Expand a Windows-style environment variable reference such as
 * `%USERPROFILE%` or `%APPDATA%` using current environment values.
 * Returns null when the referenced variable is not set.
 */
export function expandWindowsEnv(input: string): string | null {
  const match = input.match(/^%([^%]+)%(.*)$/);
  if (!match) return input;
  const [, varName, rest] = match;
  const value = process.env[varName];
  if (!value) return null;
  return path.join(value, rest.replace(/^[\\/]/, ""));
}

/**
 * Common locations where `uv` installs tool executables on Windows.
 * These are checked when `graphify` is not found on PATH.
 */
export function windowsUvBinDirs(): string[] {
  const candidates = [
    "%USERPROFILE%\\.local\\bin",
    "%APPDATA%\\uv\\bin",
    "%APPDATA%\\uv\\tools\\graphifyy\\Scripts",
  ];
  return candidates
    .map((c) => expandWindowsEnv(c))
    .filter((c): c is string => Boolean(c));
}

/**
 * Common locations where `uv` installs tool executables on macOS/Linux.
 */
export function unixUvBinDirs(): string[] {
  const home = os.homedir();
  return [
    path.join(home, ".local", "bin"),
    path.join(home, ".cargo", "bin"),
  ];
}

/** All candidate uv bin dirs for the current platform. */
export function uvBinDirs(): string[] {
  return isWindows ? windowsUvBinDirs() : unixUvBinDirs();
}

/**
 * The executable file names to probe for a given base command, accounting
 * for Windows' `.cmd` / `.exe` wrappers.
 */
export function executableNames(base: string): string[] {
  if (!isWindows) return [base];
  return [base, `${base}.cmd`, `${base}.exe`, `${base}.bat`];
}
