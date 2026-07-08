import chalk from "chalk";
import fs from "fs-extra";
import path from "node:path";
import type { CheckStatus } from "../types.js";

/**
 * Symbols reused for status output. ASCII fallbacks are used on legacy
 * Windows terminals that cannot render the Unicode marks cleanly.
 */
const supportsUnicode =
  process.platform !== "win32" || Boolean(process.env.WT_SESSION);

export const symbols = {
  ok: supportsUnicode ? "\u2714" : "√", // ✔
  warn: supportsUnicode ? "\u26A0" : "!", // ⚠
  fail: supportsUnicode ? "\u2716" : "×", // ✖
  info: supportsUnicode ? "\u2139" : "i", // ℹ
  arrow: supportsUnicode ? "\u2192" : ">", // →
};

let logFilePath: string | null = null;

/**
 * Enable appending a plain-text copy of every log line to a file.
 * Failures to write are swallowed so logging never crashes the CLI.
 */
export function enableFileLogging(filePath: string): void {
  logFilePath = filePath;
  try {
    fs.ensureDirSync(path.dirname(filePath));
    fs.appendFileSync(
      filePath,
      `\n--- ai-dev run @ ${new Date().toISOString()} ---\n`,
    );
  } catch {
    logFilePath = null;
  }
}

function toFile(line: string): void {
  if (!logFilePath) return;
  try {
    fs.appendFileSync(logFilePath, `${stripAnsi(line)}\n`);
  } catch {
    // Never let logging failures break the command.
  }
}

function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\u001B\[[0-9;]*m/g, "");
}

function emit(stream: "out" | "err", line: string): void {
  if (stream === "err") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
  toFile(line);
}

export const logger = {
  /** Neutral message. */
  info(message: string): void {
    emit("out", message);
  },

  /** Success message. */
  success(message: string): void {
    emit("out", `${chalk.green(symbols.ok)} ${message}`);
  },

  /** Warning — non-fatal. */
  warn(message: string): void {
    emit("err", `${chalk.yellow(symbols.warn)} ${message}`);
  },

  /** Error — something failed. */
  error(message: string): void {
    emit("err", `${chalk.red(symbols.fail)} ${message}`);
  },

  /** Section heading. */
  heading(message: string): void {
    emit("out", `\n${chalk.bold(message)}`);
  },

  /** Indented sub-detail. */
  detail(message: string): void {
    emit("out", `  ${chalk.dim(message)}`);
  },

  /** Suggested next action. */
  next(message: string): void {
    emit("out", `${chalk.cyan(symbols.arrow)} ${message}`);
  },

  /** Render a single check line, e.g. `✔ Node.js`. */
  check(status: CheckStatus, label: string, detail?: string): void {
    const mark =
      status === "ok"
        ? chalk.green(symbols.ok)
        : status === "warn"
          ? chalk.yellow(symbols.warn)
          : chalk.red(symbols.fail);
    const suffix = detail ? chalk.dim(` (${detail})`) : "";
    emit("out", `${mark} ${label}${suffix}`);
  },

  /** Raw line with no decoration. */
  raw(message: string): void {
    emit("out", message);
  },

  /** Write a line only to the debug log file, never to the console. */
  fileOnly(message: string): void {
    toFile(message);
  },

  /**
   * Report a failed command in a consistent, actionable way:
   * a concise console message plus the full stdout/stderr saved to the
   * debug log file (never swallowed).
   */
  commandFailure(opts: {
    command: string;
    exitCode?: number;
    reason: string;
    stdout?: string;
    stderr?: string;
    nextAction?: string;
  }): void {
    const { command, exitCode, reason, stdout, stderr, nextAction } = opts;
    emit("err", `${chalk.red(symbols.fail)} ${reason}`);
    emit("out", `  ${chalk.dim("command:")} ${command}`);
    if (exitCode !== undefined) {
      emit("out", `  ${chalk.dim("exit code:")} ${exitCode}`);
    }
    // Show a short excerpt on the console; full text goes to the log file.
    const excerpt = firstNonEmptyLine(stderr) ?? firstNonEmptyLine(stdout);
    if (excerpt) emit("out", `  ${chalk.dim("reason:")} ${excerpt}`);
    if (nextAction) emit("out", `${chalk.cyan(symbols.arrow)} ${nextAction}`);

    // Persist the full output for debugging without cluttering the console.
    if (stdout && stdout.trim()) {
      toFile(`[stdout of \`${command}\`]\n${stdout}`);
    }
    if (stderr && stderr.trim()) {
      toFile(`[stderr of \`${command}\`]\n${stderr}`);
    }
  },
};

function firstNonEmptyLine(text?: string): string | undefined {
  if (!text) return undefined;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length > 0) return t.length > 200 ? `${t.slice(0, 200)}…` : t;
  }
  return undefined;
}
