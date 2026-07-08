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
