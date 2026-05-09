export {
  buildContinuationPrompt as buildAutopilotContinuationPrompt,
  ensureActiveFeature,
  processAgentEndForAutopilot,
  shouldContinue as shouldContinueMission,
  triggerContinuation as triggerMissionContinuation,
} from "./engines/autopilot.js";
