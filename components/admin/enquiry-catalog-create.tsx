"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  createEnquiryEvent,
  createEnquiryProduct,
  previewEnquiryCatalogEvent,
  previewEnquiryCatalogProduct,
  selectEnquiryEvent,
  type EnquiryCreatedEvent,
  type EnquiryCreatedProduct,
  type EnquiryEventDraft,
} from "@/app/(admin)/admin/enquiries/enquiry-catalog-actions"
import { SearchableSelect } from "@/components/admin/searchable-select"
import { COUNTRY_OPTIONS } from "@/lib/catalog/countries"
import {
  ENQUIRY_EVENT_CATEGORIES,
  EVENT_CATEGORY_LABELS,
  isEnquiryEventCategory,
  type EventCategory,
} from "@/lib/catalog/event-categories"
import { PACKAGE_DURATION_OPTIONS } from "@/lib/catalog/package-duration"
import type { EventCatalogMatch, ProductCatalogMatch } from "@/lib/catalog/enquiry-catalog-match"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import type { DealEventOption } from "@/lib/crm/deal-types"
import { cn } from "@/lib/utils"

const NEW_EVENT = "__new__"

function fieldClass(compact?: boolean) {
  return cn("h-10 w-full rounded-md border bg-white px-3", compact ? "text-[10px]" : "text-sm")
}

function eventDraft(input: {
  category: EventCategory | ""
  name: string
  circuit: string
  location: string
  countryCode: string
  eventDate: string
}): EnquiryEventDraft | null {
  if (!isEnquiryEventCategory(input.category)) return null
  const country = COUNTRY_OPTIONS.find((option) => option.code === input.countryCode)
  return {
    category: input.category,
    name: input.name,
    circuit: input.circuit,
    location: input.location,
    country: country?.name ?? "",
    countryCode: input.countryCode,
    eventDate: input.eventDate,
  }
}

export function EnquiryCatalogCreate({
  mode,
  events,
  compact = false,
  onEventChosen,
  onProductChosen,
  onClose,
}: {
  mode: "event" | "product"
  events: DealEventOption[]
  compact?: boolean
  onEventChosen?: (event: EnquiryCreatedEvent) => void
  onProductChosen?: (product: EnquiryCreatedProduct, event: EnquiryCreatedEvent) => void
  onClose?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [category, setCategory] = useState<EventCategory | "">("")
  const [eventName, setEventName] = useState("")
  const [circuit, setCircuit] = useState("")
  const [location, setLocation] = useState("")
  const [countryCode, setCountryCode] = useState("")
  const [eventDate, setEventDate] = useState("")
  const [raceId, setRaceId] = useState("")
  const [productName, setProductName] = useState("")
  const [duration, setDuration] = useState("")
  const [eventMatches, setEventMatches] = useState<EventCatalogMatch[]>([])
  const [productMatches, setProductMatches] = useState<ProductCatalogMatch[]>([])
  const [extraEvents, setExtraEvents] = useState<DealEventOption[]>([])

  const eventOptions = useMemo(() => {
    const byId = new Map(events.map((event) => [event.id, event]))
    for (const event of extraEvents) {
      if (!byId.has(event.id)) byId.set(event.id, event)
    }
    return [...byId.values()]
  }, [events, extraEvents])
  const creatingNewEvent = mode === "event" || raceId === NEW_EVENT
  const selectedEvent = eventOptions.find((event) => event.id === raceId) ?? null
  const selectedIsF1 = selectedEvent?.category === "formula_1"
  const draft = useMemo(
    () => eventDraft({ category, name: eventName, circuit, location, countryCode, eventDate }),
    [category, circuit, countryCode, eventDate, eventName, location],
  )

  useEffect(() => {
    if (!creatingNewEvent) {
      setEventMatches([])
      return
    }
    if (!eventName.trim() || eventName.trim().length < 3) {
      setEventMatches([])
      return
    }
    const previewDraft =
      draft ??
      eventDraft({
        category: ENQUIRY_EVENT_CATEGORIES[0],
        name: eventName,
        circuit,
        location,
        countryCode,
        eventDate,
      })
    if (!previewDraft) {
      setEventMatches([])
      return
    }
    const handle = window.setTimeout(() => {
      void previewEnquiryCatalogEvent(previewDraft).then((result) => {
        if (result.ok) setEventMatches(result.matches)
      })
    }, 280)
    return () => window.clearTimeout(handle)
  }, [circuit, countryCode, creatingNewEvent, draft, eventDate, eventName, location])

  useEffect(() => {
    if (mode !== "product" || !productName.trim() || productName.trim().length < 2) {
      setProductMatches([])
      return
    }
    const resolvedRaceId = raceId && raceId !== NEW_EVENT ? raceId : ""
    if (!resolvedRaceId) {
      setProductMatches([])
      return
    }
    const handle = window.setTimeout(() => {
      void previewEnquiryCatalogProduct({
        raceId: resolvedRaceId,
        name: productName,
        duration: duration || null,
      }).then((result) => {
        if (result.ok) setProductMatches(result.matches)
      })
    }, 280)
    return () => window.clearTimeout(handle)
  }, [duration, mode, productName, raceId])

  function rememberEvent(event: EnquiryCreatedEvent) {
    setExtraEvents((current) =>
      current.some((item) => item.id === event.id)
        ? current
        : [...current, { id: event.id, label: event.label, eventDate: event.eventDate, category: event.category }],
    )
  }

  function useEvent(match: EventCatalogMatch) {
    startTransition(async () => {
      const result = await selectEnquiryEvent(match.id)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      rememberEvent(result.event)
      if (mode === "event") {
        onEventChosen?.(result.event)
        onClose?.()
        return
      }
      setRaceId(result.event.id)
      setEventMatches([])
    })
  }

  function save() {
    startTransition(async () => {
      if (mode === "event") {
        if (!draft) {
          toast.error("Select a category.")
          return
        }
        if (eventMatches.length > 0) {
          toast.error("Use the existing event instead of creating a duplicate.")
          return
        }
        const result = await createEnquiryEvent(draft)
        if (!result.ok) {
          toast.error(result.message)
          if (result.matches) setEventMatches(result.matches)
          return
        }
        toast.success(result.created ? "Event created. It stays off the portal until inventory publishes it." : "Using the existing event.")
        onEventChosen?.(result.event)
        onClose?.()
        return
      }

      if (productMatches.length > 0 && raceId && raceId !== NEW_EVENT) {
        toast.error("Use the existing product instead of creating a duplicate.")
        return
      }
      if (creatingNewEvent && eventMatches.length > 0) {
        toast.error("Use the existing event instead of creating a duplicate.")
        return
      }
      if (selectedIsF1 && !duration) {
        toast.error("Choose 3 day, 2 day, or a single-day option.")
        return
      }
      if (creatingNewEvent && !draft) {
        toast.error("Select a category.")
        return
      }
      const result = await createEnquiryProduct({
        raceId: raceId && raceId !== NEW_EVENT ? raceId : null,
        newEvent: creatingNewEvent ? draft : null,
        name: productName,
        duration: duration || null,
      })
      if (!result.ok) {
        toast.error(result.message)
        if (result.matches) setProductMatches(result.matches)
        return
      }
      toast.success(
        result.created
          ? "Product created. It stays off the portal and has no stock until you buy or broker it."
          : "Using the existing product.",
      )
      onProductChosen?.(result.product, result.event)
      onClose?.()
    })
  }

  const blockedByEvent = creatingNewEvent && eventMatches.length > 0
  const blockedByProduct = mode === "product" && productMatches.length > 0 && raceId !== NEW_EVENT && Boolean(raceId)
  const canSave =
    mode === "event"
      ? Boolean(category && eventName.trim() && circuit.trim() && location.trim() && countryCode && eventDate)
      : Boolean(
          productName.trim() &&
            (raceId && raceId !== NEW_EVENT
              ? true
              : category && eventName.trim() && circuit.trim() && location.trim() && countryCode && eventDate),
        )

  return (
    <div className={cn("rounded-lg border border-slate-200 bg-slate-50/80 p-3", compact && "text-[10px]")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn("font-semibold", compact ? "text-[10px]" : "text-sm")}>
            {mode === "event" ? "Create a new event" : "Create a new product"}
          </p>
          <p className={cn("mt-0.5 text-slate-500", compact ? "text-[9px]" : "text-xs")}>
            {mode === "event"
              ? "For sports, concerts, and other non-F1 events we do not already have. Formula 1 races stay in Inventory → Events."
              : "Search first. If nothing matches, add a hidden product on an existing event — including F1 — or create a non-F1 event."}
          </p>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} className="text-xs font-medium text-slate-500 hover:underline">
            Cancel
          </button>
        ) : null}
      </div>

      {mode === "product" ? (
        <label className={cn("mt-3 block", compact ? "text-[9px]" : "text-xs")}>
          <span className="mb-1 block font-medium text-slate-600">Event</span>
          <SearchableSelect
            value={raceId}
            onChange={setRaceId}
            options={[
              { value: NEW_EVENT, label: "New event (not Formula 1)" },
              ...eventOptions.map((event) => ({ value: event.id, label: event.label })),
            ]}
            placeholder="Search events, or create a new one"
            emptyLabel="No events match"
            optionClassName={compact ? "py-1.5 text-[10px]" : "py-2 text-sm"}
            className={fieldClass(compact)}
          />
        </label>
      ) : null}

      {creatingNewEvent ? (
        <div className={cn("mt-3 grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
          <label className={compact ? "text-[9px]" : "text-xs"}>
            <span className="mb-1 block font-medium text-slate-600">Category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as EventCategory | "")}
              className={fieldClass(compact)}
            >
              <option value="">Select a category</option>
              {ENQUIRY_EVENT_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {EVENT_CATEGORY_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <label className={compact ? "text-[9px]" : "text-xs"}>
            <span className="mb-1 block font-medium text-slate-600">Event name</span>
            <input
              value={eventName}
              onChange={(event) => setEventName(event.target.value)}
              placeholder="Wimbledon"
              className={fieldClass(compact)}
            />
          </label>
          <label className={compact ? "text-[9px]" : "text-xs"}>
            <span className="mb-1 block font-medium text-slate-600">Venue</span>
            <input
              value={circuit}
              onChange={(event) => setCircuit(event.target.value)}
              placeholder="All England Lawn Tennis Club"
              className={fieldClass(compact)}
            />
          </label>
          <label className={compact ? "text-[9px]" : "text-xs"}>
            <span className="mb-1 block font-medium text-slate-600">City / location</span>
            <input
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="London"
              className={fieldClass(compact)}
            />
          </label>
          <label className={compact ? "text-[9px]" : "text-xs"}>
            <span className="mb-1 block font-medium text-slate-600">Country</span>
            <SearchableSelect
              value={countryCode}
              onChange={setCountryCode}
              options={COUNTRY_OPTIONS.map((country) => ({ value: country.code, label: country.name }))}
              placeholder="Search countries"
              emptyLabel="No countries match"
              optionClassName={compact ? "py-1.5 text-[10px]" : "py-2 text-sm"}
              className={fieldClass(compact)}
            />
          </label>
          <label className={compact ? "text-[9px]" : "text-xs"}>
            <span className="mb-1 block font-medium text-slate-600">Event date</span>
            <input
              type="date"
              value={eventDate}
              onChange={(event) => setEventDate(event.target.value)}
              className={fieldClass(compact)}
            />
          </label>
        </div>
      ) : null}

      {eventMatches.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2">
          <p className={cn("font-medium text-amber-900", compact ? "text-[9px]" : "text-xs")}>
            This looks like an event we already have. Use it instead of creating another.
          </p>
          <div className="mt-2 space-y-1">
            {eventMatches.map((match) => (
              <button
                key={match.id}
                type="button"
                onClick={() => useEvent(match)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md border border-amber-200 bg-white px-3 py-2 text-left hover:bg-amber-50",
                  compact ? "text-[9px]" : "text-sm",
                )}
              >
                <span>
                  <span className="font-medium">{match.name}</span>
                  {match.season ? <span className="text-slate-500"> · {match.season}</span> : null}
                  {match.isArchived ? <span className="text-amber-700"> · archived</span> : null}
                </span>
                <span className="font-medium text-primary">Use this event</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mode === "product" ? (
        <div className={cn("mt-3 grid gap-2", selectedIsF1 && !compact ? "sm:grid-cols-2" : "grid-cols-1")}>
          <label className={compact ? "text-[9px]" : "text-xs"}>
            <span className="mb-1 block font-medium text-slate-600">Product name</span>
            <input
              value={productName}
              onChange={(event) => setProductName(event.target.value)}
              placeholder="Centre Court hospitality"
              className={fieldClass(compact)}
            />
          </label>
          {selectedIsF1 ? (
            <label className={compact ? "text-[9px]" : "text-xs"}>
              <span className="mb-1 block font-medium text-slate-600">Duration</span>
              <select value={duration} onChange={(event) => setDuration(event.target.value)} className={fieldClass(compact)}>
                <option value="">Choose duration…</option>
                {PACKAGE_DURATION_OPTIONS.filter((option) => option.value).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      {productMatches.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2">
          <p className={cn("font-medium text-amber-900", compact ? "text-[9px]" : "text-xs")}>
            This looks like a product we already have on that event.
          </p>
          <div className="mt-2 space-y-1">
            {productMatches.map((match) => (
              <button
                key={match.id}
                type="button"
                onClick={() => {
                  const event = selectedEvent
                    ? {
                        id: selectedEvent.id,
                        label: selectedEvent.label,
                        eventDate: selectedEvent.eventDate,
                        category: selectedEvent.category ?? null,
                        isArchived: false,
                      }
                    : {
                        id: match.raceId,
                        label: eventSeasonLabel(match.name, null),
                        eventDate: null,
                        category: null,
                        isArchived: false,
                      }
                  onProductChosen?.(
                    {
                      id: match.id,
                      label: `${event.label} — ${match.name}`,
                      eventId: match.raceId,
                      eventName: event.label,
                      packageName: match.name,
                      price: null,
                      currency: "USD",
                      stockLeft: 0,
                    },
                    event,
                  )
                  onClose?.()
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-md border border-amber-200 bg-white px-3 py-2 text-left hover:bg-amber-50",
                  compact ? "text-[9px]" : "text-sm",
                )}
              >
                <span className="font-medium">{match.name}</span>
                <span className="font-medium text-primary">Use this product</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={pending || !canSave || blockedByEvent || blockedByProduct}
          onClick={save}
          className={cn(
            "rounded-md bg-primary px-4 font-semibold text-white disabled:opacity-50",
            compact ? "h-8 text-[10px]" : "h-10 text-sm",
          )}
        >
          {pending ? "Saving…" : blockedByEvent || blockedByProduct ? "Use the match above" : mode === "event" ? "Create event" : "Create product"}
        </button>
      </div>
    </div>
  )
}

