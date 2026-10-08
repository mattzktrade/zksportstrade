"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  assignBookingPhysicalSerial,
  collectBookingPhysicalTicket,
  issueBookingTickets,
  loadBookingTickets,
  markBookingTicketsCopied,
  postBookingPhysicalTickets,
  receiveBookingPhysicalTickets,
  reissueBookingTicket,
  saveBookingTicketMode,
  sendBookingTickets,
  type TicketBoardRow,
} from "@/app/(admin)/admin/operations/ticket-actions"
import { TICKETING_MODES, type TicketingMode } from "@/lib/tickets/types"
import { ticketingModeLabel } from "@/lib/tickets/model"
import type { TicketGuestRow } from "@/lib/tickets/store"

export function OperationsTicketsPanel({
  dealId,
  orderId,
  canManage,
  stepNumber = 5,
  onModeChange,
}: {
  dealId: string | null
  orderId: string | null
  canManage: boolean
  stepNumber?: number
  onModeChange?: (mode: TicketingMode) => void
}) {
  const [pending, start] = useTransition()
  const [mode, setMode] = useState<TicketingMode>("supplier_direct")
  const [tickets, setTickets] = useState<TicketBoardRow[]>([])
  const [guests, setGuests] = useState<TicketGuestRow[]>([])
  const [quantity, setQuantity] = useState(0)
  const [emailGuests, setEmailGuests] = useState(false)
  const [serials, setSerials] = useState<Record<string, string>>({})
  const [guestForTicket, setGuestForTicket] = useState<Record<string, string>>({})
  const [tracking, setTracking] = useState("")
  const [error, setError] = useState<string | null>(null)

  function refresh() {
    start(async () => {
      const result = await loadBookingTickets({ dealId, orderId })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setError(null)
      setMode(result.mode)
      onModeChange?.(result.mode)
      setTickets(result.tickets)
      setGuests(result.guests)
      setQuantity(result.quantity)
    })
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, orderId])

  const live = useMemo(() => tickets.filter((row) => !row.voided), [tickets])
  const digital = live.filter((row) => row.kind !== "physical")
  const physical = live.filter((row) => row.kind === "physical")
  const unassignedGuests = guests.filter(
    (guest) => guest.fullName && !live.some((ticket) => ticket.guestId === guest.id && ticket.guestSource === guest.source),
  )

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    start(async () => {
      const result = await action()
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      refresh()
    })
  }

  return (
    <section className="min-w-0 overflow-x-auto rounded-lg border bg-white p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[12px] font-semibold">{stepNumber}. Tickets</h3>
          <p className="mt-1 break-words text-[11px] text-slate-500">
            Issue, send, or collect here. Digital send marks the booking delivered. Door staff use Check-in.
          </p>
        </div>
        <Link href="/admin/check-in" className="shrink-0 text-[11px] font-semibold text-primary">
          Open check-in
        </Link>
      </div>

      {error ? <p className="mt-3 text-[11px] text-amber-700">{error}</p> : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-medium text-slate-600">
          Mode
          <select
            value={mode}
            disabled={!canManage || pending}
            onChange={(event) => {
              const next = event.target.value as TicketingMode
              setMode(next)
              onModeChange?.(next)
              run(() => saveBookingTicketMode({ dealId, orderId, mode: next }))
            }}
            className="mt-1 block h-9 w-full min-w-0 max-w-full rounded-md border bg-white px-2 sm:w-64"
          >
            {TICKETING_MODES.map((value) => (
              <option key={value} value={value}>
                {ticketingModeLabel(value)}
              </option>
            ))}
          </select>
        </label>
        {canManage && mode !== "supplier_direct" && mode !== "physical" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => issueBookingTickets({ dealId, orderId, mode }))}
            className="h-9 rounded-md bg-primary px-4 text-[11px] font-semibold text-white"
          >
            Issue tickets for named guests
          </button>
        ) : null}
        {canManage && (mode === "physical" || mode === "hybrid") ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => receiveBookingPhysicalTickets({ dealId, orderId, count: Math.max(1, quantity - physical.length) }))
            }
            className="h-9 rounded-md border px-3 text-[11px] font-semibold"
          >
            Receive physical stock
          </button>
        ) : null}
      </div>

      {live.length === 0 ? (
        <p className="mt-4 text-[11px] text-slate-400">No tickets issued yet.</p>
      ) : (
        <>
        <div className="mt-4 space-y-3 md:hidden">
          {live.map((ticket) => (
            <div key={ticket.id} className="min-w-0 space-y-2 rounded-md border p-3 text-[11px]">
              <p className="break-words font-medium">{ticket.guestName}</p>
              {ticket.guestEmail ? <p className="break-all text-slate-400">{ticket.guestEmail}</p> : null}
              {ticket.physicalSerial ? <p className="text-slate-500">Serial {ticket.physicalSerial}</p> : null}
              <p className="font-mono text-slate-600">{ticket.shortCode}</p>
              <p className="capitalize text-slate-500">{ticket.status.replace("_", " ")}</p>
              <div className="flex flex-wrap gap-2">
                {ticket.publicUrl && ticket.kind !== "physical" ? (
                  <button
                    type="button"
                    className="font-semibold text-primary"
                    onClick={() => {
                      void navigator.clipboard.writeText(ticket.publicUrl)
                      toast.success("Link copied")
                    }}
                  >
                    Copy link
                  </button>
                ) : null}
                {ticket.kind === "physical" && !ticket.physicalSerial && canManage ? (
                  <span className="flex min-w-0 flex-wrap items-center gap-1">
                    <select
                      value={guestForTicket[ticket.id] ?? ""}
                      onChange={(event) =>
                        setGuestForTicket((current) => ({ ...current, [ticket.id]: event.target.value }))
                      }
                      className="h-8 min-w-0 flex-1 rounded border px-1"
                    >
                      <option value="">Guest</option>
                      {unassignedGuests.map((guest) => (
                        <option key={`${guest.source}:${guest.id}`} value={`${guest.source}:${guest.id}`}>
                          {guest.fullName}
                        </option>
                      ))}
                    </select>
                    <input
                      value={serials[ticket.id] ?? ""}
                      onChange={(event) => setSerials((current) => ({ ...current, [ticket.id]: event.target.value }))}
                      placeholder="Serial"
                      className="h-8 w-full min-w-0 rounded border px-2"
                    />
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        const selected = guestForTicket[ticket.id]?.split(":") ?? []
                        if (selected.length !== 2) {
                          toast.error("Pick a guest")
                          return
                        }
                        run(() =>
                          assignBookingPhysicalSerial({
                            dealId,
                            ticketId: ticket.id,
                            guestSource: selected[0] as "order" | "deal",
                            guestId: selected[1]!,
                            serial: serials[ticket.id] ?? "",
                          }),
                        )
                      }}
                      className="font-semibold text-primary"
                    >
                      Assign
                    </button>
                  </span>
                ) : null}
                {ticket.kind === "physical" && ticket.status !== "delivered" && canManage ? (
                  <button
                    type="button"
                    className="font-semibold text-primary"
                    onClick={() => run(() => collectBookingPhysicalTicket({ dealId, orderId, ticketId: ticket.id }))}
                  >
                    Collected
                  </button>
                ) : null}
                {canManage ? (
                  <button
                    type="button"
                    className="text-slate-500"
                    onClick={() => {
                      const reason = window.prompt("Void reason (name change, lost phone…)") ?? ""
                      if (!reason.trim()) return
                      run(() => reissueBookingTicket({ dealId, ticketId: ticket.id, reason }))
                    }}
                  >
                    Void / reissue
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 hidden min-w-0 overflow-x-auto md:block">
          <table className="w-full min-w-[480px] text-left text-[11px]">
            <thead className="text-[8px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-2 pr-3">Guest</th>
                <th className="py-2 pr-3">Code</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {live.map((ticket) => (
                <tr key={ticket.id}>
                  <td className="py-2 pr-3">
                    <p className="font-medium">{ticket.guestName}</p>
                    {ticket.guestEmail ? <p className="text-slate-400">{ticket.guestEmail}</p> : null}
                    {ticket.physicalSerial ? <p className="text-slate-500">Serial {ticket.physicalSerial}</p> : null}
                  </td>
                  <td className="py-2 pr-3 font-mono">{ticket.shortCode}</td>
                  <td className="py-2 pr-3 capitalize">{ticket.status.replace("_", " ")}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      {ticket.publicUrl && ticket.kind !== "physical" ? (
                        <button
                          type="button"
                          className="font-semibold text-primary"
                          onClick={() => {
                            void navigator.clipboard.writeText(ticket.publicUrl)
                            toast.success("Link copied")
                          }}
                        >
                          Copy link
                        </button>
                      ) : null}
                      {ticket.kind === "physical" && !ticket.physicalSerial && canManage ? (
                        <span className="flex flex-wrap items-center gap-1">
                          <select
                            value={guestForTicket[ticket.id] ?? ""}
                            onChange={(event) =>
                              setGuestForTicket((current) => ({ ...current, [ticket.id]: event.target.value }))
                            }
                            className="h-8 rounded border px-1"
                          >
                            <option value="">Guest</option>
                            {unassignedGuests.map((guest) => (
                              <option key={`${guest.source}:${guest.id}`} value={`${guest.source}:${guest.id}`}>
                                {guest.fullName}
                              </option>
                            ))}
                          </select>
                          <input
                            value={serials[ticket.id] ?? ""}
                            onChange={(event) => setSerials((current) => ({ ...current, [ticket.id]: event.target.value }))}
                            placeholder="Serial"
                            className="h-8 w-24 rounded border px-2"
                          />
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              const selected = guestForTicket[ticket.id]?.split(":") ?? []
                              if (selected.length !== 2) {
                                toast.error("Pick a guest")
                                return
                              }
                              run(() =>
                                assignBookingPhysicalSerial({
                                  dealId,
                                  ticketId: ticket.id,
                                  guestSource: selected[0] as "order" | "deal",
                                  guestId: selected[1]!,
                                  serial: serials[ticket.id] ?? "",
                                }),
                              )
                            }}
                            className="font-semibold text-primary"
                          >
                            Assign
                          </button>
                        </span>
                      ) : null}
                      {ticket.kind === "physical" && ticket.status !== "delivered" && canManage ? (
                        <button
                          type="button"
                          className="font-semibold text-primary"
                          onClick={() => run(() => collectBookingPhysicalTicket({ dealId, orderId, ticketId: ticket.id }))}
                        >
                          Collected
                        </button>
                      ) : null}
                      {canManage ? (
                        <button
                          type="button"
                          className="text-slate-500"
                          onClick={() => {
                            const reason = window.prompt("Void reason (name change, lost phone…)") ?? ""
                            if (!reason.trim()) return
                            run(() => reissueBookingTicket({ dealId, ticketId: ticket.id, reason }))
                          }}
                        >
                          Void / reissue
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {canManage && digital.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-[11px] font-medium">
            <input type="checkbox" checked={emailGuests} onChange={(event) => setEmailGuests(event.target.checked)} />
            Email named guests directly
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => sendBookingTickets({ dealId, orderId, emailGuestsDirectly: emailGuests }))}
            className="h-9 rounded-md bg-primary px-4 text-[11px] font-semibold text-white"
          >
            Email tickets
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => markBookingTicketsCopied({ dealId, orderId }))}
            className="h-9 rounded-md border px-3 text-[11px] font-semibold"
          >
            I&apos;ve sent these
          </button>
        </div>
      ) : null}

      {canManage && physical.some((row) => row.guestId) ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            value={tracking}
            onChange={(event) => setTracking(event.target.value)}
            placeholder="Tracking number"
            className="h-9 w-full min-w-0 max-w-xs rounded-md border px-2 text-[11px]"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() =>
                postBookingPhysicalTickets({
                  dealId,
                  ticketIds: physical.filter((row) => row.guestId).map((row) => row.id),
                  trackingNumber: tracking,
                }),
              )
            }
            className="h-9 rounded-md border px-3 text-[11px] font-semibold"
          >
            Mark posted
          </button>
        </div>
      ) : null}

      {physical.length > 0 ? (
        <div className="mt-4 rounded-md bg-slate-50 p-3 text-[11px]">
          <p className="font-semibold">Packing list</p>
          <ul className="mt-2 space-y-1">
            {physical.map((ticket) => (
              <li key={ticket.id}>
                {ticket.guestName} · {ticket.physicalSerial || "no serial"} · {ticket.shortCode}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
