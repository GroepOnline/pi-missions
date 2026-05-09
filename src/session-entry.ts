export interface ActiveMissionSessionEntry {
  missionId: string;
  validationToken?: string;
}

export type ActiveMissionSessionEntryResult =
  | { kind: "none" }
  | { kind: "valid"; entry: ActiveMissionSessionEntry }
  | { kind: "invalid"; reason: string; data: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function latestActiveMissionSessionEntry(entries: Array<Record<string, unknown>>): ActiveMissionSessionEntryResult {
  const activeEntry = [...entries].reverse().find((entry) => entry.type === "custom" && entry.customType === "pi-mission-active");
  if (!activeEntry) return { kind: "none" };

  const data = activeEntry.data;
  if (!isRecord(data)) return { kind: "invalid", reason: "entry data is missing or not an object", data };

  if (typeof data.missionId !== "string" || data.missionId.trim().length === 0) {
    return { kind: "invalid", reason: "missionId is missing or not a string", data };
  }

  if (data.validationToken !== undefined && typeof data.validationToken !== "string") {
    return { kind: "invalid", reason: "validationToken is not a string", data };
  }

  return {
    kind: "valid",
    entry: {
      missionId: data.missionId,
      validationToken: data.validationToken,
    },
  };
}
