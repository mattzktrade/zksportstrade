"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { updateAssistantSettingsAction } from "./actions"

export function AssistantSettingsForm(props: {
  autoSendEnabled: boolean
  killSwitch: boolean
  allowPublishedTradePrices: boolean
  notifyEmails: string
  debounceSeconds: number
}) {
  const [pending, start] = useTransition()
  const [autoSend, setAutoSend] = useState(props.autoSendEnabled)
  const [kill, setKill] = useState(props.killSwitch)
  const [prices, setPrices] = useState(props.allowPublishedTradePrices)
  const [emails, setEmails] = useState(props.notifyEmails)
  const [debounce, setDebounce] = useState(String(props.debounceSeconds))

  return (
    <form
      className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm"
      onSubmit={(event) => {
        event.preventDefault()
        start(async () => {
          const result = await updateAssistantSettingsAction({
            autoSendEnabled: autoSend,
            killSwitch: kill,
            allowPublishedTradePrices: prices,
            notifyEmails: emails,
            debounceSeconds: Number(debounce) || 20,
          })
          if (result.ok) toast.success("Assistant settings saved.")
          else toast.error(result.message)
        })
      }}
    >
      <p className="font-semibold">Assistant controls</p>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={kill} onChange={(event) => setKill(event.target.checked)} />
        Kill switch — store inbound, never auto-send
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={autoSend} onChange={(event) => setAutoSend(event.target.checked)} />
        Auto-send high-confidence replies
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={prices} onChange={(event) => setPrices(event.target.checked)} />
        Allow quoting published trade prices
      </label>
      <label className="block text-[12px] text-muted-foreground">
        Notify
        <input
          className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-[13px] text-foreground"
          value={emails}
          onChange={(event) => setEmails(event.target.value)}
        />
      </label>
      <label className="block text-[12px] text-muted-foreground">
        Debounce seconds
        <input
          className="mt-1 w-24 rounded-md border border-border px-2 py-1.5 text-[13px] text-foreground"
          value={debounce}
          onChange={(event) => setDebounce(event.target.value)}
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[#18191c] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        Save settings
      </button>
    </form>
  )
}
