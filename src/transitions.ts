import { completeActiveFeature as v2CompleteActiveFeature } from "./core/state.js";
import { buildMissionGoalTree } from "./mission-builder.js";
import type { CompleteFeatureOptions, CompleteFeatureResult, MissionState } from "./core/types.js";

export function completeActiveFeature(
  mission: MissionState,
  options: CompleteFeatureOptions,
): CompleteFeatureResult {
  const result = v2CompleteActiveFeature(mission, options);
  if (result.ok) {
    mission.goalTree = buildMissionGoalTree(mission.title, mission.goal, mission.milestones);
  }
  return result;
}
