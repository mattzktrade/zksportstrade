"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { channelLabel, type InboxThreadMessage } from "@/lib/assistant/inbox"
import {
  closeAssistantConversation,
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
  displayName,
  email,
  phone,
  dealId,
  dealReference,
  outreachLabel,
  messages,
  draft,
  loading = false,
  onChanged,
}: {
  conversationId: string
  status: string
  channel: string
  canSendWhatsApp: boolean
  displayName: string
  email: string | null
  phone: string | null
  dealId: string | null
  dealReference: string | null
  outreachLabel: string | null
  messages: InboxThreadMessage[]
  draft: { id: string; body: string; intent: string } | null
  loading?: boolean
  onChanged?: () => void
}) {
  const [pending, start] = useTransition()
  const [body, setBody] = useState(draft?.body ?? "")
  const [question, setQuestion] = useState("")
  const scroller = useRef<HTMLDivElement | null>(null)
  const whatsappWindowClosed = channel === "whatsapp" && !canSendWhatsApp

  useEffect(() => {
    setBody(draft?.body ?? "")
  }, [conversationId, draft?.id, draft?.body])

  useEffect(() => {
    const node = scroller.current
    if (node) node.scrollTop = node.scrollHeight
  }, [conversationId, messages.length])

  function send() {
    start(async () => {
      const result = await sendAssistantDraft({ conversationId, body })
      if (result.ok) {
        toast.success("Sent.")
        setBody("")
        onChanged?.()
      } else toast.error(result.message)
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-[#18191c]">{displayName}</p>
          <p className="mt-0.5 truncate text-[11px] text-[#80848d]">
            {channelLabel(channel)}
            {phone ? ` · +${phone.replace(/^\+/, "")}` : ""}
            {email ? ` · ${email}` : ""}
          </p>
          {outreachLabel ? <p className="mt-1 text-[11px] font-medium text-slate-600">{outreachLabel}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {dealId ? (
            <Link
              href={`/admin/enquiries?enquiry=${dealId}`}
              className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium"
            >
              {dealReference || "Enquiry"}
            </Link>
          ) : null}
          {status === "closed" ? (
            <button
              type="button"
              disabled={pending}
              className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-50"
              onClick={() =>
                start(async () => {
                  const result = await resumeAssistantConversation(conversationId)
                  if (result.ok) {
                    toast.success("Thread reopened.")
                    onChanged?.()
                  } else toast.error(result.message)
                })
              }
            >
              Reopen
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-50"
              onClick={() =>
                start(async () => {
                  const result = await closeAssistantConversation(conversationId)
                  if (result.ok) {
                    toast.success("Marked done.")
                    onChanged?.()
                  } else toast.error(result.message)
                })
              }
            >
              Done
            </button>
          )}
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
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
                {new Date(message.createdAt).toLocaleString("en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
              {message.hasMedia && message.mediaHref ? (
                <div className="mt-2">
                  <InboxMedia message={message} />
                </div>
              ) : null}
              {message.body && message.body !== message.mediaFilename ? (
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-[#1b1c1f]">{message.body}</p>
              ) : !message.hasMedia ? (
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-[#1b1c1f]">
                  {message.body || `(${message.mediaType || "empty"})`}
                </p>
              ) : null}
            </div>
          )
        })}
        {messages.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-[#9aa0a6]">
            {loading ? "Loading messages…" : "No messages in this thread yet."}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-border px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
        {whatsappWindowClosed ? (
          <p className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            They have not written back in the last 24 hours, so WhatsApp may refuse this. You can still send — we will
            tell you if it does not go through.
          </p>
        ) : null}
        {draft?.body && body === draft.body ? (
          <p className="mb-2 text-[11px] font-medium text-emerald-700">Suggested reply — edit it, then send.</p>
        ) : null}
        <textarea
          className="min-h-[72px] w-full rounded-md border border-border p-2 text-[13px] sm:min-h-[110px]"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={channel === "email" ? "Write an email reply" : "Write a WhatsApp message"}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault()
              if (!pending && body.trim()) send()
            }
          }}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending || !body.trim()}
            className="rounded-md bg-[#18191c] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            onClick={send}
          >
            Send
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            onClick={() =>
              start(async () => {
                const result = await runAssistantNow(conversationId)
                if (!result.ok) {
                  toast.error(result.message)
                  return
                }
                if (result.draft) {
                  setBody(result.draft)
                  toast.success("Draft ready to edit.")
                } else toast.success(result.reason)
                onChanged?.()
              })
            }
          >
            Draft with AI
          </button>
          <span className="hidden text-[10px] text-[#9aa0a6] sm:inline">Ctrl+Enter to send</span>
        </div>
        <details className="mt-3 text-[13px]">
          <summary className="cursor-pointer text-[11px] font-medium text-[#80848d]">More</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {status === "human_takeover" ? (
              <button
                type="button"
                disabled={pending}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium"
                onClick={() =>
                  start(async () => {
                    const result = await resumeAssistantConversation(conversationId)
                    if (result.ok) {
                      toast.success("Assistant can draft again.")
                      onChanged?.()
                    } else toast.error(result.message)
                  })
                }
              >
                Let assistant draft
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium"
                onClick={() =>
                  start(async () => {
                    const result = await takeOverAssistantConversation(conversationId)
                    if (result.ok) {
                      toast.success("You have this conversation.")
                      onChanged?.()
                    } else toast.error(result.message)
                  })
                }
              >
                I will handle this
              </button>
            )}
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
          </div>
          <div className="mt-3">
            <p className="text-[11px] font-medium text-[#4b5058]">Save this answer for next time</p>
            <input
              className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-[13px]"
              placeholder="Question they asked"
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
              Save to knowledge
            </button>
          </div>
        </details>
      </div>
    </div>
  )
}

function InboxMedia({ message }: { message: InboxThreadMessage }) {
  const href = message.mediaHref
  if (!href) return null
  const label = message.mediaFilename || message.mediaType || "file"
  const kind = message.mediaType

  if (kind === "image" || kind === "sticker") {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={href}
          alt={label}
          className="max-h-72 max-w-full rounded-lg border border-[#ece8df] bg-white object-contain"
        />
      </a>
    )
  }

  if (kind === "video") {
    return (
      <video
        src={href}
        controls
        className="max-h-72 max-w-full rounded-lg border border-[#ece8df] bg-black"
      >
        <a href={href} target="_blank" rel="noreferrer" className="text-[12px] text-[#b42318] underline">
          Open {label}
        </a>
      </video>
    )
  }

  if (kind === "audio") {
    return (
      <audio src={href} controls className="w-full max-w-sm">
        <a href={href} target="_blank" rel="noreferrer" className="text-[12px] text-[#b42318] underline">
          Open {label}
        </a>
      </audio>
    )
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-md border border-[#ece8df] bg-white px-3 py-2 text-[12px] font-medium text-[#1b1c1f] hover:bg-[#faf8f4]"
    >
      Open {label}
    </a>
  )
}
