import { describe, expect, it } from "vitest";
import { createMission, getNextPendingFeature, missionDirSafe, progress, slugify } from "../src/state.js";

describe("state helpers", () => {
  it("slugifies mission titles", () => {
    expect(slugify("Hello World! 🚀")).toBe("hello-world");
  });

  it("creates a default mission with active first feature", () => {
    const mission = createMission("Test", "Goal");
    expect(mission.schemaVersion).toBe(2);
    expect(mission.activeFeatureId).toBe("F001");
    expect(progress(mission)).toEqual({ done: 0, total: 3, pct: 0 });
  });

  it("respects dependsOn when selecting next feature", () => {
    const mission = createMission("Test", "Goal");
    expect(getNextPendingFeature(mission)).toBeNull();
    mission.milestones[0].features[0].status = "done";
    expect(getNextPendingFeature(mission)?.id).toBe("F002");
  });

  it("guards mission dir against traversal", () => {
    expect(missionDirSafe("../../etc/passwd")).toContain(".pi/missions");
  });
});
