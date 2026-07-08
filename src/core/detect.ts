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
  "settings.gradle",
  "settings.gradle.kts",
  "build.gradle",
  "build.gradle.kts",
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

function readTextIfExists(filePath: string): string {
  try {
    return fs.pathExistsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  } catch {
    return "";
  }
}

function projectText(dir: string, rels: string[]): string {
  return rels.map((rel) => readTextIfExists(path.join(dir, rel))).join("\n");
}

function hasAnyPath(dir: string, rels: string[]): boolean {
  return rels.some((rel) => fs.pathExistsSync(path.join(dir, rel)));
}

function detectKotlinProjectType(dir: string): ProjectType | null {
  const gradleText = projectText(dir, [
    "settings.gradle",
    "settings.gradle.kts",
    "build.gradle",
    "build.gradle.kts",
    "app/build.gradle",
    "app/build.gradle.kts",
    "shared/build.gradle",
    "shared/build.gradle.kts",
    "composeApp/build.gradle",
    "composeApp/build.gradle.kts",
  ]);
  if (!gradleText && !hasAnyPath(dir, ["src/main/kotlin", "app/src/main/kotlin", "src/commonMain", "shared/src/commonMain"])) return null;

  const lower = gradleText.toLowerCase();
  const isKmp =
    lower.includes('kotlin("multiplatform")') ||
    lower.includes("org.jetbrains.kotlin.multiplatform") ||
    lower.includes("kotlin-multiplatform") ||
    hasAnyPath(dir, [
      "src/commonMain",
      "src/commonMain/kotlin",
      "shared/src/commonMain",
      "shared/src/commonMain/kotlin",
      "composeApp/src/commonMain",
      "composeApp/src/commonMain/kotlin",
    ]);
  if (isKmp) return "Kotlin Multiplatform";

  const isAndroid =
    lower.includes("com.android.application") ||
    lower.includes("com.android.library") ||
    hasAnyPath(dir, ["app/src/main/AndroidManifest.xml", "src/main/AndroidManifest.xml"]);
  if (isAndroid) return "Android Kotlin";

  const isKotlin =
    lower.includes('kotlin("jvm")') ||
    lower.includes("org.jetbrains.kotlin.jvm") ||
    lower.includes('kotlin("android")') ||
    hasAnyPath(dir, ["src/main/kotlin", "app/src/main/kotlin"]);
  if (isKotlin) return "Kotlin";

  return null;
}

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

  const kotlin = detectKotlinProjectType(dir);
  if (kotlin) return kotlin;

  // PHP / Laravel
  const composerPath = path.join(dir, "composer.json");
  if (fs.pathExistsSync(composerPath)) {
    try {
      const composer = fs.readJsonSync(composerPath) as {
        require?: Record<string, string>;
        "require-dev"?: Record<string, string>;
      };
      const req = { ...composer.require, ...composer["require-dev"] };
      const keys = Object.keys(req);
      if (fs.pathExistsSync(path.join(dir, "artisan")) || keys.some((k) => k.startsWith("laravel/"))) return "Laravel";
      if (fs.pathExistsSync(path.join(dir, "symfony.lock")) || fs.pathExistsSync(path.join(dir, "config", "bundles.php")) || keys.some((k) => k.startsWith("symfony/"))) return "Symfony";
    } catch {
      // fall through to generic PHP
    }
    return "PHP";
  }

  // Python
  if (
    fs.pathExistsSync(path.join(dir, "pyproject.toml")) ||
    fs.pathExistsSync(path.join(dir, "requirements.txt")) ||
    fs.pathExistsSync(path.join(dir, "setup.py")) ||
    fs.pathExistsSync(path.join(dir, "manage.py"))
  ) {
    const pyText = projectText(dir, ["pyproject.toml", "requirements.txt", "setup.py", "requirements-dev.txt"]);
    if (fs.pathExistsSync(path.join(dir, "manage.py")) || /django/i.test(pyText)) return "Django";
    if (/fastapi/i.test(pyText)) return "FastAPI";
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
