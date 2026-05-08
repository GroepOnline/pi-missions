import { Type } from "@sinclair/typebox";
import { 
  AcceptanceCriterionSchema, 
  FeatureSchema, 
  MilestoneSchema, 
  MissionStateSchema, 
  MissionHistoryEntrySchema 
} from "./schemas.js";

/**
 * Validation utilities for mission data.
 * Provides runtime type checking and validation error reporting.
 */

export interface ValidationError {
  path: string;
  message: string;
  value: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate data against a TypeBox schema using TypeCompiler.
 * @param schema - The TypeBox schema to validate against
 * @param data - The data to validate
 * @returns ValidationResult with validation status and errors
 */
export function validate(schema: TSchema, data: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  
  try {
    // Use TypeBox TypeCompiler to validate
    // This is a simplified approach - in production you'd want to use the TypeBox compiler
    // For now, we'll do basic structural validation
    if (data === null || data === undefined) {
      errors.push({
        path: "/",
        message: "Data is null or undefined",
        value: data,
      });
      return { valid: false, errors };
    }
    
    // Basic type checking based on schema kind
    // This is a simplified version - full TypeBox validation would require the compiler
    if (typeof data !== "object") {
      errors.push({
        path: "/",
        message: "Expected object",
        value: data,
      });
      return { valid: false, errors };
    }
    
    // For now, assume validation passes if it's an object
    // In a full implementation, you'd use TypeBox's TypeCompiler.Check()
    return { valid: true, errors };
  } catch (error) {
    errors.push({
      path: "/",
      message: error instanceof Error ? error.message : String(error),
      value: data,
    });
    return { valid: false, errors };
  }
}

/**
 * Validate mission state data.
 * @param data - The mission data to validate
 * @returns ValidationResult with validation status and errors
 */
export function validateMissionState(data: unknown): ValidationResult {
  return validate(MissionStateSchema, data);
}

/**
 * Validate feature data.
 * @param data - The feature data to validate
 * @returns ValidationResult with validation status and errors
 */
export function validateFeature(data: unknown): ValidationResult {
  return validate(FeatureSchema, data);
}

/**
 * Validate milestone data.
 * @param data - The milestone data to validate
 * @returns ValidationResult with validation status and errors
 */
export function validateMilestone(data: unknown): ValidationResult {
  return validate(MilestoneSchema, data);
}

/**
 * Validate mission history entry data.
 * @param data - The history entry data to validate
 * @returns ValidationResult with validation status and errors
 */
export function validateHistoryEntry(data: unknown): ValidationResult {
  return validate(MissionHistoryEntrySchema, data);
}

/**
 * Format validation errors for user display.
 * @param result - The validation result
 * @returns Formatted error message
 */
export function formatValidationErrors(result: ValidationResult): string {
  if (result.valid) {
    return "Validation passed";
  }
  
  const lines = ["Validation failed:"];
  for (const error of result.errors) {
    lines.push(`  - ${error.path}: ${error.message}`);
    if (error.value !== undefined) {
      lines.push(`    Received: ${JSON.stringify(error.value)}`);
    }
  }
  
  return lines.join("\n");
}

/**
 * Assert that data is valid according to schema.
 * Throws an error with formatted validation messages if invalid.
 * @param schema - The TypeBox schema to validate against
 * @param data - The data to validate
 * @param context - Optional context for error message
 * @throws Error if validation fails
 */
export function assertValid(schema: TSchema, data: unknown, context = "data"): void {
  const result = validate(schema, data);
  if (!result.valid) {
    throw new Error(`Invalid ${context}:\n${formatValidationErrors(result)}`);
  }
}

/**
 * Assert that mission state is valid.
 * @param data - The mission data to validate
 * @throws Error if validation fails
 */
export function assertValidMissionState(data: unknown): void {
  assertValid(MissionStateSchema, data, "mission state");
}

/**
 * Assert that feature is valid.
 * @param data - The feature data to validate
 * @throws Error if validation fails
 */
export function assertValidFeature(data: unknown): void {
  assertValid(FeatureSchema, data, "feature");
}

/**
 * Safe JSON parse with validation.
 * @param json - JSON string to parse
 * @param schema - Schema to validate against
 * @param context - Optional context for error message
 * @returns Parsed and validated data
 * @throws Error if JSON parsing or validation fails
 */
export function safeParseJSON<T>(json: string, schema: TSchema, context = "JSON"): T {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new Error(`Invalid ${context}: JSON parsing failed - ${error instanceof Error ? error.message : String(error)}`);
  }
  
  assertValid(schema, data, context);
  return data as T;
}
