import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { findAnyGraphJson } from "./graphify.js";

export const GRAPH_META_REL = path.join(".ai-dev", "graph-meta.json");

export interface GraphMeta {
  builtAt: string;
  mode: "full" | "code-only";
  target: string;
  graphPath: string;
  fileCount: number;
  filesHash: string;
}

export interface GraphFreshness {
  graphExists: boolean;
  graphPath: string | null;
  metaExists: boolean;
  meta: GraphMeta | null;
  fresh: boolean;
  changedFiles: number;
  reason: string;
}

const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".jsonc", ".md", ".py", ".php", ".kt", ".kts",
  ".java", ".xml", ".gradle", ".toml", ".yml", ".yaml",
]);

const IGNORE_DIRS = new Set([
  ".git", "node_modules", ".next", "dist", "build", "coverage", ".ai-dev", ".graphify", "graphify-out", ".turbo", ".idea", ".vscode",
]);

async function collectFiles(root: string, target: string): Promise<string[]> {
  const start = path.isAbsolute(target) ? target : path.join(root, target);
  if (!(await fs.pathExists(start))) return [];
  const result: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        await walk(abs);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (SOURCE_EXTS.has(ext) || entry.name === "package.json" || entry.name === "composer.json" || entry.name === "requirements.txt") {
          result.push(path.relative(root, abs).replace(/\\/g, "/"));
        }
      }
    }
  }
  await walk(start);
  return result.sort();
}

async function hashFiles(root: string, files: string[]): Promise<string> {
  const hash = crypto.createHash("sha256");
  for (const rel of files) {
    const abs = path.join(root, rel);
    const stat = await fs.stat(abs);
    hash.update(rel);
    hash.update(String(stat.size));
    hash.update(String(Math.floor(stat.mtimeMs)));
  }
  return hash.digest("hex");
}

export async function buildGraphMeta(root: string, mode: "full" | "code-only", target: string, graphPath: string): Promise<GraphMeta> {
  const files = await collectFiles(root, target);
  return {
    builtAt: new Date().toISOString(),
    mode,
    target,
    graphPath: path.relative(root, graphPath).replace(/\\/g, "/"),
    fileCount: files.length,
    filesHash: await hashFiles(root, files),
  };
}

export async function writeGraphMeta(root: string, meta: GraphMeta): Promise<void> {
  const metaPath = path.join(root, GRAPH_META_REL);
  await fs.ensureDir(path.dirname(metaPath));
  await fs.writeJson(metaPath, meta, { spaces: 2 });
}

export async function readGraphMeta(root: string): Promise<GraphMeta | null> {
  const metaPath = path.join(root, GRAPH_META_REL);
  if (!(await fs.pathExists(metaPath))) return null;
  try { return await fs.readJson(metaPath) as GraphMeta; }
  catch { return null; }
}

export async function getGraphFreshness(root: string): Promise<GraphFreshness> {
  const graphPath = await findAnyGraphJson(root);
  const meta = await readGraphMeta(root);
  if (!graphPath) return { graphExists: false, graphPath: null, metaExists: meta !== null, meta, fresh: false, changedFiles: 0, reason: "graph not built" };
  if (!meta) return { graphExists: true, graphPath, metaExists: false, meta: null, fresh: false, changedFiles: 0, reason: "missing graph metadata" };
  const files = await collectFiles(root, meta.target || ".");
  const currentHash = await hashFiles(root, files);
  const fresh = currentHash === meta.filesHash;
  return {
    graphExists: true,
    graphPath,
    metaExists: true,
    meta,
    fresh,
    changedFiles: fresh ? 0 : Math.max(1, Math.abs(files.length - meta.fileCount)),
    reason: fresh ? "graph is fresh" : "source files changed after last graph build",
  };
}
