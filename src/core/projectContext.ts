import fs from "fs-extra";
import path from "node:path";
import type { ProjectType } from "../types.js";
import { readPackageJson } from "./detect.js";

export const AI_DEV_PROJECT_CONTEXT_START = "<!-- AI_DEV_PROJECT_CONTEXT_START -->";
export const AI_DEV_PROJECT_CONTEXT_END = "<!-- AI_DEV_PROJECT_CONTEXT_END -->";

export interface ProjectContext {
  type: ProjectType;
  packageName?: string;
  technologies: string[];
  folders: string[];
  scripts: Record<string, string>;
  architectureHints: string[];
}

const DEP_TECHS: Array<[string, string]> = [
  ["next", "Next.js"],
  ["react", "React"],
  ["react-dom", "React DOM"],
  ["typescript", "TypeScript"],
  ["tailwindcss", "Tailwind CSS"],
  ["@tanstack/react-query", "TanStack React Query"],
  ["react-query", "React Query"],
  ["zustand", "Zustand"],
  ["axios", "Axios"],
  ["react-hook-form", "React Hook Form"],
  ["yup", "Yup"],
  ["zod", "Zod"],
  ["@sentry/nextjs", "Sentry"],
  ["@sentry/react", "Sentry"],
  ["leaflet", "Leaflet"],
  ["react-leaflet", "React Leaflet"],
  ["chart.js", "Chart.js"],
  ["react-chartjs-2", "React Chart.js"],
  ["storybook", "Storybook"],
  ["@storybook/react", "Storybook"],
  ["@storybook/nextjs", "Storybook"],
  ["vite", "Vite"],
  ["@nestjs/core", "NestJS"],
  ["prisma", "Prisma"],
  ["typeorm", "TypeORM"],
  ["mongoose", "Mongoose"],
  ["express", "Express"],
  ["fastify", "Fastify"],
];

const IMPORTANT_FOLDERS = [
  "src",
  "app",
  "pages",
  "components",
  "lib",
  "hooks",
  "stores",
  "services",
  "api",
  "server",
  "config",
  "configs",
  "utils",
  "styles",
  "public",
  "test",
  "tests",
  "__tests__",
  "stories",
  ".storybook",
  "app",
  "routes",
  "database",
  "database/migrations",
  "src/main/kotlin",
  "src/main/java",
  "app/src/main/kotlin",
  "app/src/main/java",
  "shared",
  "shared/src/commonMain",
  "shared/src/commonMain/kotlin",
  "composeApp",
  "composeApp/src/commonMain",
  "src/commonMain",
  "src/commonMain/kotlin",
  "src/androidMain",
  "src/iosMain",
];

function allDeps(pkg: Record<string, unknown> | null): Record<string, string> {
  if (!pkg) return {};
  return {
    ...((pkg.peerDependencies as Record<string, string> | undefined) ?? {}),
    ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
    ...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
  };
}

async function existsAny(root: string, rels: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const rel of rels) {
    if (await fs.pathExists(path.join(root, rel))) found.push(rel);
  }
  return found;
}

export async function detectProjectContext(root: string, type: ProjectType): Promise<ProjectContext> {
  const pkg = readPackageJson(root);
  const deps = allDeps(pkg);
  const depSet = new Set(Object.keys(deps));
  const technologies = DEP_TECHS.filter(([dep]) => depSet.has(dep)).map(([, label]) => label);
  const folders = await existsAny(root, IMPORTANT_FOLDERS);
  const scripts = ((pkg?.scripts as Record<string, string> | undefined) ?? {});
  const architectureHints: string[] = [];

  if (["PHP", "Laravel", "Symfony"].includes(type)) technologies.push(type === "PHP" ? "PHP" : type, "Composer");
  if (["Python", "Django", "FastAPI"].includes(type)) technologies.push(type, "Python");
  if (["Kotlin", "Android Kotlin", "Kotlin Multiplatform"].includes(type)) technologies.push("Kotlin", "Gradle");
  if (type === "Android Kotlin") technologies.push("Android");
  if (type === "Kotlin Multiplatform") technologies.push("Kotlin Multiplatform");

  if (type === "Next.js") {
    if (folders.includes("src")) architectureHints.push("Primary application code appears to live under `src/`.");
    if (await fs.pathExists(path.join(root, "src", "app"))) architectureHints.push("This project appears to use the Next.js App Router under `src/app`.");
    else if (await fs.pathExists(path.join(root, "app"))) architectureHints.push("This project appears to use the Next.js App Router under `app`.");
    if (await fs.pathExists(path.join(root, "src", "pages")) || await fs.pathExists(path.join(root, "pages"))) architectureHints.push("This project also has a `pages` directory; check route ownership before moving files.");
    if (folders.includes("public")) architectureHints.push("Treat `public/` as static assets, not source architecture, unless explicitly asked.");
  }

  if (technologies.includes("TanStack React Query")) architectureHints.push("Prefer existing query keys, hooks, and cache invalidation patterns before adding new data-fetching code.");
  if (technologies.includes("Zustand")) architectureHints.push("Preserve existing Zustand store boundaries and avoid moving server/cache state into client stores.");
  if (technologies.includes("React Hook Form")) architectureHints.push("Follow existing form validation and submission patterns before introducing new form libraries.");
  if (technologies.includes("Tailwind CSS")) architectureHints.push("Prefer existing Tailwind utility conventions and design tokens/classes over ad-hoc CSS.");
  if (technologies.includes("Leaflet") || technologies.includes("React Leaflet")) architectureHints.push("Map-related code can be sensitive to browser-only APIs; check SSR/client boundaries before editing.");
  if (technologies.includes("Sentry")) architectureHints.push("Do not remove monitoring/error boundaries without an explicit product or ops reason.");

  if (type === "Laravel") architectureHints.push("Follow Laravel conventions in `app/`, `routes/`, `config/`, and `database/migrations`; do not edit `vendor/` directly.");
  else if (type === "Symfony") architectureHints.push("Follow Symfony conventions in `src/`, `config/`, and `templates`; do not edit `vendor/` directly.");
  else if (type === "PHP") architectureHints.push("Respect Composer autoloading and existing PHP module boundaries; do not edit `vendor/` directly.");

  if (type === "Django") architectureHints.push("Respect Django app boundaries, `manage.py`, settings modules, migrations, and URL routing before moving code.");
  else if (type === "FastAPI") architectureHints.push("Follow existing FastAPI router/dependency/service boundaries before adding new endpoints or dependencies.");
  else if (type === "Python") architectureHints.push("Respect `pyproject.toml`/requirements and existing Python package boundaries; do not edit virtualenv folders.");

  if (type === "Kotlin Multiplatform") architectureHints.push("Respect KMP source sets: keep shared logic in `commonMain`, platform code in `androidMain`/`iosMain`, and use expect/actual for platform APIs.");
  else if (type === "Android Kotlin") architectureHints.push("Respect Android Gradle module boundaries, manifests, resources, and `app/src/main/kotlin` or `app/src/main/java` source roots.");
  else if (type === "Kotlin") architectureHints.push("Respect Gradle module boundaries and Kotlin source roots such as `src/main/kotlin`; check build files before changing dependencies.");

  return {
    type,
    packageName: typeof pkg?.name === "string" ? pkg.name : undefined,
    technologies: [...new Set(technologies)],
    folders,
    scripts,
    architectureHints,
  };
}

function bulletList(items: string[], fallback: string): string {
  if (items.length === 0) return `- ${fallback}`;
  return items.map((item) => `- ${item}`).join("\n");
}

function scriptList(scripts: Record<string, string>): string {
  const preferred = ["dev", "build", "test", "lint", "typecheck", "storybook"];
  const entries = preferred
    .filter((key) => scripts[key])
    .map((key) => [`npm run ${key}`, scripts[key]] as const);
  if (entries.length === 0) return "- Check the project build files for verification commands (`package.json`, `composer.json`, `pyproject.toml`, or Gradle files).";
  return entries.map(([cmd, body]) => `- \`${cmd}\` — ${body}`).join("\n");
}

export function renderProjectContextBlock(context: ProjectContext): string {
  const title = context.packageName ? `${context.packageName} (${context.type})` : context.type;
  return `${AI_DEV_PROJECT_CONTEXT_START}
## Project-Aware Guidance

### Repository profile
- Project: ${title}
- Detected type: ${context.type}

### Detected stack
${bulletList(context.technologies, "No framework/library stack was confidently detected from dependencies.")}

### Important folders
${bulletList(context.folders.map((f) => `\`${f}/\``), "No common source folders were detected; inspect the repository tree before editing.")}

### Architecture notes
${bulletList(context.architectureHints, "Follow existing module boundaries and naming conventions discovered in the codebase.")}

### Verification commands
${scriptList(context.scripts)}

### Working rules
- Prefer the detected source folders over generated output, public assets, media, or dependency folders.
- Before editing, identify the relevant route/component/hook/service/store and follow the nearby pattern.
- Keep changes small, typed, and reviewable; avoid broad rewrites unless explicitly requested.
${AI_DEV_PROJECT_CONTEXT_END}`;
}
