"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { saveKnowledgeArticleAction } from "./actions"

export function KnowledgeEditor() {
  const [pending, start] = useTransition()
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")

  return (
    <form
      className="space-y-2 rounded-xl border border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault()
        start(async () => {
          const result = await saveKnowledgeArticleAction({ title, body, category: "faq" })
          if (result.ok) {
            toast.success("Article saved.")
            setTitle("")
            setBody("")
          } else toast.error(result.message)
        })
      }}
    >
      <p className="text-[13px] font-semibold">Add a company FAQ</p>
      <input
        className="w-full rounded-md border border-border px-2 py-1.5 text-[13px]"
        placeholder="Title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <textarea
        className="min-h-[100px] w-full rounded-md border border-border px-2 py-1.5 text-[13px]"
        placeholder="Answer — only facts we are happy to repeat."
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <button
        type="submit"
        disabled={pending || !title.trim() || !body.trim()}
        className="rounded-md bg-[#18191c] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        Save article
      </button>
    </form>
  )
}
