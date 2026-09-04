"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  CheckSquare,
  Flame,
  Globe,
  Inbox,
  Maximize2,
  Phone,
  Plus,
  Search,
  Share2,
  Snowflake,
  Store,
  Trophy,
  UserRound,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { updateEnquiryPipeline, updateEnquiryPipelineBulk } from "@/app/(admin)/actions"
import { addDealNote, updateEnquiryNotes } from "@/app/(admin)/admin/deals/deal-edit-actions"
import { DealCreateModal } from "@/components/admin/deal-create-modal"
import { EventFilter, uniqueEventFilterOptions } from "@/components/admin/event-filter"
import {
  AdminMobileList,
  AdminPageHeader,
  AdminPanel,
  AdminStatCard,
  AdminStats,
  StatusPill,
} from "@/components/admin/admin-page-kit"
import { AdminListPreview } from "@/components/admin/admin-list-preview"
import type { DealBasketProduct, DealBasketSupplier } from "@/components/admin/deal-line-basket"
import { useAdminListSelection } from "@/lib/admin/use-admin-list-selection"
import { usePersistedAdminFilters } from "@/lib/admin/use-persisted-admin-filters"
import { adminDealPath } from "@/lib/admin/deal-link"
import { adminPackagePath } from "@/lib/admin/package-link"
import { isModifiedClick, openInNewTab, pageSearchProps } from "@/lib/browser/laptop-qol"
import {
  DEAL_SOURCE_LABELS,
  DEAL_SOURCES,
  dealSourceLabel,
  friendlyDealActivitySummary,
  type CrmAccountOption,
  type DealListRow,
} from "@/lib/crm/deal-types"
import {
  ENQUIRY_CRM_STAGE_LABELS,
  ENQUIRY_CRM_STAGES,
  ENQUIRY_PAGE_SIZE,
  ENQUIRY_STAGE_TABS,
  adminDealListPath,
  adminEnquiryListPath,
  enquiryCrmStageFromDeal,
  enquiryInterestLabel,
  enquiryLastActivityAt,
  enquiryLineAvailability,
  enquiryNeedsAttention,
  enquiryAttentionReason,
  enquiryNeedsSourcing,
  enquiryNotesPreview,
  enquiryStageLabel,
  enquiryStageTone,
  enquiryTemperatureFromDeal,
  enquiryTemperatureLabel,
  enquiryTemperatureTone,
  isOpenEnquiry,
  relativeActivityTime,
  suggestedEnquiryAction,
  type EnquiryCrmStage,
  type EnquiryStageTabId,
  type EnquiryTemperature,
} from "@/lib/crm/deal-pipeline"
import type { StaffOption } from "@/lib/crm/lead-types"
import { adminAccountPath, adminContactPath } from "@/lib/crm/profile-links"
import { formatMoneyCompact } from "@/lib/format/money"
import { cn } from "@/lib/utils"
import { BookingFormPanel } from "@/app/(admin)/admin/deals/booking-form-panel"
import type { BookingFormAdminRow, BookingFormEventRow } from "@/lib/booking-forms/types"

function sourceIcon(source: string) {
  switch (source) {
    case "website":
      return Globe
    case "portal":
      return Store
    case "referral":
      return Share2
    default:
      return Phone
  }
}

function temperatureKind(temperature: EnquiryTemperature): { label: string; className: string; Icon: typeof Flame } {
  if (temperature === "cold") {
    return { label: "Cold", className: "bg-sky-50 text-sky-700", Icon: Snowflake }
  }
  return { label: "Warm", className: "bg-orange-50 text-orange-700", Icon: Flame }
}

function sourceKind(source: string): { label: string; className: string } {
  switch (source) {
    case "website":
      return { label: "Marketing", className: "bg-blue-50 text-blue-700" }
    case "portal":
      return { label: "Inbound", className: "bg-emerald-50 text-emerald-700" }
    case "referral":
      return { label: "Referral", className: "bg-violet-50 text-violet-700" }
    case "offline":
      return { label: "Offline", className: "bg-amber-50 text-amber-700" }
    default:
      return { label: "Other", className: "bg-slate-100 text-slate-600" }
  }
}

function EnquiryAvailability({
  deal,
  products,
}: {
  deal: DealListRow
  products: DealBasketProduct[]
}) {
  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products])
  if (deal.lines.length === 0) {
    return <p className="text-[9px] text-slate-500">No product on this enquiry yet.</p>
  }
  return (
    <div className="space-y-2">
      {deal.lines.map((line) => {
        const product = byId.get(line.package_id)
        const availability = enquiryLineAvailability(line, product)
        return (
          <div key={line.id} className="rounded-lg border border-slate-200 p-3">
            {product ? (
              <Link
                href={adminPackagePath(product.id, "inventory")}
                className="text-[9px] font-semibold text-slate-800 hover:text-primary hover:underline"
              >
                {availability.label}
              </Link>
            ) : (
              <p className="text-[9px] font-semibold text-slate-800">{availability.label}</p>
            )}
            <p className="mt-1 text-[10px] font-medium text-slate-800">
              {availability.requested} requested
              {availability.available == null ? "" : ` · ${availability.available} available`}
            </p>
            {availability.available == null ? (
              <p className="mt-0.5 text-[8px] text-slate-500">Live stock is not available for this product.</p>
            ) : (
              <p className={cn("mt-0.5 text-[8px] font-medium", availability.enough ? "text-emerald-700" : "text-amber-700")}>
                {availability.enough
                  ? "Enough ZK stock for this request"
                  : `Short by ${Math.max(0, availability.requested - availability.available)}`}
              </p>
            )}
            {availability.sourcing ? (
              <p className="mt-0.5 text-[8px] font-medium text-amber-700">Marked as needs sourcing</p>
            ) : null}
          </div>
        )
      })}
      {deal.reserved_qty > 0 ? (
        <p className="text-[8px] font-medium text-amber-700">
          {deal.reserved_qty} unit{deal.reserved_qty === 1 ? "" : "s"} currently on hold
        </p>
      ) : null}
    </div>
  )
}

export function EnquiriesClient({
  deals,
  convertedThisMonth,
  packageOptions,
  stockProducts,
  accountOptions,
  staffOptions,
  currentCanManageDeals,
  currentCanSendBookingForm,
  currentCanSignBookingForm,
  currentProfileName,
  bookingForms,
  bookingFormEvents,
  supplierOptions,
  initialSelectedId = null,
  initialStageTab = "",
}: {
  deals: DealListRow[]
  convertedThisMonth: number
  packageOptions: DealBasketProduct[]
  stockProducts: DealBasketProduct[]
  accountOptions: CrmAccountOption[]
  staffOptions: StaffOption[]
  currentCanManageDeals: boolean
  currentCanSendBookingForm: boolean
  currentCanSignBookingForm: boolean
  currentProfileName: string
  bookingForms: BookingFormAdminRow[]
  bookingFormEvents: BookingFormEventRow[]
  supplierOptions: DealBasketSupplier[]
  initialSelectedId?: string | null
  initialStageTab?: EnquiryStageTabId | ""
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [listState, setListState] = usePersistedAdminFilters("zk-admin-enquiries-filters-v2", {
    stageTab: "" as EnquiryStageTabId | "",
    kpiFilter: "" as "" | "attention" | "open",
    query: "",
    sourceFilter: "",
    temperatureFilter: "" as "" | EnquiryTemperature,
    ownerFilter: "",
    eventFilter: [] as string[],
    page: 1,
  }, initialStageTab ? { override: { stageTab: initialStageTab, page: 1, kpiFilter: "" as const } } : undefined)
  const { stageTab, kpiFilter, query, sourceFilter, temperatureFilter, ownerFilter, eventFilter, page } = listState
  const {
    isDesktop,
    selectedId,
    selectRow,
    closePreview,
    showPreview,
  } = useAdminListSelection({
    initialId: initialSelectedId ?? null,
  })
  const previewRef = useRef<HTMLElement>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [workflowStage, setWorkflowStage] = useState<EnquiryCrmStage>("new")
  const [showLogNote, setShowLogNote] = useState(false)
  const [logNote, setLogNote] = useState("")
  const [notesDraft, setNotesDraft] = useState("")
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [bulkStage, setBulkStage] = useState<EnquiryCrmStage | "">("")

  const scoped = useMemo(() => {
    const q = query.trim().toLowerCase()
    return deals.filter((deal) => {
      if (sourceFilter && deal.source !== sourceFilter) return false
      if (temperatureFilter && enquiryTemperatureFromDeal(deal) !== temperatureFilter) return false
      if (ownerFilter === "unassigned" && deal.owner_profile_id) return false
      if (ownerFilter && ownerFilter !== "unassigned" && deal.owner_profile_id !== ownerFilter) return false
      if (eventFilter.length > 0) {
        const selected = new Set(eventFilter)
        if (!(deal.events ?? []).some((event) => selected.has(event.id))) return false
      }
      if (!q) return true
      return [
        deal.reference,
        deal.account_name,
        deal.contact_name,
        deal.race_name,
        deal.line_summary,
        deal.owner_name,
        deal.next_action,
        deal.notes,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    })
  }, [deals, eventFilter, ownerFilter, query, sourceFilter, temperatureFilter])

  const filtered = useMemo(() => {
    if (kpiFilter === "attention") return scoped.filter(enquiryNeedsAttention)
    if (kpiFilter === "open") return scoped.filter(isOpenEnquiry)
    if (!stageTab || stageTab === "all") return scoped
    return scoped.filter((deal) => enquiryCrmStageFromDeal(deal) === stageTab)
  }, [scoped, stageTab, kpiFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / ENQUIRY_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const paged = useMemo(() => {
    const start = (currentPage - 1) * ENQUIRY_PAGE_SIZE
    return filtered.slice(start, start + ENQUIRY_PAGE_SIZE)
  }, [currentPage, filtered])

  const selected = selectedId ? deals.find((deal) => deal.id === selectedId) ?? null : null
  const latestBookingByDeal = useMemo(() => {
    const map = new Map<string, BookingFormAdminRow>()
    for (const form of bookingForms) {
      const current = map.get(form.deal_id)
      if (!current || form.revision > current.revision) map.set(form.deal_id, form)
    }
    return map
  }, [bookingForms])
  const bookingEventsByForm = useMemo(() => {
    const map = new Map<string, BookingFormEventRow[]>()
    for (const event of bookingFormEvents) {
      const rows = map.get(event.booking_form_id) ?? []
      rows.push(event)
      map.set(event.booking_form_id, rows)
    }
    return map
  }, [bookingFormEvents])
  const selectedBookingForm = selected ? latestBookingByDeal.get(selected.id) ?? null : null
  const pageIds = paged.map((deal) => deal.id)
  const allPageChecked = pageIds.length > 0 && pageIds.every((id) => checkedIds.includes(id))
  const checkedCount = checkedIds.filter((id) => filtered.some((deal) => deal.id === id)).length

  useEffect(() => {
    if (!initialSelectedId) return
    document.getElementById(`enquiry-${initialSelectedId}`)?.scrollIntoView({ block: "center" })
  }, [initialSelectedId, selected?.id])

  useEffect(() => {
    previewRef.current?.scrollTo({ top: 0 })
    setShowLogNote(false)
    setLogNote("")
  }, [selectedId])

  useEffect(() => {
    if (!selected) return
    setWorkflowStage(enquiryCrmStageFromDeal(selected))
    setNotesDraft(selected.notes ?? "")
  }, [selected])

  useEffect(() => {
    if (page !== currentPage) {
      setListState((current) => ({ ...current, page: currentPage }))
    }
  }, [currentPage, page, setListState])

  useEffect(() => {
    const allowed = new Set(filtered.map((deal) => deal.id))
    setCheckedIds((current) => {
      const next = current.filter((id) => allowed.has(id))
      if (next.length === current.length && next.every((id, index) => id === current[index])) {
        return current
      }
      return next
    })
  }, [filtered])

  const openEnquiries = scoped.filter(isOpenEnquiry)
  const newCount = scoped.filter((deal) => enquiryCrmStageFromDeal(deal) === "new").length
  const warmCount = scoped.filter((deal) => enquiryTemperatureFromDeal(deal) === "warm").length
  const coldCount = scoped.filter((deal) => enquiryTemperatureFromDeal(deal) === "cold").length
  const attentionCount = scoped.filter(enquiryNeedsAttention).length

  const eventOptions = useMemo(
    () =>
      uniqueEventFilterOptions(
        deals.flatMap((deal) =>
          (deal.events ?? []).map((event) => ({
            id: event.id,
            label: event.label,
            eventDate: event.eventDate,
          })),
        ),
      ),
    [deals],
  )

  function setStageTab(next: EnquiryStageTabId | "") {
    setListState((current) => ({
      ...current,
      stageTab: current.stageTab === next ? "" : next,
      kpiFilter: "",
      page: 1,
    }))
  }

  function toggleChecked(id: string, checked: boolean) {
    setCheckedIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((item) => item !== id),
    )
  }

  function togglePageChecked(checked: boolean) {
    setCheckedIds((current) => {
      if (checked) return [...new Set([...current, ...pageIds])]
      const remove = new Set(pageIds)
      return current.filter((id) => !remove.has(id))
    })
  }

  function saveStage(stage: EnquiryCrmStage) {
    if (!selected) return
    startTransition(async () => {
      const result = await updateEnquiryPipeline({
        dealId: selected.id,
        enquiryStage: stage,
        enquiryTemperature: enquiryTemperatureFromDeal(selected),
        ownerProfileId: selected.owner_profile_id,
        nextAction: suggestedEnquiryAction(stage),
        nextActionDueAt: selected.next_action_due_at,
      })
      if (!result.ok) {
        toast.error(result.message)
        setWorkflowStage(enquiryCrmStageFromDeal(selected))
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  function submitLogNote() {
    if (!selected) return
    const note = logNote.trim()
    if (!note) {
      toast.error("Write a short activity note first.")
      return
    }
    startTransition(async () => {
      const result = await addDealNote({ dealId: selected.id, note })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      setShowLogNote(false)
      setLogNote("")
      router.refresh()
    })
  }

  function saveNotes() {
    if (!selected) return
    startTransition(async () => {
      const result = await updateEnquiryNotes({ dealId: selected.id, notes: notesDraft })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  function applyBulkStage() {
    if (!bulkStage) {
      toast.error("Choose a stage to apply.")
      return
    }
    const ids = checkedIds.filter((id) => filtered.some((deal) => deal.id === id))
    if (ids.length === 0) {
      toast.error("Select at least one enquiry.")
      return
    }
    startTransition(async () => {
      const result = await updateEnquiryPipelineBulk({
        dealIds: ids,
        enquiryStage: bulkStage,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      setCheckedIds([])
      setBulkStage("")
      router.refresh()
    })
  }

  const rangeStart = filtered.length === 0 ? 0 : (currentPage - 1) * ENQUIRY_PAGE_SIZE + 1
  const rangeEnd = Math.min(filtered.length, currentPage * ENQUIRY_PAGE_SIZE)
  const notesDirty = (selected?.notes ?? "") !== notesDraft
  const nextStep = selected ? suggestedEnquiryAction(workflowStage) : ""

  return (
    <div className="space-y-3">
      <AdminPageHeader
        title="Enquiries"
        description="Warm if they came to us or have replied. Cold if we reached out first. Create a booking form here; sending it for approval or to the client moves it to Deals."
        action={
          currentCanManageDeals ? (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-[10px] font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" /> New enquiry
            </button>
          ) : null
        }
      />

      <AdminStats className="sm:grid-cols-2 xl:grid-cols-6">
        <AdminStatCard
          icon={Inbox}
          value={openEnquiries.length}
          label="Open enquiries"
          tone="purple"
          active={kpiFilter === "open"}
          onClick={() =>
            setListState((current) => ({
              ...current,
              kpiFilter: current.kpiFilter === "open" ? "" : "open",
              stageTab: "",
              page: 1,
            }))
          }
        />
        <AdminStatCard
          icon={UserRound}
          value={newCount}
          label="New"
          tone="blue"
          active={stageTab === "new" && !kpiFilter}
          onClick={() => setStageTab("new")}
        />
        <AdminStatCard
          icon={Flame}
          value={warmCount}
          label="Warm"
          tone="red"
          active={temperatureFilter === "warm"}
          onClick={() =>
            setListState((current) => ({
              ...current,
              temperatureFilter: current.temperatureFilter === "warm" ? "" : "warm",
              page: 1,
            }))
          }
        />
        <AdminStatCard
          icon={Snowflake}
          value={coldCount}
          label="Cold"
          tone="blue"
          active={temperatureFilter === "cold"}
          onClick={() =>
            setListState((current) => ({
              ...current,
              temperatureFilter: current.temperatureFilter === "cold" ? "" : "cold",
              page: 1,
            }))
          }
        />
        <AdminStatCard
          icon={AlertTriangle}
          value={attentionCount}
          label="Needs attention"
          hint="No owner, or the next step is overdue"
          tone="red"
          active={kpiFilter === "attention"}
          onClick={() =>
            setListState((current) => ({
              ...current,
              kpiFilter: current.kpiFilter === "attention" ? "" : "attention",
              stageTab: "",
              page: 1,
            }))
          }
        />
        <AdminStatCard
          icon={Trophy}
          value={convertedThisMonth}
          label="Converted this month"
          hint="Now on Deals"
          tone="amber"
          href="/admin/deals"
        />
      </AdminStats>

      <AdminPanel className="overflow-visible">
        <div className="flex flex-wrap items-center gap-1 border-b border-[#eceef1] px-4 pt-3">
          {ENQUIRY_STAGE_TABS.map((tab) => {
            const active = !kpiFilter && ((tab.id === "all" && !stageTab) || stageTab === tab.id)
            const count =
              tab.id === "all"
                ? scoped.length
                : scoped.filter((deal) => enquiryCrmStageFromDeal(deal) === tab.id).length
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStageTab(tab.id === "all" ? "" : tab.id)}
                className={cn(
                  "border-b-2 px-2.5 pb-2.5 text-[9px] font-semibold sm:px-3 sm:text-[10px]",
                  active ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-700",
                )}
              >
                {tab.label}
                <span className="ml-1.5 text-[9px] font-medium text-slate-400">{count}</span>
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-[#eceef1] bg-[#fafbfc] p-3">
          <select
            value={sourceFilter}
            onChange={(e) => setListState((current) => ({ ...current, sourceFilter: e.target.value, page: 1 }))}
            className="h-9 rounded-md border bg-white px-3 text-[9px]"
          >
            <option value="">All sources</option>
            {DEAL_SOURCES.map((source) => (
              <option key={source} value={source}>{DEAL_SOURCE_LABELS[source]}</option>
            ))}
          </select>
          <select
            value={temperatureFilter}
            onChange={(e) => setListState((current) => ({
              ...current,
              temperatureFilter: e.target.value as "" | EnquiryTemperature,
              page: 1,
            }))}
            className="h-9 rounded-md border bg-white px-3 text-[9px]"
          >
            <option value="">Warm and cold</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
          </select>
          <EventFilter
            options={eventOptions}
            selectedIds={eventFilter}
            onChange={(next) => setListState((current) => ({ ...current, eventFilter: next, page: 1 }))}
          />
          <select
            value={ownerFilter}
            onChange={(e) => setListState((current) => ({ ...current, ownerFilter: e.target.value, page: 1 }))}
            className="h-9 rounded-md border bg-white px-3 text-[9px]"
          >
            <option value="">All owners</option>
            <option value="unassigned">Unassigned</option>
            {staffOptions.map((owner) => (
              <option key={owner.id} value={owner.id}>{owner.name}</option>
            ))}
          </select>
          <div className="relative w-full min-w-0 sm:ml-auto sm:min-w-[260px] sm:w-auto sm:flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              {...pageSearchProps}
              value={query}
              onChange={(e) => setListState((current) => ({ ...current, query: e.target.value, page: 1 }))}
              placeholder="Search enquiries..."
              className="h-9 w-full rounded-md border pl-9 pr-3 text-[9px] outline-none focus:border-primary/50"
            />
          </div>
        </div>

        {currentCanManageDeals && checkedCount > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-primary/20 bg-red-50/70 px-3 py-2">
            <p className="text-[9px] font-semibold text-slate-800">
              {checkedCount} selected
            </p>
            <select
              value={bulkStage}
              onChange={(event) => setBulkStage(event.target.value as EnquiryCrmStage | "")}
              className="h-8 rounded-md border bg-white px-2 text-[9px]"
            >
              <option value="">Set stage…</option>
              {ENQUIRY_CRM_STAGES.map((stage) => (
                <option key={stage} value={stage}>{ENQUIRY_CRM_STAGE_LABELS[stage]}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending || !bulkStage}
              onClick={applyBulkStage}
              className="h-8 rounded-md bg-slate-900 px-3 text-[9px] font-semibold text-white disabled:opacity-50"
            >
              Apply to selected
            </button>
            <button
              type="button"
              onClick={() => setCheckedIds([])}
              className="h-8 rounded-md px-2 text-[9px] font-semibold text-slate-600 hover:bg-white"
            >
              Clear
            </button>
          </div>
        ) : null}

        <div className={cn(
          "grid min-h-[540px] items-start",
          selected && "xl:grid-cols-[minmax(0,1fr)_400px]",
        )}>
          <div className={cn("hidden min-w-0 overflow-x-auto overscroll-x-contain md:block", selected && "border-r border-[#eceef1]")}>
            <table className="w-full min-w-[860px] text-left">
              <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-[#92969e]">
                <tr>
                  <th className="w-8 px-2 py-2 font-medium">
                    {currentCanManageDeals ? (
                      <input
                        type="checkbox"
                        checked={allPageChecked}
                        onChange={(event) => togglePageChecked(event.target.checked)}
                        aria-label="Select all enquiries on this page"
                      />
                    ) : null}
                  </th>
                  <th className="px-3 py-2 font-medium">Lead</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Warm / Cold</th>
                  <th className="px-3 py-2 font-medium">Interest</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Stage</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Owner</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Last activity</th>
                  <th className="px-3 py-2 font-medium">Next</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f1f3] text-[9px]">
                {paged.map((deal) => {
                  const SourceIcon = sourceIcon(deal.source)
                  const kind = sourceKind(deal.source)
                  const temperature = enquiryTemperatureFromDeal(deal)
                  const temp = temperatureKind(temperature)
                  const notes = enquiryNotesPreview(deal.notes)
                  return (
                    <tr
                      id={`enquiry-${deal.id}`}
                      key={deal.id}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("a,button,input,select,textarea,label")) return
                        if (isModifiedClick(event)) {
                          openInNewTab(adminDealPath(deal.id))
                          return
                        }
                        selectRow(deal.id)
                      }}
                      className={cn(
                        "cursor-pointer hover:bg-slate-50",
                        selected?.id === deal.id && "bg-red-50/70 outline outline-1 outline-primary/30",
                      )}
                    >
                      <td className="px-2 py-3" onClick={(event) => event.stopPropagation()}>
                        {currentCanManageDeals ? (
                          <input
                            type="checkbox"
                            checked={checkedIds.includes(deal.id)}
                            onChange={(event) => toggleChecked(deal.id, event.target.checked)}
                            aria-label={`Select ${deal.reference}`}
                          />
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={adminDealPath(deal.id)}
                          onClick={(event) => event.stopPropagation()}
                          className="font-semibold text-primary hover:underline"
                        >
                          {deal.reference}
                        </Link>
                        {deal.account_id && deal.primary_contact_id && deal.contact_name ? (
                          <Link
                            href={adminContactPath(deal.account_id, deal.primary_contact_id)}
                            onClick={(event) => event.stopPropagation()}
                            className="mt-0.5 block font-medium text-slate-800 hover:text-primary hover:underline"
                          >
                            {deal.contact_name}
                          </Link>
                        ) : (
                          <p className="mt-0.5 font-medium text-slate-800">{deal.contact_name || "—"}</p>
                        )}
                        {deal.account_id && deal.account_name ? (
                          <Link
                            href={adminAccountPath(deal.account_id)}
                            onClick={(event) => event.stopPropagation()}
                            className="mt-0.5 block text-[8px] text-slate-400 hover:text-primary hover:underline"
                          >
                            {deal.account_name}
                          </Link>
                        ) : (
                          <p className="text-[8px] text-slate-400">{deal.account_name || "—"}</p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-start gap-2">
                          <SourceIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <div>
                            <p className="font-medium text-slate-700">{dealSourceLabel(deal.source)}</p>
                            <span className={cn("mt-1 inline-flex rounded px-1.5 py-0.5 text-[8px] font-medium", kind.className)}>
                              {kind.label}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-1 text-[8px] font-medium", temp.className)}>
                          <temp.Icon className="h-3 w-3" />
                          {temp.label}
                        </span>
                      </td>
                      <td className="max-w-[260px] px-3 py-3">
                        <p className="font-medium text-slate-700">{deal.race_name || "—"}</p>
                        <p className="mt-0.5 text-[8px] text-slate-400">{deal.line_summary || "—"}</p>
                        {notes ? (
                          <p className="mt-1 text-[8px] leading-snug text-slate-600" title={deal.notes ?? undefined}>
                            {notes}
                          </p>
                        ) : null}
                        {enquiryNeedsSourcing(deal) ? (
                          <p className="mt-1 text-[8px] font-medium text-amber-700">Needs sourcing</p>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <StatusPill tone={enquiryStageTone(deal)}>{enquiryStageLabel(deal)}</StatusPill>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <p>{deal.owner_name || "Unassigned"}</p>
                        {enquiryAttentionReason(deal) ? (
                          <p className="mt-0.5 text-[8px] font-medium text-red-600">
                            {enquiryAttentionReason(deal)}
                          </p>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                        {relativeActivityTime(enquiryLastActivityAt(deal))}
                      </td>
                      <td className="max-w-[160px] px-3 py-3 font-medium text-slate-700">
                        <p className="truncate" title={suggestedEnquiryAction(enquiryCrmStageFromDeal(deal))}>
                          {suggestedEnquiryAction(enquiryCrmStageFromDeal(deal))}
                        </p>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-14 text-center text-[10px] text-slate-400">
                      No enquiries match this view.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#eceef1] px-4 py-3 text-[8px] text-slate-500">
              <p>
                Showing {rangeStart} to {rangeEnd} of {filtered.length} enquiries
              </p>
              {pageCount > 1 ? (
                <div className="flex items-center gap-1">
                  {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                    <button
                      key={pageNumber}
                      type="button"
                      onClick={() => setListState((current) => ({ ...current, page: pageNumber }))}
                      className={cn(
                        "h-7 min-w-7 rounded-md px-2 font-semibold",
                        pageNumber === currentPage ? "bg-slate-900 text-white" : "hover:bg-slate-100",
                      )}
                    >
                      {pageNumber}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <AdminMobileList>
            {paged.map((deal) => (
              <div key={deal.id} className="flex items-start gap-2 px-3 py-3">
                {currentCanManageDeals ? (
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checkedIds.includes(deal.id)}
                    onChange={(event) => toggleChecked(deal.id, event.target.checked)}
                    aria-label={`Select ${deal.reference}`}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => selectRow(deal.id)}
                  className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-primary">{deal.reference}</p>
                    <p className="mt-0.5 font-medium text-slate-700">{deal.contact_name || deal.account_name || "—"}</p>
                    <p className="mt-1 text-[10px] leading-snug text-slate-600">{enquiryInterestLabel(deal)}</p>
                    {deal.notes ? (
                      <p className="mt-1 text-[9px] leading-snug text-slate-500">{enquiryNotesPreview(deal.notes, 70)}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <StatusPill tone={enquiryStageTone(deal)}>{enquiryStageLabel(deal)}</StatusPill>
                    {enquiryAttentionReason(deal) ? (
                      <p className="mt-1 text-[8px] font-medium text-red-600">{enquiryAttentionReason(deal)}</p>
                    ) : null}
                    <p className="mt-1 text-[8px] text-slate-400">{enquiryTemperatureLabel(enquiryTemperatureFromDeal(deal))}</p>
                    <p className="mt-1 text-[8px] text-slate-400">{relativeActivityTime(enquiryLastActivityAt(deal))}</p>
                  </div>
                </button>
              </div>
            ))}
            {filtered.length === 0 ? (
              <p className="px-4 py-14 text-center text-[10px] text-slate-400">No enquiries match this view.</p>
            ) : null}
          </AdminMobileList>

          {selected && showPreview ? (
            <AdminListPreview
              isDesktop={isDesktop}
              onClose={closePreview}
              previewRef={previewRef}
            >
              <div className="space-y-4 p-5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold text-primary">{selected.reference}</p>
                    <h2 className="mt-1 truncate text-[15px] font-semibold text-slate-900">
                      {selected.contact_name || selected.account_name || "Enquiry"}
                    </h2>
                    <p className="mt-0.5 truncate text-[10px] text-slate-500">{selected.account_name || "—"}</p>
                  </div>
                  <Link
                    href={adminDealPath(selected.id)}
                    className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Open enquiry page"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={closePreview}
                    className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Close enquiry preview"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <StatusPill tone={enquiryStageTone(selected)}>{enquiryStageLabel(selected)}</StatusPill>
                  <StatusPill tone={enquiryTemperatureTone(enquiryTemperatureFromDeal(selected))}>
                    {enquiryTemperatureLabel(enquiryTemperatureFromDeal(selected))}
                  </StatusPill>
                </div>

                <div>
                  <h3 className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Interest</h3>
                  <p className="mt-1 text-[10px] font-medium text-slate-800">{enquiryInterestLabel(selected)}</p>
                  <p className="mt-0.5 text-[9px] text-slate-500">
                    {formatMoneyCompact(selected.currency, selected.total_amount)}
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Notes</h3>
                    {currentCanManageDeals ? (
                      <button
                        type="button"
                        disabled={pending || !notesDirty}
                        onClick={saveNotes}
                        className="text-[8px] font-semibold text-primary disabled:text-slate-300"
                      >
                        Save notes
                      </button>
                    ) : null}
                  </div>
                  {currentCanManageDeals ? (
                    <textarea
                      value={notesDraft}
                      onChange={(event) => setNotesDraft(event.target.value)}
                      placeholder="Other options, dates, budget, or anything they were not sure about."
                      className="mt-2 min-h-24 w-full rounded-md border p-2 text-[9px] text-slate-700"
                    />
                  ) : (
                    <p className="mt-2 rounded-md bg-slate-50 p-2 text-[9px] text-slate-600">
                      {selected.notes?.trim() || "No notes yet."}
                    </p>
                  )}
                </div>

                <div>
                  <h3 className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Availability</h3>
                  <div className="mt-2">
                    <EnquiryAvailability deal={selected} products={stockProducts} />
                  </div>
                </div>

                {currentCanManageDeals ? (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <h3 className="text-[9px] font-semibold text-slate-800">Stage</h3>
                    <p className="mt-0.5 text-[8px] text-slate-500">Changing this saves straight away and sets the next step.</p>
                    <select
                      value={workflowStage}
                      disabled={pending}
                      onChange={(event) => {
                        const stage = event.target.value as EnquiryCrmStage
                        setWorkflowStage(stage)
                        saveStage(stage)
                      }}
                      className="mt-2 h-10 w-full rounded-md border bg-white px-2 text-[9px]"
                    >
                      {ENQUIRY_CRM_STAGES.map((stage) => (
                        <option key={stage} value={stage}>{ENQUIRY_CRM_STAGE_LABELS[stage]}</option>
                      ))}
                    </select>
                    <p className="mt-2 text-[10px] font-medium text-slate-800">Next: {nextStep}</p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <h3 className="text-[9px] font-semibold text-slate-800">Stage</h3>
                    <p className="mt-1 text-[10px] font-medium text-slate-800">{enquiryStageLabel(selected)}</p>
                    <p className="mt-1 text-[9px] text-slate-600">
                      Next: {suggestedEnquiryAction(enquiryCrmStageFromDeal(selected))}
                    </p>
                  </div>
                )}

                {selected.recent_activities[0] ? (
                  <p className="text-[8px] text-slate-500">
                    Last activity: {friendlyDealActivitySummary(selected.recent_activities[0].summary)}
                    {" · "}
                    {relativeActivityTime(selected.recent_activities[0].created_at)}
                  </p>
                ) : null}

                {currentCanManageDeals ? (
                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setShowLogNote((open) => !open)}
                      className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md border text-[9px] font-semibold disabled:opacity-50"
                    >
                      <CheckSquare className="h-3.5 w-3.5" /> Log activity
                    </button>
                    {showLogNote ? (
                      <div className="space-y-2 rounded-md border p-2">
                        <textarea
                          value={logNote}
                          onChange={(event) => setLogNote(event.target.value)}
                          placeholder="What happened?"
                          className="min-h-16 w-full rounded-md border p-2 text-[9px]"
                        />
                        <button
                          type="button"
                          disabled={pending}
                          onClick={submitLogNote}
                          className="h-8 w-full rounded-md bg-slate-900 text-[9px] font-semibold text-white disabled:opacity-50"
                        >
                          Save activity
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <BookingFormPanel
                  dealId={selected.id}
                  dealClosed={
                    enquiryCrmStageFromDeal(selected) === "not_interested"
                  }
                  form={selectedBookingForm}
                  events={
                    selectedBookingForm
                      ? bookingEventsByForm.get(selectedBookingForm.id) ?? []
                      : []
                  }
                  currentCanSend={currentCanSendBookingForm}
                  currentCanSign={currentCanSignBookingForm}
                  currentCanManageDeals={currentCanManageDeals}
                  currentProfileName={currentProfileName}
                  onMovedToDeals={(dealId, reason) =>
                    router.push(
                      adminDealListPath(dealId, reason === "sent" ? "booking_form" : "ready_to_send"),
                    )
                  }
                />
              </div>
            </AdminListPreview>
          ) : null}
        </div>
      </AdminPanel>

      {showCreate ? (
        <DealCreateModal
          accountOptions={accountOptions}
          products={packageOptions}
          suppliers={supplierOptions}
          title="Create new enquiry"
          description="Log the client, at least one product, and notes for any other options they asked about."
          submitLabel="Create enquiry"
          onClose={() => setShowCreate(false)}
          onCreated={(dealId) => {
            setShowCreate(false)
            if (dealId) router.push(adminEnquiryListPath(dealId))
          }}
        />
      ) : null}
    </div>
  )
}
