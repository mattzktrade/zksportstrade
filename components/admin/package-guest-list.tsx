"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  LayoutGrid,
  MapPin,
  MoreHorizontal,
  Search,
  Send,
  Ticket,
  Users,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"
import {
  removePackageGuest,
  saveGuestListBooking,
  saveGuestListSeat,
  savePackageGuestNames,
} from "@/app/(admin)/admin/catalog/guest-list-actions"
import { OperationsGuestEditor } from "@/app/(admin)/admin/operations/guest-editor"
import type { OperationsGuest } from "@/lib/admin/workflow-views"
import type { PackageGuestListData, PackageGuestListSeat } from "@/lib/admin/package-guest-list-model"
import {
  formatGuestListDeadline,
  guestListDayRank,
  guestListSeatDayShortLabel,
  guestListStats,
  isGuestTicketIssued,
  seatAttendsDay,
  supplierDetailsState,
  utcTodayIso,
  type GuestListDayId,
  type GuestTicketStatus,
} from "@/lib/admin/package-guest-list-model"
import { pageSearchProps } from "@/lib/browser/laptop-qol"
import { cn } from "@/lib/utils"
import { AccountNameLink } from "@/components/admin/profile-name-link"
import { AdminDesktopTable, AdminMobileList, AdminStatCard } from "@/components/admin/admin-page-kit"
import { useEscapeToClose } from "@/hooks/use-escape-to-close"

type TicketFilter = "" | GuestTicketStatus | "issued_any"
type Props = {
  data: PackageGuestListData
  canManage: boolean
}

export function PackageGuestList({ data, canManage }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [day, setDay] = useState<GuestListDayId>("all")
  const [query, setQuery] = useState("")
  const [client, setClient] = useState("")
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>("")
  const [supplier, setSupplier] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [editorSeats, setEditorSeats] = useState<PackageGuestListSeat[] | null>(null)
  const today = utcTodayIso()

  useEscapeToClose(Boolean(menuId), () => setMenuId(null))

  useEffect(() => {
    if (!menuId) return
    function onPointerDown() {
      setMenuId(null)
    }
    window.addEventListener("mousedown", onPointerDown)
    return () => window.removeEventListener("mousedown", onPointerDown)
  }, [menuId])

  const clients = useMemo(
    () => uniqueSorted(data.seats.map((seat) => seat.clientName).filter((name) => name && name !== "—")),
    [data.seats],
  )
  const suppliers = useMemo(
    () => uniqueSorted(data.seats.map((seat) => seat.supplierName).filter((name): name is string => Boolean(name))),
    [data.seats],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.seats.filter((seat) => {
      if (!seatAttendsDay(seat.daySlots, day)) return false
      if (client && seat.clientName !== client) return false
      if (ticketFilter === "issued_any") {
        if (!isGuestTicketIssued(seat.ticketStatus)) return false
      } else if (ticketFilter && seat.ticketStatus !== ticketFilter) {
        return false
      }
      if (supplier && seat.supplierName !== supplier) return false
      if (!q) return true
      const hay = [
        seat.guestName ?? "",
        seat.clientName,
        seat.orderNumber,
        seat.tableNumber,
        seat.ticketNumber,
        seat.paddockTour,
        seat.supplierName ?? "",
      ]
        .join(" ")
        .toLowerCase()
      return hay.includes(q)
    })
  }, [client, data.seats, day, query, supplier, ticketFilter])

  const stats = guestListStats(visible)
  const filtersActive = Boolean(query.trim() || client || ticketFilter || supplier || day !== "all")

  function refresh() {
    router.refresh()
  }

  function openEditor(seat: PackageGuestListSeat) {
    if (!canManage) return
    const related = data.seats
      .filter((row) => sameBooking(row, seat))
      .sort((a, b) => {
        const day = guestListDayRank(a.attendanceDay ?? a.daySlots[0]) - guestListDayRank(b.attendanceDay ?? b.daySlots[0])
        if (day !== 0) return day
        return a.slotIndex - b.slotIndex
      })
    setEditorSeats(related)
    setMenuId(null)
  }

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
        <AdminStatCard
          icon={Users}
          value={stats.totalGuests}
          label="Total guests"
          tone="blue"
          onClick={() => {
            setDay("all")
            setTicketFilter("")
          }}
        />
        <AdminStatCard
          icon={Ticket}
          value={stats.ticketsIssued}
          label="Tickets issued"
          tone="green"
          active={ticketFilter === "issued" || ticketFilter === "issued_any"}
          onClick={() => setTicketFilter((current) => (current === "issued_any" ? "" : "issued_any"))}
        />
        <AdminStatCard
          icon={Clock3}
          value={stats.pendingIssue}
          label="Pending issue"
          tone="amber"
          active={ticketFilter === "pending"}
          onClick={() => setTicketFilter((current) => (current === "pending" ? "" : "pending"))}
        />
        <AdminStatCard icon={MapPin} value={stats.paddockTourSlots} label="Paddock tour slots" tone="purple" />
        <AdminStatCard icon={LayoutGrid} value={stats.tablesInUse} label="Tables in use" tone="blue" />
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        {data.days.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {data.days.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setDay(chip.id)}
                className={cn(
                  "h-8 rounded-full px-3 text-[11px] font-semibold",
                  day === chip.id
                    ? "bg-primary text-white"
                    : "border border-[#e5e7eb] bg-white text-[#5f636b] hover:border-primary/40",
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : (
          <div />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 w-full flex-1 sm:max-w-[280px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              {...pageSearchProps}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search guests, clients, order number…"
              className="h-8 w-full rounded-md border border-[#e5e7eb] bg-white pl-9 pr-3 text-[10px] outline-none placeholder:text-[#a0a3a9] focus:border-primary/40"
            />
          </div>
          <select
            value={client}
            onChange={(event) => setClient(event.target.value)}
            className="h-8 max-w-[170px] rounded-md border border-[#e5e7eb] bg-white px-2 text-[10px] text-[#5f636b]"
          >
            <option value="">All clients</option>
            {clients.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={ticketFilter === "issued_any" ? "issued" : ticketFilter}
            onChange={(event) => setTicketFilter(event.target.value as TicketFilter)}
            className="h-8 max-w-[170px] rounded-md border border-[#e5e7eb] bg-white px-2 text-[10px] text-[#5f636b]"
          >
            <option value="">All ticket statuses</option>
            <option value="pending">Pending</option>
            <option value="issued">Issued</option>
            <option value="posted">Posted</option>
          </select>
          <select
            value={supplier}
            onChange={(event) => setSupplier(event.target.value)}
            className="h-8 max-w-[170px] rounded-md border border-[#e5e7eb] bg-white px-2 text-[10px] text-[#5f636b]"
          >
            <option value="">All suppliers</option>
            {suppliers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!filtersActive}
            onClick={() => {
              setDay("all")
              setQuery("")
              setClient("")
              setTicketFilter("")
              setSupplier("")
            }}
            className="h-8 rounded-md border border-[#e5e7eb] px-3 text-[10px] text-[#5f636b] disabled:opacity-40"
          >
            Reset filters
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          {data.seats.length === 0
            ? "No sold places on this product yet. Confirmed deals and orders will appear here as guest rows, with placeholders until names are collected."
            : "No guests match these filters."}
        </p>
      ) : (
        <>
          <AdminDesktopTable>
            <div className="overflow-hidden rounded-xl border border-[#eceef1] bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1180px] text-left text-[11px]">
                  <thead className="bg-[#fafbfc] text-[9px] font-semibold uppercase tracking-wide text-[#92969e]">
                    <tr>
                      <th className="w-8 px-3 py-2" />
                      <th className="px-3 py-2">Guest</th>
                      <th className="px-3 py-2">Client</th>
                      <th className="px-3 py-2">Order #</th>
                      <th className="px-3 py-2">Table #</th>
                      <th className="px-3 py-2">Ticket #</th>
                      <th className="px-3 py-2">Paddock tour</th>
                      <th className="px-3 py-2">Supplier</th>
                      <th className="px-3 py-2">Supplier details sent / deadline</th>
                      <th className="px-3 py-2">Ticket status</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((seat) => (
                      <GuestRow
                        key={seat.id}
                        seat={seat}
                        expanded={expandedId === seat.id}
                        menuOpen={menuId === seat.id}
                        today={today}
                        showDayLabel={day === "all"}
                        canManage={canManage}
                        pending={pending}
                        onToggle={() => {
                          setMenuId(null)
                          setExpandedId((current) => (current === seat.id ? null : seat.id))
                        }}
                        onMenu={() => setMenuId((current) => (current === seat.id ? null : seat.id))}
                        onEditGuests={() => openEditor(seat)}
                        onSaved={refresh}
                        start={start}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </AdminDesktopTable>

          <AdminMobileList className="overflow-hidden rounded-xl border border-[#eceef1] bg-white">
            {visible.map((seat) => (
              <GuestMobileCard
                key={seat.id}
                seat={seat}
                expanded={expandedId === seat.id}
                today={today}
                showDayLabel={day === "all"}
                canManage={canManage}
                pending={pending}
                onToggle={() => setExpandedId((current) => (current === seat.id ? null : seat.id))}
                onEditGuests={() => openEditor(seat)}
                onSaved={refresh}
                start={start}
              />
            ))}
          </AdminMobileList>
        </>
      )}

      {editorSeats ? (
        <OperationsGuestEditor
          title="Guest details"
          subtitle={`${editorSeats[0]?.clientName ?? "Booking"} · ${editorSeats[0]?.orderNumber ?? ""}`}
          expectedCount={editorSeats.length}
          existing={editorSeats.filter((seat) => seat.guestId).map(seatToOperationsGuest)}
          pending={pending}
          onClose={() => setEditorSeats(null)}
          onSave={(guests) => {
            start(async () => {
              const result = await savePackageGuestNames({
                orderId: editorSeats[0]?.orderId,
                dealId: editorSeats[0]?.dealId,
                guests: guests.map((guest, index) => ({
                  ...guest,
                  sortOrder: guest.sortOrder ?? editorSeats[index]?.slotIndex ?? index,
                  attendanceDay: guest.attendanceDay ?? editorSeats[index]?.attendanceDay ?? null,
                })),
              })
              if (!result.ok) {
                toast.error(result.message)
                return
              }
              toast.success(result.message)
              setEditorSeats(null)
              refresh()
            })
          }}
          onDelete={(guestId) => {
            start(async () => {
              const result = await removePackageGuest({
                orderId: editorSeats[0]?.orderId,
                dealId: editorSeats[0]?.dealId,
                guestId,
              })
              if (!result.ok) {
                toast.error(result.message)
                return
              }
              toast.success(result.message)
              refresh()
            })
          }}
        />
      ) : null}
    </div>
  )
}

function GuestRow({
  seat,
  expanded,
  menuOpen,
  today,
  showDayLabel,
  canManage,
  pending,
  onToggle,
  onMenu,
  onEditGuests,
  onSaved,
  start,
}: {
  seat: PackageGuestListSeat
  expanded: boolean
  menuOpen: boolean
  today: string
  showDayLabel: boolean
  canManage: boolean
  pending: boolean
  onToggle: () => void
  onMenu: () => void
  onEditGuests: () => void
  onSaved: () => void
  start: (fn: () => Promise<void>) => void
}) {
  const missing = !seat.guestName
  const sentState = supplierDetailsState(seat.supplierDetailsSentAt, seat.supplierDeadline, today)

  function saveSeat(
    patch: Partial<Pick<PackageGuestListSeat, "tableNumber" | "ticketNumber" | "paddockTour" | "ticketStatus">>,
  ) {
    if (!canManage) return
    start(async () => {
      const result = await saveGuestListSeat({
        guestId: seat.guestId,
        orderId: seat.orderId,
        dealId: seat.dealId,
        slotIndex: seat.slotIndex,
        attendanceDay: seat.attendanceDay,
        tableNumber: patch.tableNumber ?? seat.tableNumber,
        ticketNumber: patch.ticketNumber ?? seat.ticketNumber,
        paddockTour: patch.paddockTour ?? seat.paddockTour,
        ticketStatus: patch.ticketStatus ?? seat.ticketStatus,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      onSaved()
    })
  }

  return (
    <>
      <tr className={cn("border-t border-[#f0f1f3]", missing ? "bg-red-50/70" : "bg-white")}>
        <td className="px-2 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="rounded p-1 text-[#92969e] hover:text-[#202124]"
            aria-label={expanded ? "Hide delivery details" : "Show delivery details"}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-3 py-3">
          <GuestNameButton
            missing={missing}
            name={seat.guestName}
            dayLabel={showDayLabel ? guestListSeatDayShortLabel(seat.daySlots) : null}
            canManage={canManage}
            onEdit={onEditGuests}
          />
        </td>
        <td className="px-3 py-3 text-[#5f636b]">
          {seat.clientAccountId ? (
            <AccountNameLink accountId={seat.clientAccountId} name={seat.clientName} />
          ) : (
            seat.clientName
          )}
        </td>
        <td className="px-3 py-3">
          {seat.dealHref ? (
            <Link href={seat.dealHref} className="font-medium text-primary hover:underline">
              {seat.orderNumber}
            </Link>
          ) : (
            <span className="text-[#5f636b]">{seat.orderNumber}</span>
          )}
        </td>
        <td className="px-3 py-3">
          <InlineField
            value={seat.tableNumber}
            disabled={!canManage || pending}
            placeholder="—"
            className="w-[4.5rem]"
            onSave={(value) => saveSeat({ tableNumber: value })}
          />
        </td>
        <td className="px-3 py-3">
          <InlineField
            value={seat.ticketNumber}
            disabled={!canManage || pending}
            placeholder="—"
            className="w-[6.5rem]"
            onSave={(value) => saveSeat({ ticketNumber: value })}
          />
        </td>
        <td className="px-3 py-3">
          <InlineField
            value={seat.paddockTour}
            disabled={!canManage || pending}
            placeholder="Add time"
            className="w-[7.5rem]"
            onSave={(value) => saveSeat({ paddockTour: value })}
          />
        </td>
        <td className="px-3 py-3 text-[#5f636b]">{seat.supplierName || "—"}</td>
        <td className="px-3 py-3">
          <SupplierSent
            state={sentState}
            deadline={seat.supplierDeadline}
            disabled={!canManage || pending}
            onToggle={() => {
              start(async () => {
                const result = await saveGuestListBooking({
                  orderId: seat.orderId,
                  dealId: seat.dealId,
                  supplierDetailsSent: sentState !== "sent",
                })
                if (!result.ok) {
                  toast.error(result.message)
                  return
                }
                onSaved()
              })
            }}
          />
        </td>
        <td className="px-3 py-3">
          <TicketStatusSelect
            status={seat.ticketStatus}
            disabled={!canManage || pending}
            onChange={(status) => saveSeat({ ticketStatus: status })}
          />
        </td>
        <td className="relative px-3 py-3 text-right">
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onMenu}
            className="rounded p-1 text-[#92969e] hover:text-[#202124]"
            aria-label="Guest actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <div
              onMouseDown={(event) => event.stopPropagation()}
              className="absolute right-3 z-20 mt-1 w-44 rounded-md border border-[#eceef1] bg-white py-1 text-left shadow-lg"
            >
              {canManage ? (
                <button
                  type="button"
                  onClick={onEditGuests}
                  className="block w-full px-3 py-1.5 text-left text-[11px] hover:bg-slate-50"
                >
                  Edit guest details
                </button>
              ) : null}
              {seat.dealHref ? (
                <Link href={seat.dealHref} className="block px-3 py-1.5 text-[11px] hover:bg-slate-50">
                  Open deal
                </Link>
              ) : null}
            </div>
          ) : null}
        </td>
      </tr>
      {expanded ? (
        <tr className="border-t border-[#f0f1f3] bg-[#fafbfc]">
          <td colSpan={11} className="px-6 py-4">
            <ExpandedBooking seat={seat} canManage={canManage} pending={pending} start={start} onSaved={onSaved} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

function GuestMobileCard({
  seat,
  expanded,
  today,
  showDayLabel,
  canManage,
  pending,
  onToggle,
  onEditGuests,
  onSaved,
  start,
}: {
  seat: PackageGuestListSeat
  expanded: boolean
  today: string
  showDayLabel: boolean
  canManage: boolean
  pending: boolean
  onToggle: () => void
  onEditGuests: () => void
  onSaved: () => void
  start: (fn: () => Promise<void>) => void
}) {
  const missing = !seat.guestName
  const sentState = supplierDetailsState(seat.supplierDetailsSentAt, seat.supplierDeadline, today)

  function saveSeat(
    patch: Partial<Pick<PackageGuestListSeat, "tableNumber" | "ticketNumber" | "paddockTour" | "ticketStatus">>,
  ) {
    if (!canManage) return
    start(async () => {
      const result = await saveGuestListSeat({
        guestId: seat.guestId,
        orderId: seat.orderId,
        dealId: seat.dealId,
        slotIndex: seat.slotIndex,
        attendanceDay: seat.attendanceDay,
        tableNumber: patch.tableNumber ?? seat.tableNumber,
        ticketNumber: patch.ticketNumber ?? seat.ticketNumber,
        paddockTour: patch.paddockTour ?? seat.paddockTour,
        ticketStatus: patch.ticketStatus ?? seat.ticketStatus,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      onSaved()
    })
  }

  return (
    <div className={cn("px-4 py-3", missing ? "bg-red-50/70" : "bg-white")}>
      <div className="flex items-start justify-between gap-3">
        <GuestNameButton
          missing={missing}
          name={seat.guestName}
          dayLabel={showDayLabel ? guestListSeatDayShortLabel(seat.daySlots) : null}
          canManage={canManage}
          onEdit={onEditGuests}
        />
        <TicketStatusSelect
          status={seat.ticketStatus}
          disabled={!canManage || pending}
          onChange={(status) => saveSeat({ ticketStatus: status })}
        />
      </div>
      <p className="mt-1 text-[11px] text-[#5f636b]">
        {seat.clientName} · {seat.orderNumber}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <dt className="text-[9px] uppercase tracking-wide text-[#92969e]">Table #</dt>
          <dd>
            <InlineField
              value={seat.tableNumber}
              disabled={!canManage || pending}
              placeholder="—"
              onSave={(value) => saveSeat({ tableNumber: value })}
            />
          </dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase tracking-wide text-[#92969e]">Ticket #</dt>
          <dd>
            <InlineField
              value={seat.ticketNumber}
              disabled={!canManage || pending}
              placeholder="—"
              onSave={(value) => saveSeat({ ticketNumber: value })}
            />
          </dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase tracking-wide text-[#92969e]">Paddock tour</dt>
          <dd>
            <InlineField
              value={seat.paddockTour}
              disabled={!canManage || pending}
              placeholder="Add time"
              onSave={(value) => saveSeat({ paddockTour: value })}
            />
          </dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase tracking-wide text-[#92969e]">Supplier</dt>
          <dd className="pt-1 text-[#5f636b]">{seat.supplierName || "—"}</dd>
        </div>
      </dl>
      <div className="mt-2">
        <SupplierSent
          state={sentState}
          deadline={seat.supplierDeadline}
          disabled={!canManage || pending}
          onToggle={() => {
            start(async () => {
              const result = await saveGuestListBooking({
                orderId: seat.orderId,
                dealId: seat.dealId,
                supplierDetailsSent: sentState !== "sent",
              })
              if (!result.ok) {
                toast.error(result.message)
                return
              }
              onSaved()
            })
          }}
        />
      </div>
      <button type="button" onClick={onToggle} className="mt-2 text-[11px] font-semibold text-primary">
        {expanded ? "Hide delivery details" : "Ticket delivery / notes"}
      </button>
      {expanded ? (
        <div className="mt-3">
          <ExpandedBooking seat={seat} canManage={canManage} pending={pending} start={start} onSaved={onSaved} />
        </div>
      ) : null}
    </div>
  )
}

function GuestNameButton({
  missing,
  name,
  dayLabel,
  canManage,
  onEdit,
}: {
  missing: boolean
  name: string | null
  dayLabel?: string | null
  canManage: boolean
  onEdit: () => void
}) {
  if (missing) {
    return (
      <button type="button" onClick={onEdit} disabled={!canManage} className="flex items-center gap-2 text-left">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <span>
          <span className="block font-semibold text-red-600">Guest details needed</span>
          {dayLabel ? <span className="text-[10px] font-medium text-[#92969e]">{dayLabel}</span> : null}
        </span>
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onEdit}
      disabled={!canManage}
      className="text-left font-semibold text-[#202124] hover:underline disabled:hover:no-underline"
    >
      <span className="block">{name}</span>
      {dayLabel ? <span className="text-[10px] font-medium text-[#92969e]">{dayLabel}</span> : null}
    </button>
  )
}

function ExpandedBooking({
  seat,
  canManage,
  pending,
  start,
  onSaved,
}: {
  seat: PackageGuestListSeat
  canManage: boolean
  pending: boolean
  start: (fn: () => Promise<void>) => void
  onSaved: () => void
}) {
  const [deliveryMethod, setDeliveryMethod] = useState(seat.deliveryMethod)
  const [collectionPoint, setCollectionPoint] = useState(seat.collectionPoint)
  const [collectionTime, setCollectionTime] = useState(seat.collectionTime)
  const [contactOnSite, setContactOnSite] = useState(seat.contactOnSite)
  const [internalNotes, setInternalNotes] = useState(seat.internalNotes)

  useEffect(() => {
    setDeliveryMethod(seat.deliveryMethod)
    setCollectionPoint(seat.collectionPoint)
    setCollectionTime(seat.collectionTime)
    setContactOnSite(seat.contactOnSite)
    setInternalNotes(seat.internalNotes)
  }, [seat.collectionPoint, seat.collectionTime, seat.contactOnSite, seat.deliveryMethod, seat.id, seat.internalNotes])

  function save() {
    start(async () => {
      const result = await saveGuestListBooking({
        orderId: seat.orderId,
        dealId: seat.dealId,
        deliveryMethod,
        collectionPoint,
        collectionTime,
        contactOnSite,
        internalNotes,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      onSaved()
    })
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <p className="text-[11px] font-semibold text-[#202124]">Ticket delivery / collection</p>
        <dl className="mt-3 grid grid-cols-[8.5rem_1fr] gap-y-2 text-[11px]">
          <dt className="text-[#92969e]">Delivery method</dt>
          <dd>
            <input
              value={deliveryMethod}
              onChange={(event) => setDeliveryMethod(event.target.value)}
              disabled={!canManage}
              placeholder="Collecting at circuit"
              className={expandInputClass}
            />
          </dd>
          <dt className="text-[#92969e]">Collection point</dt>
          <dd>
            <input
              value={collectionPoint}
              onChange={(event) => setCollectionPoint(event.target.value)}
              disabled={!canManage}
              placeholder="Yas Marina Box Office"
              className={expandInputClass}
            />
          </dd>
          <dt className="text-[#92969e]">Collection time</dt>
          <dd>
            <input
              value={collectionTime}
              onChange={(event) => setCollectionTime(event.target.value)}
              disabled={!canManage}
              placeholder="From 08:15"
              className={expandInputClass}
            />
          </dd>
          <dt className="text-[#92969e]">Contact on site</dt>
          <dd>
            <input
              value={contactOnSite}
              onChange={(event) => setContactOnSite(event.target.value)}
              disabled={!canManage}
              placeholder="ZK host team"
              className={expandInputClass}
            />
          </dd>
        </dl>
      </div>
      <div>
        <p className="text-[11px] font-semibold text-[#202124]">Internal notes</p>
        <textarea
          value={internalNotes}
          onChange={(event) => setInternalNotes(event.target.value)}
          disabled={!canManage}
          rows={5}
          placeholder="Anything the operations team needs to remember for this booking."
          className="mt-3 w-full rounded-md border border-[#e5e7eb] bg-white px-3 py-2 text-[11px] outline-none focus:border-primary/40"
        />
        {seat.notesUpdatedAt ? (
          <p className="mt-2 text-[10px] text-[#92969e]">
            Last updated {formatUpdatedAt(seat.notesUpdatedAt)}
            {seat.notesUpdatedBy ? ` by ${seat.notesUpdatedBy}` : ""}
          </p>
        ) : null}
      </div>
      {canManage ? (
        <div className="md:col-span-2">
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="h-8 rounded-md bg-primary px-3 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            Save booking details
          </button>
        </div>
      ) : null}
    </div>
  )
}

const expandInputClass =
  "w-full rounded-md border border-[#e5e7eb] bg-white px-2 py-1 text-[11px] text-[#202124] outline-none focus:border-primary/40 disabled:bg-transparent"

function InlineField({
  value,
  placeholder,
  disabled,
  className,
  onSave,
}: {
  value: string
  placeholder: string
  disabled: boolean
  className?: string
  onSave: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    setDraft(value)
  }, [value])
  return (
    <input
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim() === (value ?? "").trim()) return
        onSave(draft)
      }}
      className={cn(
        "rounded-md border border-transparent bg-transparent px-1 py-1 text-[11px] outline-none hover:border-[#e5e7eb] focus:border-primary/40",
        className,
      )}
    />
  )
}

function TicketStatusSelect({
  status,
  disabled,
  onChange,
}: {
  status: GuestTicketStatus
  disabled: boolean
  onChange: (status: GuestTicketStatus) => void
}) {
  return (
    <div className="relative inline-flex">
      <TicketPill status={status} />
      <select
        value={status}
        disabled={disabled}
        aria-label="Ticket status"
        onChange={(event) => onChange(event.target.value as GuestTicketStatus)}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
      >
        <option value="pending">Pending</option>
        <option value="issued">Issued</option>
        <option value="posted">Posted</option>
      </select>
    </div>
  )
}

function TicketPill({ status }: { status: GuestTicketStatus }) {
  if (status === "issued") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">
        <Check className="h-3 w-3" /> Issued
      </span>
    )
  }
  if (status === "posted") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-semibold text-violet-700">
        <Send className="h-3 w-3" /> Posted
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-semibold text-amber-700">
      <Clock3 className="h-3 w-3" /> Pending
    </span>
  )
}

function SupplierSent({
  state,
  deadline,
  disabled,
  onToggle,
}: {
  state: "sent" | "overdue" | "not_sent"
  deadline: string | null
  disabled: boolean
  onToggle: () => void
}) {
  const due = formatGuestListDeadline(deadline)
  if (state === "sent") {
    return (
      <button type="button" disabled={disabled} onClick={onToggle} className="text-left" title="Mark as not sent">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
          <Check className="h-3.5 w-3.5" /> Sent
        </span>
        <span className="mt-0.5 block text-[10px] text-[#92969e]">Deadline: {due}</span>
      </button>
    )
  }
  if (state === "overdue") {
    return (
      <button type="button" disabled={disabled} onClick={onToggle} className="text-left" title="Mark as sent">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600">
          <XCircle className="h-3.5 w-3.5" /> Overdue
        </span>
        <span className="mt-0.5 block text-[10px] text-red-500">Deadline: {due}</span>
      </button>
    )
  }
  return (
    <button type="button" disabled={disabled} onClick={onToggle} className="text-left" title="Mark as sent">
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600">
        <XCircle className="h-3.5 w-3.5" /> Not sent
      </span>
      <span className="mt-0.5 block text-[10px] text-[#92969e]">Deadline: {due}</span>
    </button>
  )
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
}

function sameBooking(a: PackageGuestListSeat, b: PackageGuestListSeat): boolean {
  if (a.orderId && b.orderId) return a.orderId === b.orderId
  return Boolean(a.dealId && a.dealId === b.dealId)
}

function seatToOperationsGuest(seat: PackageGuestListSeat): OperationsGuest {
  return {
    id: seat.guestId ?? seat.id,
    orderId: seat.orderId,
    dealId: seat.dealId,
    fullName: seat.guestName,
    email: seat.email,
    phone: seat.phone,
    nationality: seat.nationality,
    dateOfBirth: seat.dateOfBirth,
    dietaryRequirements: seat.dietaryRequirements,
    specialRequests: seat.specialRequests,
    isLeadGuest: seat.isLeadGuest,
    detailsComplete: Boolean(seat.guestName),
    sortOrder: seat.slotIndex,
    attendanceDay: seat.attendanceDay,
    headshotPath: seat.headshotPath,
  }
}

function formatUpdatedAt(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return formatGuestListDeadline(iso.slice(0, 10))
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
