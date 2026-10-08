"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  issuePackageWalkUpTicket,
  loadPackageWalkUpTickets,
  sendPackageWalkUpTicket,
  voidPackageWalkUpTicket,
  type WalkUpTicketView,
} from "@/app/(admin)/admin/catalog/guest-list-actions"
import { costDaySlotsForDuration } from "@/lib/inventory/day-cost-allocation"
import { parseTicketingMode, ticketKindForMode, validDayLabels } from "@/lib/tickets/model"
import { cn } from "@/lib/utils"

const DAY_LABEL: Record<string, string> = {
  thursday_only: "Thu",
  friday_only: "Fri",
  saturday_only: "Sat",
  sunday_only: "Sun",
}

export function PackageWalkUpTickets({
  packageId,
  eventDate,
  duration,
  ticketingMode,
  canManage,
}: {
  packageId: string
  eventDate: string | null
  duration: string | null
  ticketingMode: string | null
  canManage: boolean
}) {
  const [pending, start] = useTransition()
  const [tickets, setTickets] = useState<WalkUpTicketView[]>([])
  const [open, setOpen] = useState(false)
  const [holderName, setHolderName] = useState("")
  const [email, setEmail] = useState("")
  const packageDays = costDaySlotsForDuration(duration, eventDate)
  const [days, setDays] = useState<string[]>(packageDays)

  const mode = parseTicketingMode(ticketingMode) ?? "supplier_direct"
  const canIssue = Boolean(ticketKindForMode(mode) === "zk_digital")

  function refresh() {
    start(async () => {
      const loaded = await loadPackageWalkUpTickets(packageId)
      if (!loaded.ok) {
        toast.error(loaded.message)
        return
      }
      setTickets(loaded.tickets)
    })
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId])

  if (!canIssue && tickets.length === 0) return null

  return (
    <section className="rounded-xl border border-[#eceef1] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[12px] font-semibold">Walk-up / emergency tickets</h3>
          <p className="mt-1 max-w-xl text-[11px] leading-snug text-[#5f636b]">
            Issue a ZK pass with no guest row attached — last-minute names, a lost phone, or a one-off extra. Copy the
            link or email it. It still scans at check-in.
          </p>
        </div>
        {canManage && canIssue ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="h-9 rounded-md bg-primary px-3 text-[11px] font-semibold text-white"
          >
            {open ? "Cancel" : "Create walk-up ticket"}
          </button>
        ) : null}
      </div>

      {!canIssue ? (
        <p className="mt-3 text-[11px] text-amber-700">
          This product is not set to ZK digital / hybrid, so we cannot mint a door pass here.
        </p>
      ) : null}

      {open && canManage && canIssue ? (
        <form
          className="mt-4 grid gap-3 rounded-lg border border-[#eceef1] bg-[#fafbfc] p-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            start(async () => {
              const result = await issuePackageWalkUpTicket({
                packageId,
                holderName,
                email,
                validDays: days,
              })
              if (!result.ok) {
                toast.error(result.message)
                return
              }
              toast.success(result.message)
              setHolderName("")
              setEmail("")
              setOpen(false)
              setTickets((current) => [result.ticket, ...current])
            })
          }}
        >
          <label className="block text-[10px] font-semibold text-[#5f636b]">
            Name on the pass (optional)
            <input
              value={holderName}
              onChange={(event) => setHolderName(event.target.value)}
              placeholder="Leave blank for Walk-up guest"
              className="mt-1 h-9 w-full rounded-md border bg-white px-3 text-[11px]"
            />
          </label>
          <label className="block text-[10px] font-semibold text-[#5f636b]">
            Email now (optional)
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="They get the link immediately"
              className="mt-1 h-9 w-full rounded-md border bg-white px-3 text-[11px]"
            />
          </label>
          {packageDays.length > 1 ? (
            <fieldset className="sm:col-span-2">
              <legend className="text-[10px] font-semibold text-[#5f636b]">Valid days</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {packageDays.map((day) => (
                  <label key={day} className="inline-flex items-center gap-1.5 text-[11px]">
                    <input
                      type="checkbox"
                      checked={days.includes(day)}
                      onChange={(event) =>
                        setDays((current) =>
                          event.target.checked ? [...current, day] : current.filter((item) => item !== day),
                        )
                      }
                    />
                    {DAY_LABEL[day] ?? day}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="h-9 rounded-md bg-primary px-4 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Creating…" : "Issue ticket"}
            </button>
          </div>
        </form>
      ) : null}

      {tickets.length > 0 ? (
        <ul className="mt-4 divide-y rounded-lg border border-[#eceef1]">
          {tickets.map((ticket) => (
            <WalkUpRow
              key={ticket.id}
              ticket={ticket}
              canManage={canManage}
              pending={pending}
              onChange={refresh}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[11px] text-[#92969e]">No walk-up tickets yet.</p>
      )}
    </section>
  )
}

function WalkUpRow({
  ticket,
  canManage,
  pending,
  onChange,
}: {
  ticket: WalkUpTicketView
  canManage: boolean
  pending: boolean
  onChange: () => void
}) {
  const [email, setEmail] = useState("")
  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-[12px] font-semibold">{ticket.holderName || "Walk-up guest"}</p>
        <p className="text-[10px] text-[#5f636b]">
          {ticket.shortCode} · {ticket.daysLabel || validDayLabels([])} · {ticket.status}
        </p>
      </div>
      {canManage ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            className="h-8 rounded-md border px-2 text-[10px] font-semibold"
            onClick={() => {
              void navigator.clipboard.writeText(ticket.publicUrl)
              toast.success("Link copied")
            }}
          >
            Copy link
          </button>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email…"
            className={cn("h-8 min-w-0 flex-1 rounded-md border px-2 text-[10px] sm:w-40 sm:flex-none")}
          />
          <button
            type="button"
            disabled={pending || !email.trim()}
            className="h-8 rounded-md border px-2 text-[10px] font-semibold disabled:opacity-40"
            onClick={() =>
              void sendPackageWalkUpTicket({ ticketId: ticket.id, email }).then((result) => {
                if (!result.ok) toast.error(result.message)
                else {
                  toast.success(result.message)
                  setEmail("")
                }
              })
            }
          >
            Send
          </button>
          <button
            type="button"
            disabled={pending}
            className="h-8 text-[10px] font-semibold text-red-600"
            onClick={() => {
              const reason = window.prompt("Void this walk-up ticket?") ?? ""
              if (!reason.trim()) return
              void voidPackageWalkUpTicket({ ticketId: ticket.id, reason }).then((result) => {
                if (!result.ok) toast.error(result.message)
                else {
                  toast.success(result.message)
                  onChange()
                }
              })
            }}
          >
            Void
          </button>
        </div>
      ) : null}
    </li>
  )
}
