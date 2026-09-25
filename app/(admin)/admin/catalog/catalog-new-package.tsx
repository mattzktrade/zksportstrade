"use client"

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createNativeEvent, createPackage, updatePackageFields, uploadPurchaseOrderDocument } from "@/app/(admin)/actions"
import { createPackageBrochure } from "@/app/(admin)/admin/catalog/brochure-actions"
import { CompanySupplierSelect } from "@/components/admin/company-supplier-select"
import type { AdminRaceOption } from "@/lib/admin/queries"
import { adminRaceLabel } from "@/lib/admin/race-label"
import {
  EVENT_CATEGORIES,
  EVENT_CATEGORY_LABELS,
  isEventCategory,
  type EventCategory,
} from "@/lib/catalog/event-categories"
import { findPackageTemplate, PACKAGE_TEMPLATES } from "@/lib/catalog/package-templates"
import { PACKAGE_DURATION_OPTIONS } from "@/lib/catalog/package-duration"
import { packageEventDefaultsFromRace } from "@/lib/catalog/race-circuit"
import { CatalogImageField } from "@/components/admin/catalog-image-field"
import { PackageCopyFields } from "@/components/admin/package-copy-fields"
import { PackageFaqFields } from "@/components/admin/package-faq-fields"
import { suggestedPackageFaqs, type PackageFaq, type PackageFaqSource } from "@/lib/catalog/package-faqs"

const NEW_EVENT_ID = "__new__"

const NAME_PLACEHOLDERS: Record<EventCategory, string> = {
  formula_1: "3 Day Legend Paddock Club",
  tennis: "Centre Court Hospitality",
  football: "Hospitality suite",
  concert: "VIP experience",
  other: "Hospitality package",
}

function raceCategory(race: Pick<AdminRaceOption, "category"> | undefined): EventCategory {
  const value = String(race?.category ?? "")
  return isEventCategory(value) ? value : "formula_1"
}

function missingFaqsColumn(message: string) {
  return /faqs/i.test(message) && /schema cache|column/i.test(message)
}

function linesToList(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
}

const FIELD_MESSAGE = "Complete this field."

function inputClass(invalid: boolean) {
  return `mt-1.5 w-full px-3 py-2 rounded-lg border bg-background text-sm ${invalid ? "border-destructive" : "border-border"}`
}

function FormSection({
  step,
  title,
  hint,
  children,
}: {
  step: string
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {step}. {title}
        </h3>
        {hint ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Field({
  id,
  label,
  required,
  error,
  hint,
  className,
  children,
}: {
  id: string
  label: string
  required?: boolean
  error?: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div id={id} className={className ?? "block"}>
      <label className="block text-xs text-muted-foreground">
        <span>
          {label}
          {required ? <span className="text-primary"> *</span> : null}
        </span>
        {children}
      </label>
      {error ? <p className="mt-1 text-xs font-medium text-destructive">{error}</p> : null}
      {hint && !error ? <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/80">{hint}</p> : null}
    </div>
  )
}

export function CatalogNewPackage({
  races,
  open,
  onOpenChange,
  onCreated,
}: {
  races: AdminRaceOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}) {
  const router = useRouter()
  const formRef = useRef<HTMLDivElement>(null)
  const [pending, start] = useTransition()

  const [eventCategory, setEventCategory] = useState<EventCategory>("formula_1")
  const [templateId, setTemplateId] = useState("")
  const [raceId, setRaceId] = useState(races[0]?.id ?? "")
  const [newEventName, setNewEventName] = useState("")
  const [newEventShortName, setNewEventShortName] = useState("")
  const [newEventSeason, setNewEventSeason] = useState(new Date().getFullYear())
  const [sellOnWix, setSellOnWix] = useState(false)
  const [wixMultiplier, setWixMultiplier] = useState("")
  const [wixManualPrice, setWixManualPrice] = useState("")
  const [name, setName] = useState("")
  const [circuit, setCircuit] = useState("")
  const [location, setLocation] = useState("")
  const [country, setCountry] = useState("")
  const [countryCode, setCountryCode] = useState("")
  const [eventDate, setEventDate] = useState("")
  const [dateRange, setDateRange] = useState("")
  const [description, setDescription] = useState("")
  const [image, setImage] = useState("")
  const [galleryText, setGalleryText] = useState("")
  const [trackMap, setTrackMap] = useState("")
  const [includesText, setIncludesText] = useState("")
  const [tradePrice, setTradePrice] = useState("")
  const [isEnquiry, setIsEnquiry] = useState(false)
  const [requiresBookingApproval, setRequiresBookingApproval] = useState(false)
  const [featured, setFeatured] = useState(false)
  const [isHidden, setIsHidden] = useState(false)
  const [brochureUrl, setBrochureUrl] = useState("")
  const [initialQty, setInitialQty] = useState("0")
  const [initialUnitCost, setInitialUnitCost] = useState("")
  const [initialSupplierAccountId, setInitialSupplierAccountId] = useState("")
  const [initialSupplierReference, setInitialSupplierReference] = useState("")
  const [initialIssuedAt, setInitialIssuedAt] = useState("")
  const [initialPaymentDueDate, setInitialPaymentDueDate] = useState("")
  const [initialPoNote, setInitialPoNote] = useState("")
  const [faqs, setFaqs] = useState<PackageFaq[]>([])
  const [createdPackageId, setCreatedPackageId] = useState<string | null>(null)
  const [savedRaceId, setSavedRaceId] = useState<string | null>(null)
  const [brochureUrlLive, setBrochureUrlLive] = useState<string | null>(null)
  const [initialFiles, setInitialFiles] = useState<File[]>([])
  const [duration, setDuration] = useState("")
  const [inventoryIsStandalone, setInventoryIsStandalone] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const createFileInputRef = useRef<HTMLInputElement>(null)

  const isFormula1 = eventCategory === "formula_1"
  const creatingNewEvent = !isFormula1 && raceId === NEW_EVENT_ID
  const selectedRace = races.find((r) => r.id === raceId)
  const eventsForCategory = useMemo(
    () => races.filter((race) => raceCategory(race) === eventCategory),
    [eventCategory, races],
  )

  function applyRaceDefaults(race: AdminRaceOption) {
    const defaults = packageEventDefaultsFromRace(race)
    setLocation(defaults.location)
    setCountry(defaults.country)
    setCountryCode(defaults.countryCode)
    setDateRange(defaults.dateRange)
    setEventDate(defaults.eventDate)
    setCircuit(defaults.circuit)
    setImage(defaults.image)
  }

  function clearEventDefaults() {
    setCircuit("")
    setLocation("")
    setCountry("")
    setCountryCode("")
    setEventDate("")
    setDateRange("")
    setImage("")
  }

  function resetForm() {
    const firstF1 = races.find((race) => raceCategory(race) === "formula_1") ?? races[0]
    setEventCategory("formula_1")
    setTemplateId("")
    setRaceId(firstF1?.id ?? "")
    setNewEventName("")
    setNewEventShortName("")
    setNewEventSeason(new Date().getFullYear())
    setSellOnWix(false)
    setWixMultiplier("")
    setWixManualPrice("")
    setName("")
    setDescription("")
    setImage("")
    setGalleryText("")
    setIncludesText("")
    setTradePrice("")
    setIsEnquiry(false)
    setRequiresBookingApproval(false)
    setFeatured(false)
    setIsHidden(false)
    setBrochureUrl("")
    setInitialQty("0")
    setInitialUnitCost("")
    setInitialSupplierAccountId("")
    setInitialSupplierReference("")
    setInitialIssuedAt("")
    setInitialPaymentDueDate("")
    setInitialPoNote("")
    setFaqs(
      suggestedPackageFaqs({
        name: "",
        circuit: "",
        location: "",
        country: "",
        eventDate: "",
        dateRange: "",
        description: "",
        includes: [],
        currency: "USD",
        tradePrice: null,
        isEnquiry: false,
      }),
    )
    setCreatedPackageId(null)
    setSavedRaceId(null)
    setBrochureUrlLive(null)
    setInitialFiles([])
    if (createFileInputRef.current) createFileInputRef.current.value = ""
    setDuration("")
    setInventoryIsStandalone(false)
    setFieldErrors({})
    if (firstF1) applyRaceDefaults(firstF1)
    else clearEventDefaults()
  }

  function selectCategory(next: EventCategory) {
    setEventCategory(next)
    setTemplateId("")
    if (next !== "formula_1") {
      setDuration("")
      setInventoryIsStandalone(false)
    }
    const matching = races.filter((race) => raceCategory(race) === next)
    if (matching[0]) {
      setRaceId(matching[0].id)
      applyRaceDefaults(matching[0])
      return
    }
    if (next === "formula_1") {
      setRaceId("")
      clearEventDefaults()
      return
    }
    setRaceId(NEW_EVENT_ID)
    clearEventDefaults()
  }

  function applyTemplate(id: string) {
    setTemplateId(id)
    if (!id) return
    const t = findPackageTemplate(id)
    if (!t) return
    setName(t.nameSuffix)
    setDescription(t.description)
    setIncludesText(t.includes.join("\n"))
    if (t.requiresBookingApproval != null) {
      setRequiresBookingApproval(t.requiresBookingApproval)
    }
    setIsEnquiry(false)
  }

  useEffect(() => {
    if (!open) return
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [open])

  useEffect(() => {
    if (isEnquiry || isHidden) {
      setSellOnWix(false)
      setWixMultiplier("")
      setWixManualPrice("")
    }
  }, [isEnquiry, isHidden])

  useEffect(() => {
    if (!selectedRace) return
    applyRaceDefaults(selectedRace)
  }, [raceId, selectedRace])

  useEffect(() => {
    if (open) resetForm()
  }, [open])

  function parsePrice(): number | null {
    const t = tradePrice.trim()
    if (t === "") return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  const tradePriceNumber = parsePrice()

  function clearError(key: string) {
    setFieldErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const faqSource: PackageFaqSource = {
    name,
    raceName: creatingNewEvent ? newEventName : selectedRace?.name,
    circuit,
    location,
    country,
    eventDate,
    dateRange,
    duration,
    description,
    includes: linesToList(includesText),
    currency: "USD",
    tradePrice: tradePriceNumber,
    isEnquiry: false,
  }

  async function persistProduct(): Promise<string | null | undefined> {
      const errors: Record<string, string> = {}
      const need = (key: string, missing: boolean) => {
        if (missing) errors[key] = FIELD_MESSAGE
      }
      if (!creatingNewEvent) need("race", !raceId)
      if (creatingNewEvent) {
        need("eventName", !newEventName.trim())
        need("eventShort", !newEventShortName.trim())
        need("location", !location.trim())
        need("country", !country.trim())
        need("countryCode", !countryCode.trim())
        need("eventDate", !eventDate.trim())
        need("dateRange", !dateRange.trim())
      }
      need("name", !name.trim())
      if (isFormula1) need("duration", !duration.trim())
      need("circuit", !circuit.trim())
      const qtyPreview = Math.floor(Number(initialQty))
      if (Number.isFinite(qtyPreview) && qtyPreview > 0) need("source", !initialSupplierAccountId)
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors)
        const first = document.getElementById(Object.keys(errors)[0] ?? "")
        first?.scrollIntoView({ behavior: "smooth", block: "center" })
        return
      }
      setFieldErrors({})
      const price = parsePrice()
      if (tradePrice.trim() !== "" && price === null) {
        toast.error("Trade price must be a number or empty.")
        return
      }
      const qty = Math.floor(Number(initialQty))
      if (!Number.isFinite(qty) || qty < 0) {
        toast.error("Initial stock must be a non-negative whole number.")
        return
      }
      if (qty > 0 && !initialSupplierAccountId) {
        toast.error("Select a company as the source.")
        return
      }
      if (qty <= 0 && (initialFiles.length > 0 || initialSupplierReference.trim() || initialIssuedAt.trim())) {
        toast.error("Add initial stock before attaching a contract/invoice to this product.")
        return
      }
      let initialCost: number | null = null
      if (initialUnitCost.trim() !== "") {
        const c = Number(initialUnitCost)
        if (!Number.isFinite(c) || c < 0) {
          toast.error("Initial buy price must be a non-negative number.")
          return
        }
        initialCost = c
      }
      if (initialIssuedAt.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(initialIssuedAt.trim())) {
        toast.error("Issued date must be YYYY-MM-DD.")
        return
      }
      if (initialPaymentDueDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(initialPaymentDueDate.trim())) {
        toast.error("Payment due date must be YYYY-MM-DD.")
        return
      }
      if (initialPaymentDueDate.trim() && qty <= 0) {
        toast.error("Add initial stock before setting a payment due date.")
        return
      }

      let mult: number | null = null
      if (sellOnWix && wixMultiplier.trim() !== "") {
        const n = Number(wixMultiplier)
        if (!Number.isFinite(n) || n <= 0) {
          toast.error("Wix price multiplier must be a positive number (e.g. 1.1).")
          return
        }
        mult = n
      }
      let manualWix: number | null = null
      if (sellOnWix && wixManualPrice.trim() !== "") {
        const n = Number(wixManualPrice)
        if (!Number.isFinite(n) || n < 0) {
          toast.error("Manual Wix price must be zero or a positive number.")
          return
        }
        manualWix = n
      }
      if (sellOnWix && !isEnquiry && price == null && manualWix == null) {
        toast.error("Sell on Wix needs a trade price or a manual Wix price.")
        return
      }

      const packageFields = {
        name: name.trim(),
        circuit: circuit.trim(),
        location: location.trim(),
        country: country.trim(),
        country_code: countryCode.trim(),
        event_date: eventDate.trim(),
        date_range: dateRange.trim(),
        description: description.trim(),
        image: image.trim() || null,
        gallery_images: linesToList(galleryText),
        track_map: trackMap.trim() || null,
        currency: "USD",
        total_capacity: 0,
        duration,
        inventory_is_standalone: inventoryIsStandalone,
        includes: linesToList(includesText),
        trade_price: price,
        is_enquiry: isEnquiry,
        requires_booking_approval: requiresBookingApproval,
        featured,
        is_hidden: isHidden,
        sort_order: 100,
        brochure_url: brochureUrlLive,
        faqs,
      }

      if (createdPackageId && savedRaceId) {
        let updated = await updatePackageFields({
          packageId: createdPackageId,
          race_id: savedRaceId,
          ...packageFields,
        })
        if (!updated.ok && missingFaqsColumn(updated.message)) {
          updated = await updatePackageFields({
            packageId: createdPackageId,
            race_id: savedRaceId,
            ...packageFields,
            skipFaqs: true,
          })
          if (updated.ok) toast.message("FAQs were not saved. The database does not have the faqs column yet.")
        }
        if (!updated.ok) {
          toast.error(updated.message)
          return null
        }
        return createdPackageId
      }

      let packageRaceId = raceId
      if (creatingNewEvent) {
        const eventRes = await createNativeEvent({
          category: eventCategory,
          name: newEventName.trim(),
          shortName: newEventShortName.trim(),
          circuit: circuit.trim(),
          location: location.trim(),
          country: country.trim(),
          countryCode: countryCode.trim(),
          eventDate: eventDate.trim(),
          dateRange: dateRange.trim(),
          image: image.trim(),
          season: newEventSeason,
        })
        if (!eventRes.ok || !eventRes.eventId) {
          toast.error(eventRes.ok ? "Event was created but its ID was missing." : eventRes.message)
          return
        }
        packageRaceId = eventRes.eventId
      }

      let res = await createPackage({
        race_id: packageRaceId,
        ...packageFields,
        sell_on_wix: sellOnWix,
        retail_price_multiplier: mult,
        wix_retail_price: manualWix,
        initial_qty_available: qty,
        initial_unit_cost: initialCost,
        initial_cost_note: initialPoNote.trim() || null,
        initial_supplier_account_id: initialSupplierAccountId || null,
        initial_supplier_reference: initialSupplierReference.trim() || null,
        initial_issued_at: initialIssuedAt.trim() || null,
        initial_payment_due_date: initialPaymentDueDate.trim() || null,
        initial_po_note: initialPoNote.trim() || null,
      })
      if (!res.ok && missingFaqsColumn(res.message)) {
        res = await createPackage({
          race_id: packageRaceId,
          ...packageFields,
          skipFaqs: true,
          sell_on_wix: sellOnWix,
          retail_price_multiplier: mult,
          wix_retail_price: manualWix,
          initial_qty_available: qty,
          initial_unit_cost: initialCost,
          initial_cost_note: initialPoNote.trim() || null,
          initial_supplier_account_id: initialSupplierAccountId || null,
          initial_supplier_reference: initialSupplierReference.trim() || null,
          initial_issued_at: initialIssuedAt.trim() || null,
          initial_payment_due_date: initialPaymentDueDate.trim() || null,
          initial_po_note: initialPoNote.trim() || null,
        })
        if (res.ok) toast.message("FAQs were not saved. The database does not have the faqs column yet.")
      }
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      const files = [...initialFiles]
      let uploadFailed = 0
      if (res.purchaseOrderId && files.length > 0) {
        for (const file of files) {
          const fd = new FormData()
          fd.set("purchaseOrderId", res.purchaseOrderId)
          fd.set("file", file)
          const uploaded = await uploadPurchaseOrderDocument(fd)
          if (!uploaded.ok) uploadFailed += 1
        }
      }
      const msg = res.message ?? "Package created."
      if (/Wix product was not created|Wix API is not configured/i.test(msg)) {
        toast.message(msg, { duration: 12000 })
      } else if (uploadFailed > 0) {
        toast.success("Package created, but some attachments failed to upload.")
      } else {
        toast.success(
          files.length > 0 && res.purchaseOrderId
            ? "Package created with purchase-order attachments."
            : msg,
          { duration: 8000 },
        )
      }
      setCreatedPackageId(res.packageId)
      setSavedRaceId(packageRaceId)
      onCreated?.()
      router.refresh()
      return res.packageId
  }

  function submit() {
    start(async () => {
      await persistProduct()
    })
  }

  function generateBrochure() {
    start(async () => {
      const id = await persistProduct()
      if (!id) return
      const result = await createPackageBrochure({ packageId: id, replace: Boolean(brochureUrlLive) })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setBrochureUrlLive(result.brochureUrl)
      toast.success(result.replaced ? "Brochure updated." : "Brochure created.")
    })
  }

  if (!open) return null

  const noF1Events = isFormula1 && eventsForCategory.length === 0

  return (
    <div
      id="admin-new-package"
      ref={formRef}
      className="scroll-mt-20 rounded-xl border border-border bg-card p-5 sm:p-6 shadow-sm space-y-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">New product</h2>
          <p className="mt-1 text-xs text-muted-foreground">Fields marked with * are required.</p>
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>
      {createdPackageId ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
          Product created. Generate the brochure below, then choose Done.
        </p>
      ) : null}
      {Object.keys(fieldErrors).length > 0 ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Complete the highlighted fields before creating the product.
        </p>
      ) : null}

      <FormSection step="1" title="Event" hint="Choose the event this product belongs to.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="event-type" label="Event type" className="sm:col-span-2" hint="Formula 1 uses race templates and shared day-split stock.">
          <select
            value={eventCategory}
            onChange={(e) => selectCategory(e.target.value as EventCategory)}
            className={inputClass(false)}
          >
            {EVENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {EVENT_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
        </Field>

        {isFormula1 ? (
          <Field id="template" label="Template" className="sm:col-span-2" hint="Optional. Fills the name, description, and inclusions.">
            <select
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              className={inputClass(false)}
            >
              <option value="">Start from scratch</option>
              {PACKAGE_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {noF1Events ? (
          <p className="sm:col-span-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-4">
            Add at least one Formula 1 event under Inventory → Events before creating F1 packages.
          </p>
        ) : (
          <Field
            id="race"
            label={isFormula1 ? "Race" : "Event"}
            required
            error={fieldErrors.race}
            className="sm:col-span-2"
            hint={!isFormula1 ? `Choose an existing ${EVENT_CATEGORY_LABELS[eventCategory].toLowerCase()} event, or create one here.` : undefined}
          >
            <select
              value={raceId}
              onChange={(e) => {
                const next = e.target.value
                setRaceId(next)
                clearError("race")
                if (next === NEW_EVENT_ID) clearEventDefaults()
              }}
              className={inputClass(Boolean(fieldErrors.race))}
            >
              {eventsForCategory.map((r) => (
                <option key={r.id} value={r.id}>
                  {adminRaceLabel(r)}
                </option>
              ))}
              {!isFormula1 ? <option value={NEW_EVENT_ID}>Create new event…</option> : null}
            </select>
          </Field>
        )}

        {creatingNewEvent ? (
          <>
            <Field id="eventName" label="Event name" required error={fieldErrors.eventName}>
              <input
                value={newEventName}
                onChange={(e) => {
                  const value = e.target.value
                  setNewEventName(value)
                  clearError("eventName")
                  if (!circuit.trim()) setCircuit(value)
                }}
                className={inputClass(Boolean(fieldErrors.eventName))}
                placeholder="2026 Wimbledon Championships"
              />
            </Field>
            <Field id="eventShort" label="Short name" required error={fieldErrors.eventShort}>
              <input
                value={newEventShortName}
                onChange={(e) => {
                  setNewEventShortName(e.target.value)
                  clearError("eventShort")
                }}
                className={inputClass(Boolean(fieldErrors.eventShort))}
                placeholder="Wimbledon"
              />
            </Field>
            <Field id="season" label="Season" className="sm:col-span-2 sm:max-w-xs">
              <input
                type="number"
                min={2020}
                max={2100}
                value={newEventSeason}
                onChange={(e) => setNewEventSeason(Number(e.target.value))}
                className={inputClass(false)}
              />
            </Field>
          </>
        ) : null}

      </div>
      </FormSection>

      <FormSection step="2" title="Product" hint="The name guests and agents will see.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Display name" required error={fieldErrors.name} className="sm:col-span-2">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              clearError("name")
            }}
            className={inputClass(Boolean(fieldErrors.name))}
            placeholder={NAME_PLACEHOLDERS[eventCategory]}
          />
        </Field>

        <Field
          id="duration"
          label="Duration"
          required={isFormula1}
          error={fieldErrors.duration}
          className="sm:col-span-2 sm:max-w-md"
          hint={
            isFormula1
              ? "Saturday only, Sunday only, and 3-day options with the same name share stock."
              : "Leave unspecified unless day or session splits should share stock."
          }
        >
          <select
            value={duration}
            onChange={(e) => {
              const next = e.target.value
              setDuration(next)
              clearError("duration")
              if (!next || next === "3_day") setInventoryIsStandalone(false)
            }}
            className={inputClass(Boolean(fieldErrors.duration))}
          >
            {PACKAGE_DURATION_OPTIONS.map((o) => (
              <option key={o.value || "none"} value={o.value} disabled={isFormula1 && o.value === ""}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
          {isFormula1 && duration && duration !== "3_day" ? (
            <label className="mt-2 flex items-start gap-2 rounded-md border border-border p-2.5 text-[11px] leading-relaxed sm:col-span-2">
              <input
                type="checkbox"
                checked={inventoryIsStandalone}
                onChange={(e) => setInventoryIsStandalone(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong>Separate inventory.</strong> Use this when this day package was purchased
                independently rather than taken from the linked 3-day stock.
              </span>
            </label>
          ) : null}
      </div>
      </FormSection>

      <FormSection
        step="3"
        title="Place and dates"
        hint={creatingNewEvent ? "Required for a new event." : "Filled from the event. Change only if this product differs."}
      >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="circuit" label={isFormula1 ? "Circuit" : "Venue"} required error={fieldErrors.circuit}>
          <input
            value={circuit}
            onChange={(e) => {
              setCircuit(e.target.value)
              clearError("circuit")
            }}
            className={inputClass(Boolean(fieldErrors.circuit))}
            placeholder={isFormula1 ? "Albert Park Circuit" : "All England Lawn Tennis Club"}
          />
        </Field>

        <Field id="eventDate" label="Event date" required={creatingNewEvent} error={fieldErrors.eventDate}>
          <input
            type="date"
            value={eventDate}
            onChange={(e) => {
              setEventDate(e.target.value)
              clearError("eventDate")
            }}
            className={inputClass(Boolean(fieldErrors.eventDate))}
          />
        </Field>

        <Field id="dateRange" label="Date range" required={creatingNewEvent} error={fieldErrors.dateRange} className="sm:col-span-2" hint="Shown in the portal, for example 4-6 Dec.">
          <input
            value={dateRange}
            onChange={(e) => {
              setDateRange(e.target.value)
              clearError("dateRange")
            }}
            className={inputClass(Boolean(fieldErrors.dateRange))}
            placeholder={isFormula1 ? undefined : "29 Jun – 12 Jul"}
          />
        </Field>

        <Field id="location" label="Location" required={creatingNewEvent} error={fieldErrors.location}>
          <input
            value={location}
            onChange={(e) => {
              setLocation(e.target.value)
              clearError("location")
            }}
            className={inputClass(Boolean(fieldErrors.location))}
            placeholder={isFormula1 ? undefined : "London"}
          />
        </Field>

        <Field id="country" label="Country" required={creatingNewEvent} error={fieldErrors.country}>
          <input
            value={country}
            onChange={(e) => {
              setCountry(e.target.value)
              clearError("country")
            }}
            className={inputClass(Boolean(fieldErrors.country))}
            placeholder={isFormula1 ? undefined : "United Kingdom"}
          />
        </Field>

        <Field id="countryCode" label="Country code" required={creatingNewEvent} error={fieldErrors.countryCode} className="sm:col-span-2 sm:max-w-xs">
          <input
            value={countryCode}
            onChange={(e) => {
              setCountryCode(e.target.value)
              clearError("countryCode")
            }}
            className={inputClass(Boolean(fieldErrors.countryCode))}
            placeholder={isFormula1 ? "AE" : "GB"}
          />
        </Field>
      </div>
      </FormSection>

      <FormSection step="4" title="Price and stock" hint="Optional. Add stock only if you already have a purchase. That creates a purchase order.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs text-muted-foreground">
            Trade price (USD)
            <input
              value={tradePrice}
              onChange={(e) => setTradePrice(e.target.value)}
              placeholder="Blank = enquiry"
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Initial stock
            <input
              value={initialQty}
              onChange={(e) => setInitialQty(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Buy price (per unit)
            <input
              inputMode="decimal"
              value={initialUnitCost}
              onChange={(e) => setInitialUnitCost(e.target.value)}
              placeholder="Optional"
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          <Field
            id="source"
            label="Source"
            required={Math.floor(Number(initialQty)) > 0}
            error={fieldErrors.source}
            hint={Math.floor(Number(initialQty)) > 0 ? undefined : "Required only when you add initial stock."}
          >
            <div className="mt-1.5">
              <CompanySupplierSelect
                value={initialSupplierAccountId}
                onChange={(value) => {
                  setInitialSupplierAccountId(value)
                  clearError("source")
                }}
              />
            </div>
          </Field>
          <label className="block text-xs text-muted-foreground">
            Contract / invoice
            <input
              value={initialSupplierReference}
              onChange={(e) => setInitialSupplierReference(e.target.value)}
              placeholder="Supplier invoice or contract no."
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Issued date
            <input
              type="date"
              value={initialIssuedAt}
              onChange={(e) => setInitialIssuedAt(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Payment due date
            <input
              type="date"
              value={initialPaymentDueDate}
              onChange={(e) => setInitialPaymentDueDate(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
            <span className="mt-1 block text-[11px] text-muted-foreground/80">When this supplier invoice is due to be paid.</span>
          </label>
          <label className="block text-xs text-muted-foreground sm:col-span-2 lg:col-span-2">
            Purchase order note
            <input
              value={initialPoNote}
              onChange={(e) => setInitialPoNote(e.target.value)}
              placeholder="Payment terms, contact, anything you need to remember."
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Attachments</p>
          {initialFiles.length > 0 ? (
            <ul className="space-y-1">
              {initialFiles.map((file, index) => (
                <li
                  key={`${file.name}-${file.size}-${index}`}
                  className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1 text-xs"
                >
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => setInitialFiles((files) => files.filter((_, i) => i !== index))}
                    className="text-[10px] font-medium text-destructive hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              Attach the signed contract or supplier invoice if you have it.
            </p>
          )}
          <input
            ref={createFileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              setInitialFiles((files) => [...files, file])
              event.target.value = ""
            }}
            className="text-xs"
          />
        </div>
      </FormSection>

      <FormSection step="5" title="Listing" hint="Optional. Add the photos and copy, then create the brochure or fill in the FAQs from what you have entered.">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={requiresBookingApproval}
            onChange={(e) => setRequiresBookingApproval(e.target.checked)}
          />
          Requires booking approval
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
          Featured
        </label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={isHidden}
            onChange={(e) => setIsHidden(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Hidden on portal
            <span className="block text-[11px] text-muted-foreground/80">
              Keep this product off the agent portal and website. Use this for internal stock such as parking passes.
            </span>
          </span>
        </label>
        <div className="sm:col-span-2 space-y-1">
          <CatalogImageField
            label="Primary image"
            value={image}
            onChange={setImage}
          />
          <p className="text-[11px] text-muted-foreground/80">
            Defaults to the event image. Upload a different photo if this product needs its own.
          </p>
        </div>
        <label className="block text-xs text-muted-foreground sm:col-span-2">
          Extra gallery image URLs (one per line)
          <textarea
            value={galleryText}
            onChange={(e) => setGalleryText(e.target.value)}
            className="mt-1.5 w-full min-h-[72px] px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
            placeholder="https://…"
          />
        </label>
        <div className="sm:col-span-2 space-y-1">
          <CatalogImageField label="Track map" value={trackMap} onChange={setTrackMap} />
          <p className="text-[11px] text-muted-foreground/80">
            Optional circuit layout. Shown on the product page and as brochure page 3.
          </p>
        </div>
        <PackageCopyFields
          description={description}
          includesText={includesText}
          onDescriptionChange={setDescription}
          onIncludesChange={setIncludesText}
          descriptionLabel="Description"
        />
        <div id="product-documents" className="sm:col-span-2 rounded-lg border border-border bg-muted/20 p-3 space-y-2">
          <p className="text-sm font-medium text-foreground">Sales brochure</p>
          <p className="text-xs leading-relaxed text-muted-foreground">Uses the photos, description, and inclusions already on this form.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending || noF1Events}
              onClick={generateBrochure}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {brochureUrlLive ? "Update brochure" : "Create brochure"}
            </button>
            {brochureUrlLive ? (
              <a href={brochureUrlLive} target="_blank" rel="noreferrer" className="text-sm font-medium text-foreground underline">
                Open
              </a>
            ) : null}
          </div>
        </div>
        <details className="sm:col-span-2 rounded-lg border border-border bg-muted/20 p-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">FAQs</summary>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Fill these in now. Empty answers can be filled from the description and inclusions. They are saved with the product.
          </p>
          <div className="mt-3">
            <PackageFaqFields faqs={faqs} onChange={setFaqs} source={faqSource} />
          </div>
        </details>
      </div>
      </FormSection>

      <button
        type="button"
        disabled={pending || noF1Events}
        onClick={() => {
          if (createdPackageId) {
            onOpenChange(false)
            return
          }
          submit()
        }}
        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
      >
        {createdPackageId ? "Done" : pending ? "Creating…" : "Create product"}
      </button>
    </div>
  )
}
