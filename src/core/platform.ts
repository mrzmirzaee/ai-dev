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

/** Common locations where uv installs tool executables on Windows. */
export function windowsUvBinDirs(): string[] {
  const candidates = [
    "%USERPROFILE%\\.local\\bin",
    "%APPDATA%\\uv\\bin",
    "%APPDATA%\\uv\\tools\\graphifyy\\Scripts",
  ];
  return candidates.map((c) => expandWindowsEnv(c)).filter((c): c is string => Boolean(c));
}

/** Common locations where uv installs tool executables on macOS/Linux. */
export function unixUvBinDirs(): string[] {
  const home = os.homedir();
  return [path.join(home, ".local", "bin"), path.join(home, ".cargo", "bin")];
}

/** Common locations where pip --user installs console scripts on Windows. */
export function windowsPythonBinDirs(): string[] {
  const envCandidates = [
    "%APPDATA%\\Python\\Python313\\Scripts",
    "%APPDATA%\\Python\\Python312\\Scripts",
    "%APPDATA%\\Python\\Python311\\Scripts",
    "%APPDATA%\\Python\\Python310\\Scripts",
    "%LOCALAPPDATA%\\Programs\\Python\\Python313\\Scripts",
    "%LOCALAPPDATA%\\Programs\\Python\\Python312\\Scripts",
    "%LOCALAPPDATA%\\Programs\\Python\\Python311\\Scripts",
    "%LOCALAPPDATA%\\Programs\\Python\\Python310\\Scripts",
  ];
  return envCandidates.map((c) => expandWindowsEnv(c)).filter((c): c is string => Boolean(c));
}

/** Common locations where pip --user / pipx installs console scripts on macOS/Linux. */
export function unixPythonBinDirs(): string[] {
  const home = os.homedir();
  const majorMinor = `${process.version.split(".")[0]?.replace("v", "") ?? "3"}.${process.version.split(".")[1] ?? "12"}`;
  return [
    path.join(home, ".local", "bin"),
    path.join(home, "Library", "Python", majorMinor, "bin"),
    path.join(home, "Library", "Python", "3.13", "bin"),
    path.join(home, "Library", "Python", "3.12", "bin"),
    path.join(home, "Library", "Python", "3.11", "bin"),
    path.join(home, "Library", "Python", "3.10", "bin"),
  ];
}

/** All candidate uv bin dirs for the current platform. */
export function uvBinDirs(): string[] {
  return isWindows ? windowsUvBinDirs() : unixUvBinDirs();
}

/** All candidate Python user tool dirs for the current platform. */
export function pythonBinDirs(): string[] {
  return isWindows ? windowsPythonBinDirs() : unixPythonBinDirs();
}

/** All known tool bin dirs that may contain graphify. */
export function toolBinDirs(): string[] {
  return [...new Set([...uvBinDirs(), ...pythonBinDirs()])];
}

/** The executable file names to probe for a base command, accounting for Windows wrappers. */
export function executableNames(base: string): string[] {
  if (!isWindows) return [base];
  return [base, `${base}.cmd`, `${base}.exe`, `${base}.bat`];
}
