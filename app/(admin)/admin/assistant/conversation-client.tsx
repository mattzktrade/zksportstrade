"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  prepareAssistantBookingForm,
  resumeAssistantConversation,
  runAssistantNow,
  saveAssistantKnowledge,
  sendAssistantDraft,
  takeOverAssistantConversation,
} from "./actions"

export function AssistantConversationClient({
  conversationId,
  status,
  dealId,
  dealReference,
  messages,
  draft,
}: {
  conversationId: string
  status: string
  dealId: string | null
  dealReference: string | null
  messages: Array<{ id: string; direction: string; sentBy: string; body: string; mediaType: string | null; createdAt: string }>
  draft: { id: string; body: string; intent: string } | null
}) {
  const [pending, start] = useTransition()
  const [body, setBody] = useState(draft?.body ?? "")
  const [question, setQuestion] = useState("")

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]">
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="max-h-[52vh] space-y-2 overflow-y-auto">
          {messages.map((message) => (
            <div
              key={message.id}
              className={message.direction === "inbound" ? "mr-10 rounded-lg bg-slate-50 p-3" : "ml-10 rounded-lg bg-red-50 p-3"}
            >
              <p className="text-[10px] font-medium uppercase tracking-wide text-[#8b9198]">
                {message.sentBy} · {new Date(message.createdAt).toLocaleString("en-GB")}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[13px] text-[#1b1c1f]">{message.body || `(${message.mediaType || "empty"})`}</p>
            </div>
          ))}
          {messages.length === 0 ? <p className="text-[12px] text-[#9aa0a6]">No messages yet. Draft a reply from the enquiry if you want a first message.</p> : null}
        </div>
        <textarea
          className="min-h-[120px] w-full rounded-md border border-border p-2 text-[13px]"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Draft reply"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            className="rounded-md bg-[#18191c] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            onClick={() =>
              start(async () => {
                const result = await sendAssistantDraft({ conversationId, body })
                if (result.ok) toast.success("Sent.")
                else toast.error(result.message)
              })
            }
          >
            Send
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium"
            onClick={() =>
              start(async () => {
                const result = await runAssistantNow(conversationId)
                if (result.ok) toast.success(result.reason)
                else toast.error(result.message)
              })
            }
          >
            Draft with assistant
          </button>
          {status === "human_takeover" ? (
            <button
              type="button"
              disabled={pending}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium"
              onClick={() =>
                start(async () => {
                  const result = await resumeAssistantConversation(conversationId)
                  if (result.ok) toast.success("Assistant resumed.")
                  else toast.error(result.message)
                })
              }
            >
              Resume assistant
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium"
              onClick={() =>
                start(async () => {
                  const result = await takeOverAssistantConversation(conversationId)
                  if (result.ok) toast.success("You have this conversation.")
                  else toast.error(result.message)
                })
              }
            >
              Take over
            </button>
          )}
        </div>
      </div>
      <aside className="space-y-3">
        <div className="rounded-xl border border-border bg-card p-4 text-[13px]">
          <p className="font-semibold">CRM</p>
          {dealId ? (
            <p className="mt-2">
              Enquiry{" "}
              <Link className="text-primary underline" href={`/admin/enquiries?enquiry=${dealId}`}>
                {dealReference || dealId}
              </Link>
            </p>
          ) : (
            <p className="mt-2 text-muted-foreground">No enquiry linked yet.</p>
          )}
          <button
            type="button"
            disabled={pending || !dealId}
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            onClick={() =>
              start(async () => {
                const result = await prepareAssistantBookingForm(conversationId)
                if (result.ok) toast.success(result.message)
                else toast.error(result.message)
              })
            }
          >
            Prepare booking form for admin send
          </button>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-[13px]">
          <p className="font-semibold">Save this Q&A</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Only staff-approved answers enter the knowledge base.</p>
          <input
            className="mt-2 w-full rounded-md border border-border px-2 py-1.5 text-[13px]"
            placeholder="Question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button
            type="button"
            disabled={pending}
            className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium"
            onClick={() =>
              start(async () => {
                const result = await saveAssistantKnowledge({
                  conversationId,
                  question: question || "Client question",
                  answer: body,
                })
                if (result.ok) toast.success(result.message)
                else toast.error(result.message)
              })
            }
          >
            Save to knowledge base
          </button>
        </div>
      </aside>
    </div>
  )
}
