import { describe, it, expect } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { detectProjectContext, renderProjectContextBlock } from "../src/core/projectContext.js";

describe("project-aware context", () => {
  it("detects a Next.js app stack and renders guidance", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-dev-context-"));
    try {
      await fs.writeJson(path.join(tmp, "package.json"), {
        name: "sample-next-app",
        scripts: { dev: "next dev", build: "next build", lint: "next lint" },
        dependencies: {
          next: "14.0.0",
          react: "18.0.0",
          "@tanstack/react-query": "5.0.0",
          zustand: "4.0.0",
          tailwindcss: "3.0.0",
        },
      });
      await fs.ensureDir(path.join(tmp, "src", "app"));
      await fs.ensureDir(path.join(tmp, "src", "components"));
      await fs.ensureDir(path.join(tmp, "public"));

      const context = await detectProjectContext(tmp, "Next.js");
      const block = renderProjectContextBlock(context);

      expect(context.technologies).toContain("Next.js");
      expect(context.technologies).toContain("TanStack React Query");
      expect(block).toContain("sample-next-app (Next.js)");
      expect(block).toContain("Next.js App Router");
      expect(block).toContain("`npm run build`");
      expect(block).toContain("Treat `public/` as static assets");
    } finally {
      await fs.remove(tmp);
    }
  });
});

describe("multi-stack project-aware context", () => {
  it("renders KMP source-set guidance", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-dev-context-kmp-"));
    try {
      await fs.writeFile(path.join(tmp, "settings.gradle.kts"), "pluginManagement {}\n");
      await fs.writeFile(path.join(tmp, "build.gradle.kts"), "plugins { kotlin(\"multiplatform\") version \"2.0.0\" }\n");
      await fs.ensureDir(path.join(tmp, "shared", "src", "commonMain", "kotlin"));
      await fs.ensureDir(path.join(tmp, "shared", "src", "androidMain", "kotlin"));
      const context = await detectProjectContext(tmp, "Kotlin Multiplatform");
      const block = renderProjectContextBlock(context);
      expect(context.technologies).toContain("Kotlin Multiplatform");
      expect(block).toContain("commonMain");
      expect(block).toContain("expect/actual");
    } finally {
      await fs.remove(tmp);
    }
  });

  it("renders Laravel guidance", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-dev-context-laravel-"));
    try {
      await fs.writeJson(path.join(tmp, "composer.json"), { require: { "laravel/framework": "^11.0" } });
      await fs.ensureDir(path.join(tmp, "app"));
      await fs.ensureDir(path.join(tmp, "routes"));
      const context = await detectProjectContext(tmp, "Laravel");
      const block = renderProjectContextBlock(context);
      expect(context.technologies).toContain("Laravel");
      expect(block).toContain("Laravel conventions");
    } finally {
      await fs.remove(tmp);
    }
  });
});
