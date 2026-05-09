// Planning phase read-only bash guard.
// Keeps planning agents from executing destructive shell commands.

// ── Types also used in src/index.ts ────────────────────────────────────────

export type ToolCallEvent = {
  toolName: string;
  toolCallId?: string;
  input?: Record<string, unknown>;
};

export type ToolResultEvent = {
  toolName: string;
  toolCallId?: string;
  input?: Record<string, unknown>;
  content?: Array<{ type?: string; text?: string }>;
  details?: unknown;
  isError: boolean;
};

// ── Bash guard helpers ─────────────────────────────────────────────────────

const PLANNING_READ_ONLY_BASH_COMMANDS = new Set([
  "cat",
  "echo",
  "env",
  "grep",
  "head",
  "hostname",
  "ls",
  "printenv",
  "pwd",
  "rg",
  "tail",
  "type",
  "uname",
  "wc",
  "whereis",
  "which",
  "whoami",
]);

export function firstShellWord(command: string): string {
  const match = command.trim().match(/^([A-Za-z0-9_.-]+)/);
  return match?.[1] ?? "";
}

export function hasOption(command: string, option: string): boolean {
  return new RegExp(`(?:^|\\s)${option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`).test(command);
}

export function isReadOnlyFind(command: string): boolean {
  return /^find(?:\s|$)/.test(command) &&
    !/\s-(?:delete|exec|execdir|ok|okdir|fls|fprint|fprint0|fprintf)(?:\s|$)/.test(command);
}

export function isReadOnlySed(command: string): boolean {
  return /^sed\s+-n(?:\s|$)/.test(command) &&
    !hasOption(command, "-i") &&
    !hasOption(command, "--in-place");
}

export function isReadOnlyPlanningBash(input: Record<string, unknown> | undefined): boolean {
  const command = typeof input?.command === "string" ? input.command.trim() : "";
  if (!command) return false;

  // Sanitize harmless patterns first (||, &&, /dev/null redirects)
  const sanitized = sanitizePlanningBash(command);

  // Keep planning bash intentionally simple: one read-only command, no shell
  // chaining or redirection that could hide writes. Newlines and carriage
  // returns are blocked because bash treats them as command separators.
  // Note: `$` is NOT blocked - variable expansion is not a filesystem write.
  if (/[;&|`<>\n\r]/.test(sanitized)) return false;

  // $() command substitution is NEVER allowed — it can execute arbitrary commands
  // even when the outer command is in the read-only whitelist (e.g. ls $(whoami))
  if (/\$\(/.test(command) || /`/.test(command)) return false;

  const word = firstShellWord(sanitized);
  if (PLANNING_READ_ONLY_BASH_COMMANDS.has(word)) return true;
  if (word === "find") return isReadOnlyFind(command);
  if (word === "sed") return isReadOnlySed(command);
  if (word === "git") return /^git\s+(?:status|diff|show|log)(?:\s|$)/.test(command);
  return false;
}

/** Strip common error-suppression idioms before checking for dangerous operators.
 *  These patterns are harmless and used by Pi agents for clean exploration output:
 *    - `||` and `&&` are logical operators, not pipes
 *    - `>/dev/null`, `2>/dev/null`, `2>&1` redirect to null, not to real files
 *  Returns the sanitized command string for further checking. */
export function sanitizePlanningBash(command: string): string {
  return command
    // Collapse logical operators so they don't trigger the | or & block
    .replace(/\|\|/g, " OR ")
    .replace(/&&/g, " AND ")
    // Strip harmless /dev/null redirects
    .replace(/2?>\/?dev\/null/g, "")
    // Strip stderr-to-stdout redirect
    .replace(/2>&1/g, "")
    .trim();
}

export { PLANNING_READ_ONLY_BASH_COMMANDS };

// ── Tool result error message helper ─────────────────────────────────────────

export function toolResultErrorMessage(event: ToolResultEvent): string {
  const text = event.content
    ?.filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
  if (text) return text;
  return `Tool '${event.toolName}' failed`;
}
