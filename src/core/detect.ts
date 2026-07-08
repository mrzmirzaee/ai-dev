import fs from "fs-extra";
import path from "node:path";
import type { ProjectInfo, ProjectType } from "../types.js";

/** Files/dirs that indicate the root of a project. */
const ROOT_MARKERS = [
  "package.json",
  ".git",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "composer.json",
  "go.mod",
  "Cargo.toml",
];

/**
 * Walk upward from `startDir` looking for a directory that contains a project
 * root marker. Returns that directory, or `startDir` if none is found.
 */
export function findProjectRoot(startDir: string): {
  root: string;
  found: boolean;
} {
  let current = path.resolve(startDir);
  const { root: fsRoot } = path.parse(current);

  while (true) {
    for (const marker of ROOT_MARKERS) {
      if (fs.pathExistsSync(path.join(current, marker))) {
        return { root: current, found: true };
      }
    }
    if (current === fsRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { root: path.resolve(startDir), found: false };
}

/**
 * Safely read and parse a package.json in `dir`. Returns null on absence or
 * parse error.
 */
export function readPackageJson(dir: string): Record<string, unknown> | null {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.pathExistsSync(pkgPath)) return null;
  try {
    return fs.readJsonSync(pkgPath) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Merge dependencies + devDependencies into a single name->version map. */
function allDependencies(pkg: Record<string, unknown>): Record<string, string> {
  const deps = (pkg.dependencies as Record<string, string>) ?? {};
  const devDeps = (pkg.devDependencies as Record<string, string>) ?? {};
  const peerDeps = (pkg.peerDependencies as Record<string, string>) ?? {};
  return { ...peerDeps, ...devDeps, ...deps };
}

/**
 * Detect the project type from files present in `dir`.
 *
 * Precedence is intentional: more specific frameworks win over generic
 * runtimes. React beats Vite because "a React app that happens to use Vite"
 * is more useful to surface than the build tool.
 */
export function detectProjectType(dir: string): ProjectType {
  const pkg = readPackageJson(dir);

  if (pkg) {
    const deps = allDependencies(pkg);
    const has = (name: string): boolean =>
      Object.prototype.hasOwnProperty.call(deps, name);

    if (has("next")) return "Next.js";
    if (has("@nestjs/core")) return "NestJS";
    if (has("react") || has("react-dom")) return "React";
    if (has("vite")) return "Vite";
    return "Node.js";
  }

  // PHP / Laravel
  const composerPath = path.join(dir, "composer.json");
  if (fs.pathExistsSync(composerPath)) {
    try {
      const composer = fs.readJsonSync(composerPath) as {
        require?: Record<string, string>;
        "require-dev"?: Record<string, string>;
      };
      const req = { ...composer.require, ...composer["require-dev"] };
      if (Object.keys(req).some((k) => k.startsWith("laravel/"))) {
        return "Laravel";
      }
    } catch {
      // fall through to generic PHP
    }
    return "PHP";
  }

  // Python
  if (
    fs.pathExistsSync(path.join(dir, "pyproject.toml")) ||
    fs.pathExistsSync(path.join(dir, "requirements.txt")) ||
    fs.pathExistsSync(path.join(dir, "setup.py"))
  ) {
    return "Python";
  }

  return "Unknown";
}

/**
 * Full project detection: locate the root then classify it.
 * When `explicitRoot` is provided, detection runs there directly.
 */
export function detectProject(startDir: string): ProjectInfo {
  const { root, found } = findProjectRoot(startDir);
  const type = detectProjectType(root);
  return { root, type, isProjectRoot: found };
}
