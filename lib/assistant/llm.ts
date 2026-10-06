import { DEFAULT_SALES_POLICY_BODY } from "@/lib/assistant/knowledge"
import { ASSISTANT_INTENTS, type AssistantIntent, type AssistantLlmResult, type AssistantToolTrace } from "@/lib/assistant/types"
import { ASSISTANT_TOOL_DEFINITIONS, executeAssistantTool, emptyToolFacts, mergeFacts, type AssistantToolContext } from "@/lib/assistant/tools"

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content?: string | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }>
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || "{}") as unknown
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function asIntent(value: unknown): AssistantIntent {
  return ASSISTANT_INTENTS.includes(value as AssistantIntent) ? (value as AssistantIntent) : "unclear"
}

function clip(text: string, max = 1800): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max).trim()}`
}

export function buildAssistantSystemPrompt(input: {
  policy: string
  styleExamples: string[]
  clientName: string
}): string {
  const examples =
    input.styleExamples.length > 0
      ? `How we have spoken to this client before:\n${input.styleExamples.map((item) => `- ${item}`).join("\n")}`
      : "No saved style examples yet. Keep replies short, warm, and specific. Do not sound like a generic chatbot."
  return `You are the ZK Sports sales assistant writing WhatsApp and email replies that sound like the ZK team.

${input.policy.trim() || DEFAULT_SALES_POLICY_BODY}

${examples}

The client is ${input.clientName || "a client"}.

Rules:
- Call tools for stock, product copy, FAQs, and client history. Do not invent facts.
- Never invent inclusions, itineraries, partner logos, prices, or on-ground contacts.
- Do not quote a price unless a tool returned it on this deal or published trade prices were returned.
- If stock is zero, say we need to check sourcing. Never promise we can get it.
- If they can book on the portal, say so. Do not send a booking form yourself.
- If you are unsure, set needs_human true and still draft a careful holding reply.
- Reply in British English. No markdown. No "as an AI".

After tools, return a compact JSON object as the entire assistant message:
{"reply":"...","confidence":0.0,"intent":"answer|quote|source|book|portal|unclear","package_ids":[],"needs_human":false,"reason":"..."}`
}

export function parseAssistantJson(content: string): Omit<AssistantLlmResult, "toolTrace" | "model"> | null {
  const trimmed = content.trim()
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
    const reply = typeof parsed.reply === "string" ? clip(parsed.reply) : ""
    if (!reply) return null
    const confidence = Number(parsed.confidence)
    return {
      reply,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.4,
      intent: asIntent(parsed.intent),
      packageIds: Array.isArray(parsed.package_ids) ? parsed.package_ids.map((id) => String(id)) : [],
      needsHuman: Boolean(parsed.needs_human),
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    }
  } catch {
    return null
  }
}

export async function completeAssistantTurn(input: {
  ctx: AssistantToolContext
  system: string
  user: string
}): Promise<AssistantLlmResult> {
  const apiKey = process.env.ASSISTANT_LLM_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || ""
  const model = process.env.ASSISTANT_LLM_MODEL?.trim() || "gpt-4o"
  const base = (process.env.ASSISTANT_LLM_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "")
  if (!apiKey) {
    return {
      reply: "Thanks for this — I am checking with the team and will come back to you shortly.",
      confidence: 0,
      intent: "unclear",
      packageIds: [],
      needsHuman: true,
      reason: "Language model is not configured.",
      toolTrace: [],
      model: "none",
    }
  }

  const messages: ChatMessage[] = [
    { role: "system", content: input.system },
    { role: "user", content: input.user },
  ]
  const traces: AssistantToolTrace[] = []
  let facts = emptyToolFacts()

  for (let round = 0; round < 6; round += 1) {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages,
        tools: ASSISTANT_TOOL_DEFINITIONS,
        tool_choice: round === 0 ? "auto" : "auto",
      }),
    })
    const raw = await response.text()
    if (!response.ok) {
      throw new Error(raw.slice(0, 400) || `LLM HTTP ${response.status}`)
    }
    const parsed = JSON.parse(raw) as {
      choices?: Array<{ message?: ChatMessage }>
    }
    const message = parsed.choices?.[0]?.message
    if (!message) throw new Error("The language model returned an empty reply.")
    const toolCalls = message.tool_calls ?? []
    if (toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: message.content ?? "",
        tool_calls: toolCalls,
      })
      for (const call of toolCalls) {
        const args = parseArgs(call.function.arguments)
        const executed = await executeAssistantTool(input.ctx, call.function.name, args)
        facts = mergeFacts(facts, executed.facts)
        traces.push({ name: call.function.name, arguments: args, result: executed.result })
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(executed.result).slice(0, 8000),
        })
      }
      continue
    }
    const content = message.content?.trim() || ""
    const json = parseAssistantJson(content)
    if (json) {
      return { ...json, packageIds: json.packageIds.length ? json.packageIds : facts.packageIds, toolTrace: traces, model }
    }
    if (content) {
      return {
        reply: clip(content),
        confidence: 0.55,
        intent: "answer",
        packageIds: facts.packageIds,
        needsHuman: true,
        reason: "Model did not return structured JSON.",
        toolTrace: traces,
        model,
      }
    }
    break
  }

  return {
    reply: "Thanks for this — I am checking with the team and will come back to you shortly.",
    confidence: 0,
    intent: "unclear",
    packageIds: facts.packageIds,
    needsHuman: true,
    reason: "The language model did not finish a reply.",
    toolTrace: traces,
    model,
  }
}
