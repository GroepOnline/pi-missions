import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { Feature } from "./types.js";

/** Session manager with optional getLeafId / getSessionFile for fork support. */
export type ForkSessionManager = ExtensionCommandContext["sessionManager"] & {
  getLeafId?: () => string | null;
  getSessionFile?: () => string | undefined;
};

/** Replacement context inside a fork's withSession callback. */
export type ForkReplacementContext = ExtensionCommandContext & {
  sendUserMessage?: (message: string) => Promise<unknown>;
};

/** Append a block of lines to an existing notes field. */
export function appendForkNote(existing: string | undefined, lines: string[]): string {
  const block = lines.filter(Boolean).join("\n");
  return [existing?.trim(), block].filter(Boolean).join("\n\n");
}

/** Push a session reference, avoiding duplicates. */
export function pushSessionRef(feature: Feature, ref: string | undefined | null): void {
  if (!ref || feature.sessions.includes(ref)) return;
  feature.sessions.push(ref);
}

/** Build the kickoff message sent into a forked session. */
export function buildForkKickoffMessage(
  missionTitle: string,
  sourceFeature: Feature,
  forkedFeature: Feature,
  reason: string,
  subtask: string | undefined,
  parentSessionFile: string | undefined,
): string {
  return [
    `Continue mission "${missionTitle}" in this forked session.`,
    `Forked from ${sourceFeature.id} - ${sourceFeature.title}.`,
    `Active fork feature: ${forkedFeature.id} - ${forkedFeature.title}.`,
    `Reason: ${reason}.`,
    subtask ? `Subtask: ${subtask}.` : "",
    forkedFeature.description,
    "",
    "Immediate handoff:",
    `1. Focus only on ${forkedFeature.id}.`,
    "2. Record concrete evidence and decisions back into the mission state.",
    "3. Keep the original feature blocked until this fork resolves the issue.",
    parentSessionFile ? `Parent session: ${parentSessionFile}` : "Parent session: unavailable",
  ].filter(Boolean).join("\n");
}

/** Build the manual handoff message when fork API is unavailable. */
export function buildManualForkHandoff(
  missionTitle: string,
  sourceFeature: Feature,
  forkedFeature: Feature,
  reason: string,
  parentLeafId: string | null,
  parentSessionFile: string | undefined,
): string {
  return [
    `🔀 Fork feature created for mission ${missionTitle}.`,
    `Source feature blocked: ${sourceFeature.id}`,
    `Active fork feature: ${forkedFeature.id} - ${forkedFeature.title}`,
    `Reason: ${reason}`,
    parentLeafId ? `Current leaf: ${parentLeafId}` : "Current leaf: unavailable",
    parentSessionFile ? `Current session: ${parentSessionFile}` : "Current session: unavailable",
    "",
    "Action: open or clone a new Pi session from this point and continue with the forked feature.",
  ].filter(Boolean).join("\n");
}
