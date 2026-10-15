"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { channelLabel } from "@/lib/assistant/inbox"
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
  channel,
  canSendWhatsApp,
  dealId,
  dealReference,
  messages,
  draft,
}: {
  conversationId: string
  status: string
  channel: string
  canSendWhatsApp: boolean
  dealId: string | null
  dealReference: string | null
  messages: Array<{
    id: string
    direction: string
    sentBy: string
    channel: string
    body: string
    mediaType: string | null
    createdAt: string
  }>
  draft: { id: string; body: string; intent: string } | null
}) {
  const [pending, start] = useTransition()
  const [body, setBody] = useState(draft?.body ?? "")
  const [question, setQuestion] = useState("")
  const whatsappBlocked = channel === "whatsapp" && !canSendWhatsApp

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]">
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="max-h-[58vh] space-y-2 overflow-y-auto">
          {messages.map((message) => {
            const outbound = message.direction === "outbound"
            return (
              <div
                key={message.id}
                className={
                  outbound
                    ? "ml-8 rounded-lg bg-red-50 p-3 sm:ml-16"
                    : "mr-8 rounded-lg bg-slate-50 p-3 sm:mr-16"
                }
              >
                <p className="text-[10px] font-medium uppercase tracking-wide text-[#8b9198]">
                  {outbound ? "You" : "Them"} · {channelLabel(message.channel)} ·{" "}
                  {new Date(message.createdAt).toLocaleString("en-GB")}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-[#1b1c1f]">
                  {message.body || `(${message.mediaType || "empty"})`}
                </p>
              </div>
            )
          })}
          {messages.length === 0 ? (
            <p className="text-[13px] text-[#9aa0a6]">No messages in this thread yet.</p>
          ) : null}
        </div>
        {whatsappBlocked ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            WhatsApp will let you type a free reply after they message back. Until then, wait for their reply or send
            the next follow-up from Sales → Templates.
          </p>
        ) : null}
        <textarea
          className="min-h-[120px] w-full rounded-md border border-border p-2 text-[13px]"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={channel === "email" ? "Write an email reply" : "Write a WhatsApp reply"}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending || whatsappBlocked}
            className="rounded-md bg-[#18191c] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            onClick={() =>
              start(async () => {
                const result = await sendAssistantDraft({ conversationId, body })
                if (result.ok) {
                  toast.success("Sent.")
                  setBody("")
                } else toast.error(result.message)
              })
            }
          >
            Send
          </button>
        </div>
      </div>
      <aside className="space-y-3">
        <div className="rounded-xl border border-border bg-card p-4 text-[13px]">
          <p className="font-semibold">Enquiry</p>
          {dealId ? (
            <p className="mt-2">
              <Link className="text-primary underline" href={`/admin/enquiries?enquiry=${dealId}`}>
                {dealReference || "Open enquiry"}
              </Link>
            </p>
          ) : (
            <p className="mt-2 text-muted-foreground">No enquiry linked yet.</p>
          )}
        </div>
        <details className="rounded-xl border border-border bg-card p-4 text-[13px]">
          <summary className="cursor-pointer font-semibold">More tools</summary>
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
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
                Draft a reply
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
            <button
              type="button"
              disabled={pending || !dealId}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              onClick={() =>
                start(async () => {
                  const result = await prepareAssistantBookingForm(conversationId)
                  if (result.ok) toast.success(result.message)
                  else toast.error(result.message)
                })
              }
            >
              Prepare booking form
            </button>
            <div>
              <p className="font-medium">Save this Q&A</p>
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
          </div>
        </details>
      </aside>
    </div>
  )
}
