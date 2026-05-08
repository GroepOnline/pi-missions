import { describe, it, expect } from "vitest";
import { 
  validateMissionState, 
  validateFeature, 
  validateMilestone, 
  validateHistoryEntry,
  formatValidationErrors,
  assertValidMissionState,
  assertValidFeature,
  safeParseJSON
} from "../src/validation.js";
import { MissionStateSchema, FeatureSchema } from "../src/schemas.js";

describe("Schema Validation", () => {
  describe("validateMissionState", () => {
    it("accepts valid mission state", () => {
      const validMission = {
        schemaVersion: 2,
        id: "mission-123",
        title: "Test Mission",
        goal: "Test goal",
        status: "active",
        milestones: [],
        tokensUsed: 0,
        lastContextTokens: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      const result = validateMissionState(validMission);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects null data", () => {
      const result = validateMissionState(null);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("rejects undefined data", () => {
      const result = validateMissionState(undefined);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("rejects non-object data", () => {
      const result = validateMissionState("string");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("validateFeature", () => {
    it("accepts valid feature", () => {
      const validFeature = {
        id: "F001",
        milestoneId: "M01",
        title: "Test Feature",
        description: "Test description",
        priority: 1,
        dependsOn: [],
        acceptance: [],
        status: "pending",
        sessions: [],
        toolCallCount: 0,
      };
      
      const result = validateFeature(validFeature);
      expect(result.valid).toBe(true);
    });

    it("rejects null data", () => {
      const result = validateFeature(null);
      expect(result.valid).toBe(false);
    });

    it("rejects non-object data", () => {
      const result = validateFeature("string");
      expect(result.valid).toBe(false);
    });
  });

  describe("validateMilestone", () => {
    it("accepts valid milestone", () => {
      const validMilestone = {
        id: "M01",
        title: "Test Milestone",
        description: "Test description",
        status: "active",
        features: [],
      };
      
      const result = validateMilestone(validMilestone);
      expect(result.valid).toBe(true);
    });

    it("rejects null data", () => {
      const result = validateMilestone(null);
      expect(result.valid).toBe(false);
    });
  });

  describe("validateHistoryEntry", () => {
    it("accepts valid history entry", () => {
      const validEntry = {
        ts: Math.floor(Date.now() / 1000),
        missionId: "mission-123",
        event: "feature_done",
        featureId: "F001",
      };
      
      const result = validateHistoryEntry(validEntry);
      expect(result.valid).toBe(true);
    });

    it("rejects null data", () => {
      const result = validateHistoryEntry(null);
      expect(result.valid).toBe(false);
    });
  });

  describe("formatValidationErrors", () => {
    it("returns success message for valid result", () => {
      const result = { valid: true, errors: [] };
      expect(formatValidationErrors(result)).toBe("Validation passed");
    });

    it("formats errors with path and message", () => {
      const result = {
        valid: false,
        errors: [
          { path: "/status", message: "Invalid union value", value: "invalid" },
          { path: "/title", message: "Expected string", value: 123 },
        ],
      };
      
      const formatted = formatValidationErrors(result);
      expect(formatted).toContain("Validation failed");
      expect(formatted).toContain("/status");
      expect(formatted).toContain("Invalid union value");
      expect(formatted).toContain("/title");
      expect(formatted).toContain("Expected string");
    });
  });

  describe("assertValidMissionState", () => {
    it("does not throw for valid mission", () => {
      const validMission = {
        schemaVersion: 2,
        id: "mission-123",
        title: "Test Mission",
        goal: "Test goal",
        status: "active",
        milestones: [],
        tokensUsed: 0,
        lastContextTokens: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      expect(() => assertValidMissionState(validMission)).not.toThrow();
    });

    it("throws for invalid mission (null)", () => {
      expect(() => assertValidMissionState(null)).toThrow();
      expect(() => assertValidMissionState(null)).toThrow("Invalid mission state");
    });
  });

  describe("assertValidFeature", () => {
    it("does not throw for valid feature", () => {
      const validFeature = {
        id: "F001",
        milestoneId: "M01",
        title: "Test Feature",
        description: "Test description",
        priority: 1,
        dependsOn: [],
        acceptance: [],
        status: "pending",
        sessions: [],
        toolCallCount: 0,
      };
      
      expect(() => assertValidFeature(validFeature)).not.toThrow();
    });

    it("throws for invalid feature (null)", () => {
      expect(() => assertValidFeature(null)).toThrow();
    });
  });

  describe("safeParseJSON", () => {
    it("parses and validates valid JSON", () => {
      const json = JSON.stringify({
        schemaVersion: 2,
        id: "mission-123",
        title: "Test Mission",
        goal: "Test goal",
        status: "active",
        milestones: [],
        tokensUsed: 0,
        lastContextTokens: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      
      const result = safeParseJSON(json, MissionStateSchema);
      expect(result).toHaveProperty("id", "mission-123");
      expect(result).toHaveProperty("title", "Test Mission");
    });

    it("throws for invalid JSON", () => {
      expect(() => safeParseJSON("invalid json", MissionStateSchema)).toThrow("JSON parsing failed");
    });

    it("throws for valid JSON that fails validation (null)", () => {
      const json = JSON.stringify(null);
      expect(() => safeParseJSON(json, MissionStateSchema)).toThrow("Invalid JSON");
    });
  });
});
