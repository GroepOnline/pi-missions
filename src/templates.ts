import type { MissionState } from "./types.js";
import { createMission } from "./state.js";

// ---------------------------------------------------------------------------
// Mission Templates
// ---------------------------------------------------------------------------

export interface MissionTemplate {
  id: string;
  label: string;
  description: string;
  goal: string;
  constraints: string;
}

export const MISSION_TEMPLATES: MissionTemplate[] = [
  {
    id: "refactor",
    label: "Refactor module",
    description: "Restructure code without behavior changes",
    goal: "Refactor the target module for improved clarity, testability, and maintainability without changing external behavior.",
    constraints: "All existing tests must pass. No behavior changes allowed. Use existing dependencies only.",
  },
  {
    id: "auth",
    label: "Auth implementation",
    description: "Add or refactor authentication",
    goal: "Implement or refactor the authentication system with proper session handling, token management, and secure defaults.",
    constraints: "Must not break existing routes. Security best practices required. Use established auth libraries where possible.",
  },
  {
    id: "ci-cd",
    label: "CI/CD pipeline",
    description: "Set up or improve CI/CD pipelines",
    goal: "Set up or improve the CI/CD pipeline including build, test, lint, and deploy stages.",
    constraints: "Must work with the existing toolchain. Pipeline must be fast (< 10 min). Artifact storage must be configured.",
  },
  {
    id: "bug-fix",
    label: "Bug fix",
    description: "Reproduce and fix a specific bug",
    goal: "Find, reproduce, and fix the reported bug. Ensure the root cause is understood, not just the symptom.",
    constraints: "Write a failing test that reproduces the bug before fixing it. All other existing tests must pass after the fix.",
  },
  {
    id: "test-coverage",
    label: "Test coverage",
    description: "Improve test coverage on a module",
    goal: "Increase test coverage of the target module to at least 80%, targeting critical paths and edge cases.",
    constraints: "No production code changes except what is needed to make tests pass. Coverage must be measured with existing tooling.",
  },
  {
    id: "security-audit",
    label: "Security audit",
    description: "Audit for common vulnerabilities",
    goal: "Review the target module for security issues: injection, auth bypass, data exposure, insecure dependencies, and hardcoded secrets.",
    constraints: "Use automated scanners where possible. Document all findings with severity. No production changes without separate review.",
  },
  {
    id: "docs-update",
    label: "Docs update",
    description: "Write or update documentation",
    goal: "Create or update documentation for the target: README, API docs, architecture notes, or inline code comments.",
    constraints: "Docs must be accurate and reflect current behavior. No stub or TODO content. Rendered output must be verified.",
  },
  {
    id: "performance-opt",
    label: "Performance optimization",
    description: "Improve runtime performance",
    goal: "Identify and eliminate performance bottlenecks in the target module. Measure before and after.",
    constraints: "Baseline performance must be captured before changes. Target: 2x speedup or halve memory usage. No algorithm complexity increases.",
  },
  {
    id: "api-design",
    label: "API design",
    description: "Design or refactor an API surface",
    goal: "Design or refactor the API for the target, ensuring clarity, consistency, and developer experience. Produce an OpenAPI/AsyncAPI spec.",
    constraints: "Backward compatibility must be maintained unless explicitly asked to break. Changes reviewed by at least one stakeholder.",
  },
  {
    id: "migration",
    label: "Data migration",
    description: "Migrate data or schemas safely",
    goal: "Migrate the target data or schema safely with zero downtime, including rollback plan and verification.",
    constraints: "Migration must be reversible. Run during low-traffic window. Full backup before migration. Smoke-test after migration.",
  },
  {
    id: "feature-flag",
    label: "Feature flag rollout",
    description: "Add feature flags and gradual rollout",
    goal: "Add feature flag infrastructure and wrap the target feature, enabling gradual rollout and instant kill-switch.",
    constraints: "Flag must be configurable without redeploy. Default state must be conservative (off). Rollout percentage configurable.",
  },
];

export function createMissionFromTemplate(templateId: string, title: string): MissionState | null {
  const tpl = MISSION_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return null;
  return createMission(title || tpl.label, tpl.goal, tpl.constraints);
}
