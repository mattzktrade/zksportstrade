"use client"

import { Fragment, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Archive, ArrowUpDown, CalendarDays, CheckCircle2, MapPin, Pencil, Plus, RotateCcw, Search } from "lucide-react"
import { toast } from "sonner"
import {
  createNativeEvent,
  setNativeEventArchived,
  updateNativeEvent,
  type NativeEventInput,
} from "@/app/(admin)/actions"
import { AdminPageHeader, AdminPanel, AdminStatCard, AdminStats, AdminDesktopTable, AdminMobileList, StatusPill } from "@/components/admin/admin-page-kit"
import { adminEventPath } from "@/lib/admin/event-link"
import {
  EVENT_CATEGORIES,
  EVENT_CATEGORY_LABELS,
  type EventCategory,
} from "@/lib/catalog/event-categories"
import { usePersistedAdminFilters } from "@/lib/admin/use-persisted-admin-filters"
import { pageSearchProps } from "@/lib/browser/laptop-qol"
import { CatalogImageField } from "@/components/admin/catalog-image-field"

export type NativeEventRow = {
  id: string
  category: EventCategory
  name: string
  short_name: string
  location: string
  country: string
  country_code: string
  event_date: string
  date_range: string
  image: string
  season: number
  is_archived: boolean
  product_count: number
}

const EMPTY_EVENT: NativeEventInput = {
  category: "formula_1",
  name: "",
  shortName: "",
  location: "",
  country: "",
  countryCode: "",
  eventDate: "",
  dateRange: "",
  image: "",
  season: new Date().getFullYear() + 1,
}

function toInput(event: NativeEventRow): NativeEventInput {
  return {
    category: event.category,
    name: event.name,
    shortName: event.short_name,
    location: event.location,
    country: event.country,
    countryCode: event.country_code,
    eventDate: event.event_date,
    dateRange: event.date_range,
    image: event.image,
    season: event.season,
  }
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function EventsClient({ events }: { events: NativeEventRow[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [listState, setListState] = usePersistedAdminFilters("zk-admin-events-filters-v1", {
    query: "",
    showArchived: false,
    eventTimingFilter: "future" as "future" | "all",
    categoryFilter: "" as EventCategory | "",
    sortKey: "date" as "date" | "name" | "category" | "products",
    sortDescending: false,
  })
  const { query, showArchived, eventTimingFilter, categoryFilter, sortKey, sortDescending } = listState
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<NativeEventInput>(EMPTY_EVENT)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const today = localDateKey()
    return events.filter((event) => {
      if (!showArchived && event.is_archived) return false
      if (eventTimingFilter === "future" && event.event_date < today) return false
      if (categoryFilter && event.category !== categoryFilter) return false
      return !q || [
        event.name,
        event.short_name,
        event.location,
        event.country,
        String(event.season),
        EVENT_CATEGORY_LABELS[event.category],
      ]
        .some((value) => value.toLowerCase().includes(q))
    }).sort((a, b) => {
      const comparison =
        sortKey === "name"
          ? a.name.localeCompare(b.name)
          : sortKey === "category"
            ? EVENT_CATEGORY_LABELS[a.category].localeCompare(EVENT_CATEGORY_LABELS[b.category])
            : sortKey === "products"
              ? a.product_count - b.product_count
              : a.event_date.localeCompare(b.event_date)
      return sortDescending ? -comparison : comparison
    })
  }, [categoryFilter, eventTimingFilter, events, query, showArchived, sortDescending, sortKey])

  function openCreate() {
    setEditingId(null)
    setForm({ ...EMPTY_EVENT })
    setFormOpen(true)
  }

  function openEdit(event: NativeEventRow) {
    setEditingId(event.id)
    setForm(toInput(event))
    setFormOpen(true)
  }

  function update<K extends keyof NativeEventInput>(key: K, value: NativeEventInput[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function save() {
    startTransition(async () => {
      const result = editingId
        ? await updateNativeEvent(editingId, form)
        : await createNativeEvent(form)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      setFormOpen(false)
      router.refresh()
    })
  }

  function toggleArchive(event: NativeEventRow) {
    if (
      !event.is_archived &&
      !window.confirm(`Archive ${event.name}? All ${event.product_count} linked products will be hidden from sale.`)
    ) return

    startTransition(async () => {
      const result = await setNativeEventArchived(event.id, !event.is_archived)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  function renderEventForm() {
    return (
      <>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{editingId ? "Edit event" : "Create event"}</h2>
          <button type="button" onClick={() => setFormOpen(false)} className="text-sm text-muted-foreground">Cancel</button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Category</span>
            <select value={form.category} onChange={(event) => update("category", event.target.value as EventCategory)} className="h-10 w-full rounded-md border bg-white px-3 text-sm">
              {EVENT_CATEGORIES.map((category) => (
                <option key={category} value={category}>{EVENT_CATEGORY_LABELS[category]}</option>
              ))}
            </select>
          </label>
          {([
            ["name", "Event name", "Singapore Grand Prix"],
            ["shortName", "Short name", "Singapore GP"],
            ["location", "Location / circuit", "Marina Bay"],
            ["country", "Country", "Singapore"],
            ["countryCode", "Country code", "SG"],
            ["dateRange", "Display date range", "09 – 11 Oct"],
          ] as const).map(([key, label, placeholder]) => (
            <label key={key} className="text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">{label}</span>
              <input
                value={String(form[key])}
                onChange={(event) => update(key, event.target.value)}
                placeholder={placeholder}
                className="h-10 w-full rounded-md border bg-white px-3 text-sm outline-none focus:border-primary/50"
              />
            </label>
          ))}
          <CatalogImageField
            className="xl:col-span-2"
            value={form.image}
            onChange={(url) => update("image", url)}
          />
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Event date</span>
            <input type="date" value={form.eventDate} onChange={(event) => update("eventDate", event.target.value)} className="h-10 w-full rounded-md border bg-white px-3 text-sm" />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Season</span>
            <input type="number" min={2020} max={2100} value={form.season} onChange={(event) => update("season", Number(event.target.value))} className="h-10 w-full rounded-md border bg-white px-3 text-sm" />
          </label>
        </div>
        <div className="mt-5 flex justify-end">
          <button type="button" disabled={pending} onClick={save} className="h-10 rounded-md bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50">
            {pending ? "Saving…" : editingId ? "Save event" : "Create event"}
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Inventory / Events"
        description="Create events, then open one to see its products and sales."
        action={
          <button type="button" onClick={openCreate} className="flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white">
            <Plus className="h-4 w-4" /> Add event
          </button>
        }
      />

      <AdminStats className="sm:grid-cols-3">
        <AdminStatCard icon={CalendarDays} value={events.length} label="Total events" tone="blue" />
        <AdminStatCard icon={CheckCircle2} value={events.filter((event) => !event.is_archived).length} label="Active events" tone="green" />
        <AdminStatCard icon={Archive} value={events.filter((event) => event.is_archived).length} label="Archived events" tone="amber" />
      </AdminStats>

      {formOpen && !editingId ? (
        <AdminPanel className="p-5">{renderEventForm()}</AdminPanel>
      ) : null}

      <AdminPanel>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative min-w-0 w-full flex-1 sm:min-w-[280px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input {...pageSearchProps} value={query} onChange={(event) => setListState((current) => ({ ...current, query: event.target.value }))} placeholder="Search event, circuit, country or season..." className="h-10 w-full rounded-md border pl-10 pr-3 text-sm outline-none focus:border-primary/50" />
          </div>
          <select value={eventTimingFilter} onChange={(event) => setListState((current) => ({ ...current, eventTimingFilter: event.target.value as "future" | "all" }))} className="h-10 rounded-md border bg-white px-3 text-sm">
            <option value="future">Future events</option>
            <option value="all">All events</option>
          </select>
          <select value={categoryFilter} onChange={(event) => setListState((current) => ({ ...current, categoryFilter: event.target.value as EventCategory | "" }))} className="h-10 rounded-md border bg-white px-3 text-sm">
            <option value="">All categories</option>
            {EVENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>{EVENT_CATEGORY_LABELS[category]}</option>
            ))}
          </select>
          <select value={sortKey} onChange={(event) => setListState((current) => ({ ...current, sortKey: event.target.value as typeof sortKey }))} className="h-10 rounded-md border bg-white px-3 text-sm">
            <option value="date">Sort: Date</option>
            <option value="name">Sort: Event name</option>
            <option value="category">Sort: Category</option>
            <option value="products">Sort: Product count</option>
          </select>
          <button type="button" onClick={() => setListState((current) => ({ ...current, sortDescending: !current.sortDescending }))} title={sortDescending ? "Descending" : "Ascending"} className="flex h-10 w-10 items-center justify-center rounded-md border bg-white text-slate-500">
            <ArrowUpDown className="h-4 w-4" />
          </button>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showArchived} onChange={(event) => setListState((current) => ({ ...current, showArchived: event.target.checked }))} />
            Show archived
          </label>
        </div>
        <AdminDesktopTable>
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Season</th>
                <th className="px-4 py-3 font-medium">Dates</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Products</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((event) => (
                <Fragment key={event.id}>
                <tr className="hover:bg-slate-50">
                  <td className="px-4 py-3.5">
                    <Link href={adminEventPath(event.id)} className="flex items-center gap-3">
                      <div className="h-12 w-16 rounded-md bg-cover bg-center" style={{ backgroundImage: `url("${event.image.replaceAll('"', "%22")}")` }} />
                      <div>
                        <p className="font-semibold hover:text-primary hover:underline">{event.name}</p>
                        <p className="text-xs text-slate-500">{event.short_name}</p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3.5"><StatusPill tone="blue">{EVENT_CATEGORY_LABELS[event.category]}</StatusPill></td>
                  <td className="px-4 py-3.5">{event.season}</td>
                  <td className="px-4 py-3.5"><p>{event.date_range}</p><p className="text-xs text-slate-500">{event.event_date}</p></td>
                  <td className="px-4 py-3.5"><span className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-slate-500" />{event.location}, {event.country}</span></td>
                  <td className="px-4 py-3.5">
                    <Link href={adminEventPath(event.id)} className="font-semibold hover:text-primary hover:underline">
                      {event.product_count}
                    </Link>
                  </td>
                  <td className="px-4 py-3.5"><StatusPill tone={event.is_archived ? "gray" : "green"}>{event.is_archived ? "Archived" : "Active"}</StatusPill></td>
                  <td className="px-4 py-3.5">
                    <div className="flex gap-2">
                      <button type="button" onClick={() => openEdit(event)} className="flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                      <button type="button" disabled={pending} onClick={() => toggleArchive(event)} className="flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium">
                        {event.is_archived ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                        {event.is_archived ? "Restore" : "Archive"}
                      </button>
                    </div>
                  </td>
                </tr>
                {formOpen && editingId === event.id ? (
                  <tr>
                    <td colSpan={8} className="border-y border-primary/20 bg-red-50/30 p-5">
                      {renderEventForm()}
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              ))}
              {filtered.length === 0 ? <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-500">No events match this view.</td></tr> : null}
            </tbody>
          </table>
        </AdminDesktopTable>
        <AdminMobileList>
          {filtered.map((event) => (
            <div key={event.id} className="space-y-2 px-4 py-3">
              <Link href={adminEventPath(event.id)} className="block">
                <p className="font-semibold text-primary">{event.name}</p>
                <p className="mt-0.5 text-[10px] text-slate-600">{event.date_range || event.event_date} · {event.location}</p>
              </Link>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="blue">{EVENT_CATEGORY_LABELS[event.category]}</StatusPill>
                <StatusPill tone={event.is_archived ? "gray" : "green"}>{event.is_archived ? "Archived" : "Active"}</StatusPill>
                <span className="text-[8px] text-slate-500">{event.product_count} products</span>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => openEdit(event)} className="flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                <button type="button" disabled={pending} onClick={() => toggleArchive(event)} className="flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium">
                  {event.is_archived ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                  {event.is_archived ? "Restore" : "Archive"}
                </button>
              </div>
              {formOpen && editingId === event.id ? (
                <div className="rounded-md border border-primary/20 bg-red-50/30 p-3">{renderEventForm()}</div>
              ) : null}
            </div>
          ))}
          {filtered.length === 0 ? <p className="px-4 py-12 text-center text-sm text-slate-500">No events match this view.</p> : null}
        </AdminMobileList>
      </AdminPanel>
    </div>
  )
}
