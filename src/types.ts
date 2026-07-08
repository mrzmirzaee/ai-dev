import { z } from "zod";

/**
 * Supported / detectable project types.
 */
export type ProjectType =
  | "Next.js"
  | "NestJS"
  | "React"
  | "Vite"
  | "Node.js"
  | "Python"
  | "Laravel"
  | "PHP"
  | "Unknown";

/**
 * Exit codes used across the CLI.
 *   0 -> success
 *   1 -> setup failed (an operation errored)
 *   2 -> missing required dependency
 */
export const ExitCode = {
  Success: 0,
  SetupFailed: 1,
  MissingDependency: 2,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Result of a single environment check (used by `doctor`).
 */
export type CheckStatus = "ok" | "warn" | "fail";

/** How important a check is to overall readiness. */
export type CheckSeverity = "critical" | "important" | "optional";

export interface CheckResult {
  label: string;
  status: CheckStatus;
  severity: CheckSeverity;
  detail?: string;
}

/**
 * Options shared by the `init` command.
 */
export interface InitOptions {
  yes: boolean;
  skipGraph: boolean;
  skipMcp: boolean;
  force: boolean;
}

/**
 * Options for `graph rebuild`.
 */
export interface GraphRebuildOptions {
  /** Path to a pre-computed semantic extraction JSON, if provided. */
  semantic?: string;
}

/**
 * Zod schema for a lightweight, optional `.ai-dev.json` config file.
 * Not required for the CLI to function, but validated when present so
 * future configuration cannot silently drift into an invalid state.
 */
export const AiDevConfigSchema = z.object({
  projectType: z
    .enum([
      "Next.js",
      "NestJS",
      "React",
      "Vite",
      "Node.js",
      "Python",
      "Laravel",
      "PHP",
      "Unknown",
    ])
    .optional(),
  skipGraph: z.boolean().optional(),
  skipMcp: z.boolean().optional(),
  mcp: z
    .object({
      context7: z.boolean().optional(),
      serena: z.boolean().optional(),
      playwright: z.boolean().optional(),
    })
    .optional(),
});

export type AiDevConfig = z.infer<typeof AiDevConfigSchema>;

/**
 * Structured information about the detected project.
 */
export interface ProjectInfo {
  root: string;
  type: ProjectType;
  isProjectRoot: boolean;
}
