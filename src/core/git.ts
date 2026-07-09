import { run, commandExists } from "./command.js";

export async function isGitRepo(cwd: string): Promise<boolean> {
  if (!(await commandExists("git"))) return false;
  const res = await run("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
  return res.ok && res.stdout.trim() === "true";
}

export async function isWorkingTreeDirty(cwd: string): Promise<boolean> {
  if (!(await isGitRepo(cwd))) return false;
  const res = await run("git", ["status", "--porcelain"], { cwd });
  return res.ok && res.stdout.trim().length > 0;
}

export async function createBranch(cwd: string, branch: string): Promise<{ ok: boolean; detail?: string }> {
  if (!(await isGitRepo(cwd))) return { ok: false, detail: "not a git repository" };
  const res = await run("git", ["checkout", "-b", branch], { cwd });
  return { ok: res.ok, detail: res.ok ? undefined : (res.stderr || res.stdout) };
}
