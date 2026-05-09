import { describe, expect, it } from "vitest";
import { validate, formatValidationErrors } from "../src/validation.js";
import { FeatureSchema, WizardOutputSchema } from "../src/schemas.js";

describe("Schema Validation", () => {
  it("rejects invalid feature ID", () => {
    const invalid = {
      id: "INVALID",
      milestoneId: "M01",
      title: "Test",
      description: "Test",
      priority: 1,
      dependsOn: [],
      acceptance: [{ id: "AC001", description: "Test", checkType: "manual", verified: false }],
      status: "pending",
      sessions: [],
      toolCallCount: 0,
    };
    const result = validate(FeatureSchema, invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path.includes("id"))).toBe(true);
  });

  it("rejects wizard with single milestone", () => {
    const invalid = {
      title: "Test",
      milestones: [{
        id: "M01",
        title: "M1",
        description: "D",
        status: "active",
        features: [],
      }],
    };
    const result = validate(WizardOutputSchema, invalid);
    expect(result.valid).toBe(false);
  });

  it("formats validation errors nicely", () => {
    const invalid = { id: "BAD" };
    const result = validate(FeatureSchema, invalid);
    const formatted = formatValidationErrors(result.errors);
    expect(formatted).toContain("Validation errors:");
    expect(formatted).toContain("id:");
  });

  it("accepts valid feature structure", () => {
    const valid = {
      id: "F001",
      milestoneId: "M01",
      title: "Test Feature",
      description: "Test description",
      priority: 1,
      dependsOn: [],
      acceptance: [{ id: "AC001", description: "Test", checkType: "manual", verified: false }],
      status: "pending",
      sessions: [],
      toolCallCount: 0,
    };
    const result = validate(FeatureSchema, valid);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts valid wizard output", () => {
    const valid = {
      title: "Test Mission",
      milestones: [
        {
          id: "M01",
          title: "Milestone 1",
          description: "First milestone",
          features: [{
            id: "F001",
            title: "Feature 1",
            description: "First feature",
            priority: 1,
            dependsOn: [],
            acceptance: [{ id: "AC001", description: "Test", checkType: "manual" }],
          }],
        },
        {
          id: "M02",
          title: "Milestone 2",
          description: "Second milestone",
          features: [{
            id: "F002",
            title: "Feature 2",
            description: "Second feature",
            priority: 1,
            dependsOn: [],
            acceptance: [{ id: "AC002", description: "Test", checkType: "manual" }],
          }],
        },
      ],
    };
    const result = validate(WizardOutputSchema, valid);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts planner-shaped wizard output without runtime fields", () => {
    const valid = {
      title: "Planner Mission",
      milestones: [
        {
          id: "M01",
          title: "Plan",
          description: "Plan the work",
          features: [{
            id: "F001",
            title: "Scope",
            description: "Clarify scope and constraints",
            priority: 1,
            dependsOn: [],
            acceptance: [{ id: "AC001", description: "Scope documented", checkType: "manual" }],
          }],
        },
        {
          id: "M02",
          title: "Build",
          description: "Build the change",
          features: [{
            id: "F002",
            title: "Implement",
            description: "Implement the accepted plan",
            priority: 1,
            dependsOn: ["F001"],
            acceptance: [{ id: "AC001", description: "Tests pass", checkType: "bash", checkCommand: "npm test" }],
          }],
        },
      ],
    };
    const result = validate(WizardOutputSchema, valid);
    expect(result.valid).toBe(true);
  });

  it("rejects wizard output with runtime-only fields", () => {
    const invalid = {
      title: "Planner Mission",
      milestones: [
        {
          id: "M01",
          title: "Plan",
          description: "Plan the work",
          status: "active",
          features: [{
            id: "F001",
            milestoneId: "M01",
            title: "Scope",
            description: "Clarify scope and constraints",
            priority: 1,
            dependsOn: [],
            status: "pending",
            sessions: [],
            toolCallCount: 0,
            acceptance: [{ id: "AC001", description: "Scope documented", checkType: "manual", verified: true, waived: true }],
          }],
        },
        {
          id: "M02",
          title: "Build",
          description: "Build the change",
          features: [{
            id: "F002",
            title: "Implement",
            description: "Implement the accepted plan",
            priority: 1,
            dependsOn: ["F001"],
            acceptance: [{ id: "AC001", description: "Tests pass", checkType: "bash", checkCommand: "npm test" }],
          }],
        },
      ],
    };
    const result = validate(WizardOutputSchema, invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.path.includes("status"))).toBe(true);
    expect(result.errors.some((error) => error.path.includes("verified") || error.path.includes("waived"))).toBe(true);
  });

  it("rejects root-level wizard metadata that is not part of the planning contract", () => {
    const invalid = {
      title: "Planner Mission",
      goalTree: { rootTitle: "Planner Mission" },
      milestones: [
        {
          id: "M01",
          title: "Plan",
          description: "Plan the work",
          features: [{
            id: "F001",
            title: "Scope",
            description: "Clarify scope and constraints",
            priority: 1,
            dependsOn: [],
            acceptance: [{ id: "AC001", description: "Scope documented", checkType: "manual" }],
          }],
        },
        {
          id: "M02",
          title: "Build",
          description: "Build the change",
          features: [{
            id: "F002",
            title: "Implement",
            description: "Implement the accepted plan",
            priority: 1,
            dependsOn: ["F001"],
            acceptance: [{ id: "AC001", description: "Tests pass", checkType: "bash", checkCommand: "npm test" }],
          }],
        },
      ],
    };
    const result = validate(WizardOutputSchema, invalid);
    expect(result.valid).toBe(false);
  });

  it("limits error display to 10 errors", () => {
    const invalid = { id: "BAD" };
    const result = validate(FeatureSchema, invalid);
    // Create more than 10 errors by having a very invalid structure
    const formatted = formatValidationErrors(result.errors);
    const lines = formatted.split("\n");
    // Should have header + max 10 errors + "and X more" line if needed
    expect(lines.length).toBeLessThanOrEqual(13); // 1 header + 10 errors + 2 more lines max
  });
});
