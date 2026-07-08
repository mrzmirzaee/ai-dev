import fs from "fs-extra";
import path from "node:path";

export type FileChange = "created" | "updated" | "unchanged";

/**
 * Ensure a marker-wrapped block exists in a file exactly once.
 *
 * - If the file does not exist, it is created with `header` (optional) followed
 *   by the block.
 * - If the file exists and already contains the start marker (or, when
 *   provided, the end marker), nothing changes. Checking both markers makes the
 *   operation resilient to external tools that rewrite the file and strip one
 *   of the marker comments — we still won't append a duplicate block.
 * - If the file exists without any known marker, the block is appended.
 *
 * @returns whether the file was created, updated, or left unchanged.
 */
export async function ensureBlock(
  filePath: string,
  startMarker: string,
  block: string,
  header = "",
  endMarker?: string,
): Promise<FileChange> {
  const exists = await fs.pathExists(filePath);

  if (!exists) {
    await fs.ensureDir(path.dirname(filePath));
    const body = header ? `${header}\n${block}\n` : `${block}\n`;
    await fs.writeFile(filePath, body, "utf8");
    return "created";
  }

  const current = await fs.readFile(filePath, "utf8");
  const alreadyPresent =
    current.includes(startMarker) ||
    (endMarker !== undefined && current.includes(endMarker));
  if (alreadyPresent) {
    return "unchanged";
  }

  const separator = current.endsWith("\n") ? "\n" : "\n\n";
  await fs.writeFile(filePath, `${current}${separator}${block}\n`, "utf8");
  return "updated";
}

/**
 * Ensure each of `lines` is present in an ignore-style file. Existing content
 * and order are preserved; only missing lines are appended, grouped under an
 * optional header comment.
 *
 * Matching is done on trimmed, non-comment lines so we don't duplicate entries
 * that already exist with different surrounding whitespace.
 *
 * @returns the change type and the list of lines actually added.
 */
export async function ensureIgnoreLines(
  filePath: string,
  lines: string[],
  header?: string,
): Promise<{ change: FileChange; added: string[] }> {
  const exists = await fs.pathExists(filePath);
  const current = exists ? await fs.readFile(filePath, "utf8") : "";
  const existingSet = new Set(
    current
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
  );

  const toAdd = lines.filter((l) => !existingSet.has(l.trim()));

  if (toAdd.length === 0) {
    return { change: exists ? "unchanged" : "unchanged", added: [] };
  }

  const headerLine = header && !existingSet.has(header.trim()) ? `${header}\n` : "";

  if (!exists) {
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, `${headerLine}${toAdd.join("\n")}\n`, "utf8");
    return { change: "created", added: toAdd };
  }

  const prefix = current.length === 0 || current.endsWith("\n") ? "\n" : "\n\n";
  await fs.writeFile(
    filePath,
    `${current}${prefix}${headerLine}${toAdd.join("\n")}\n`,
    "utf8",
  );
  return { change: "updated", added: toAdd };
}

/**
 * Read-only check: does `filePath` contain every one of `lines`
 * (trimmed match)? Used by `doctor`.
 */
export async function ignoreFileContainsAll(
  filePath: string,
  lines: string[],
): Promise<{ ok: boolean; missing: string[] }> {
  if (!(await fs.pathExists(filePath))) {
    return { ok: false, missing: [...lines] };
  }
  const current = await fs.readFile(filePath, "utf8");
  const existingSet = new Set(
    current
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const required = lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  const missing = required.filter((l) => !existingSet.has(l));
  return { ok: missing.length === 0, missing };
}

/** Read-only check: does `filePath` contain `marker`? */
export async function fileContainsMarker(
  filePath: string,
  marker: string,
): Promise<boolean> {
  if (!(await fs.pathExists(filePath))) return false;
  const current = await fs.readFile(filePath, "utf8");
  return current.includes(marker);
}
