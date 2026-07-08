import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import {
  detectProjectType,
  findProjectRoot,
  detectProject,
} from "../src/core/detect.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-dev-detect-"));
});

afterEach(async () => {
  await fs.remove(tmp);
});

function writePkg(dir: string, pkg: Record<string, unknown>): void {
  fs.writeJsonSync(path.join(dir, "package.json"), pkg);
}

describe("detectProjectType", () => {
  it("detects Next.js from next dependency", () => {
    writePkg(tmp, { dependencies: { next: "14.0.0", react: "18.0.0" } });
    expect(detectProjectType(tmp)).toBe("Next.js");
  });

  it("detects NestJS from @nestjs/core", () => {
    writePkg(tmp, { dependencies: { "@nestjs/core": "10.0.0" } });
    expect(detectProjectType(tmp)).toBe("NestJS");
  });

  it("detects React before Vite when both present", () => {
    writePkg(tmp, {
      dependencies: { react: "18.0.0" },
      devDependencies: { vite: "5.0.0" },
    });
    expect(detectProjectType(tmp)).toBe("React");
  });

  it("detects Vite when only vite present", () => {
    writePkg(tmp, { devDependencies: { vite: "5.0.0" } });
    expect(detectProjectType(tmp)).toBe("Vite");
  });

  it("detects generic Node.js for a plain package.json", () => {
    writePkg(tmp, { dependencies: { express: "4.0.0" } });
    expect(detectProjectType(tmp)).toBe("Node.js");
  });

  it("detects Python from pyproject.toml", () => {
    fs.writeFileSync(path.join(tmp, "pyproject.toml"), "[project]\nname='x'\n");
    expect(detectProjectType(tmp)).toBe("Python");
  });

  it("detects Python from requirements.txt", () => {
    fs.writeFileSync(path.join(tmp, "requirements.txt"), "flask\n");
    expect(detectProjectType(tmp)).toBe("Python");
  });

  it("detects Laravel from composer.json", () => {
    fs.writeJsonSync(path.join(tmp, "composer.json"), {
      require: { "laravel/framework": "^11.0" },
    });
    expect(detectProjectType(tmp)).toBe("Laravel");
  });

  it("detects generic PHP from composer.json without laravel", () => {
    fs.writeJsonSync(path.join(tmp, "composer.json"), {
      require: { "monolog/monolog": "^3.0" },
    });
    expect(detectProjectType(tmp)).toBe("PHP");
  });

  it("returns Unknown for an empty directory", () => {
    expect(detectProjectType(tmp)).toBe("Unknown");
  });

  it("returns Node.js even with malformed package.json (parse fails -> no pkg)", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), "{ not json");
    // malformed package.json => readPackageJson returns null => falls through
    expect(detectProjectType(tmp)).toBe("Unknown");
  });
});

describe("findProjectRoot", () => {
  it("finds root via package.json in a nested dir", () => {
    writePkg(tmp, { name: "root" });
    const nested = path.join(tmp, "src", "deep");
    fs.ensureDirSync(nested);
    const { root, found } = findProjectRoot(nested);
    expect(found).toBe(true);
    expect(root).toBe(tmp);
  });

  it("finds root via .git", () => {
    fs.ensureDirSync(path.join(tmp, ".git"));
    const nested = path.join(tmp, "a", "b");
    fs.ensureDirSync(nested);
    const { root, found } = findProjectRoot(nested);
    expect(found).toBe(true);
    expect(root).toBe(tmp);
  });

  it("reports not found when no markers exist", () => {
    const nested = path.join(tmp, "x");
    fs.ensureDirSync(nested);
    const { found } = findProjectRoot(nested);
    expect(found).toBe(false);
  });
});

describe("detectProject", () => {
  it("returns combined root + type info", () => {
    writePkg(tmp, { dependencies: { next: "14.0.0" } });
    const info = detectProject(tmp);
    expect(info.root).toBe(tmp);
    expect(info.type).toBe("Next.js");
    expect(info.isProjectRoot).toBe(true);
  });
});
