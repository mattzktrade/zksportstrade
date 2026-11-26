import type { JsonSchema } from "@/lib/mcp/types"

export type SchemaIssue = { error: string }

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function coerceBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  if (value === "true") return true
  if (value === "false") return false
  return null
}

/** Validate MCP tool arguments against the JSON schema. Coerces numeric strings. */
export function parseToolArguments(
  schema: JsonSchema,
  raw: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const input = asRecord(raw)
  const required = schema.required ?? []
  const out: Record<string, unknown> = {}

  for (const name of required) {
    const value = input[name]
    if (value == null || value === "") {
      return { ok: false, error: `Missing required argument: ${name}.` }
    }
  }

  for (const [name, spec] of Object.entries(schema.properties)) {
    if (!(name in input) || input[name] == null || input[name] === "") continue
    const value = input[name]

    if (spec.type === "string") {
      if (typeof value !== "string") {
        return { ok: false, error: `${name} must be a string.` }
      }
      const trimmed = value.trim()
      if (spec.minLength && trimmed.length < spec.minLength) {
        return { ok: false, error: `${name} is too short.` }
      }
      if (spec.enum && !spec.enum.includes(trimmed)) {
        return { ok: false, error: `${name} must be one of: ${spec.enum.join(", ")}.` }
      }
      out[name] = trimmed
      continue
    }

    if (spec.type === "boolean") {
      const parsed = coerceBoolean(value)
      if (parsed == null) return { ok: false, error: `${name} must be true or false.` }
      out[name] = parsed
      continue
    }

    const parsed = coerceNumber(value)
    if (parsed == null) {
      return { ok: false, error: `${name} must be a number.` }
    }
    if (spec.type === "integer" && !Number.isInteger(parsed)) {
      return { ok: false, error: `${name} must be a whole number.` }
    }
    if (spec.minimum != null && parsed < spec.minimum) {
      return { ok: false, error: `${name} must be at least ${spec.minimum}.` }
    }
    if (spec.maximum != null && parsed > spec.maximum) {
      return { ok: false, error: `${name} must be at most ${spec.maximum}.` }
    }
    out[name] = parsed
  }

  return { ok: true, value: out }
}

export function stringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name]
  return typeof value === "string" ? value : undefined
}

export function numberArg(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function boolArg(args: Record<string, unknown>, name: string): boolean | undefined {
  const value = args[name]
  return typeof value === "boolean" ? value : undefined
}
