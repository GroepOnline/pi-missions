import { Type, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

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
 * Validate a value against a TypeBox schema.
 * Returns detailed error information if invalid.
 */
export function validate<T extends TSchema>(
  schema: T,
  value: unknown
): ValidationResult {
  const errors: ValidationError[] = [];

  try {
    const valid = Value.Check(schema, value);
    if (valid) {
      return { valid: true, errors: [] };
    }

    // Collect detailed errors
    const iterator = Value.Errors(schema, value);
    for (const error of iterator) {
      errors.push({
        path: error.path,
        message: error.message,
        value: error.value,
      });
    }

    return { valid: false, errors };
  } catch (e) {
    return {
      valid: false,
      errors: [{
        path: "root",
        message: e instanceof Error ? e.message : String(e),
        value,
      }],
    };
  }
}

/**
 * Format validation errors for user display.
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return "";
  const lines = ["Validation errors:"];
  for (const error of errors.slice(0, 10)) { // Show max 10 errors
    lines.push(`  - ${error.path}: ${error.message}`);
    if (error.value !== undefined) {
      const valueStr = JSON.stringify(error.value).slice(0, 50);
      lines.push(`    (value: ${valueStr})`);
    }
  }
  if (errors.length > 10) {
    lines.push(`  ... and ${errors.length - 10} more errors`);
  }
  return lines.join("\n");
}
