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
  "grep",
  "head",
  "ls",
  "pwd",
  "rg",
  "tail",
  "wc",
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

  // Keep planning bash intentionally simple: one read-only command, no shell
  // chaining or redirection that could hide writes. Newlines and carriage
  // returns are blocked because bash treats them as command separators.
  if (/[;&|`$<>\n\r]/.test(command)) return false;

  const word = firstShellWord(command);
  if (PLANNING_READ_ONLY_BASH_COMMANDS.has(word)) return true;
  if (word === "find") return isReadOnlyFind(command);
  if (word === "sed") return isReadOnlySed(command);
  if (word === "git") return /^git\s+(?:status|diff|show|log)(?:\s|$)/.test(command);
  return false;
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
