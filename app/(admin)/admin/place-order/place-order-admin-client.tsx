"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import type { AdminPlaceOrderPackageOption } from "@/lib/admin/place-order"
import { maxBookableGuests } from "@/lib/admin/place-order"
import type { CheckoutAddressFields } from "@/lib/types/checkout-addresses"
import type { Package } from "@/lib/types/catalog"
import {
  getAdminOrderPackagePreview,
  submitAdminOrderForAgent,
  type SubmitAdminOrderResult,
} from "./actions"
import { ArrowRight, CheckCircle2, Loader2, Minus, Plus, Search, UserCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

type AgentOption = {
  id: string
  label: string
  email: string
  companyName: string
  savedAddresses: CheckoutAddressFields
}

export function PlaceOrderAdminClient({
  agents,
  packageOptions,
}: {
  agents: AgentOption[]
  packageOptions: AdminPlaceOrderPackageOption[]
}) {
  const [agentId, setAgentId] = useState("")
  const [packageId, setPackageId] = useState("")
  const [agentSearch, setAgentSearch] = useState("")
  const [packageSearch, setPackageSearch] = useState("")
  const [previewPkg, setPreviewPkg] = useState<Package | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [completed, setCompleted] = useState<SubmitAdminOrderResult | null>(null)

  const selectedAgent = agents.find((a) => a.id === agentId)

  const [form, setForm] = useState({
    clientName: "",
    clientEmail: "",
    clientPhone: "",
    clientNationality: "",
    guests: 1,
    specialRequests: "",
    dietaryRequirements: "",
    poNumber: "",
    updateAgentAddressDefaults: true,
    shippingAddressLine1: "",
    shippingAddressLine2: "",
    shippingCity: "",
    shippingPostcode: "",
    shippingCountry: "",
    billingAddressLine1: "",
    billingAddressLine2: "",
    billingCity: "",
    billingPostcode: "",
    billingCountry: "",
  })

  const filteredAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase()
    if (!q) return agents
    return agents.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.companyName.toLowerCase().includes(q),
    )
  }, [agents, agentSearch])

  const filteredPackages = useMemo(() => {
    const q = packageSearch.trim().toLowerCase()
    if (!q) return packageOptions
    return packageOptions.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.circuit.toLowerCase().includes(q) ||
        p.dateRange.toLowerCase().includes(q),
    )
  }, [packageOptions, packageSearch])

  const maxGuests = maxBookableGuests(previewPkg)
  const canBook = maxGuests > 0 && previewPkg?.price != null
  const totalPrice = (previewPkg?.price ?? 0) * form.guests

  useEffect(() => {
    if (!agentId || !packageId) {
      setPreviewPkg(null)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    void getAdminOrderPackagePreview(agentId, packageId).then((pkg) => {
      if (cancelled) return
      setPreviewPkg(pkg)
      setPreviewLoading(false)
      if (pkg) {
        const max = maxBookableGuests(pkg)
        setForm((f) => ({ ...f, guests: Math.min(Math.max(1, f.guests), Math.max(1, max)) }))
      }
    })
    return () => {
      cancelled = true
    }
  }, [agentId, packageId])

  useEffect(() => {
    if (!selectedAgent) return
    setForm((f) => ({
      ...f,
      ...selectedAgent.savedAddresses,
    }))
  }, [agentId, selectedAgent])

  const setupComplete = Boolean(agentId && packageId && canBook)

  const addressesComplete =
    form.shippingAddressLine1.trim() &&
    form.shippingCity.trim() &&
    form.shippingCountry.trim() &&
    form.billingAddressLine1.trim() &&
    form.billingCity.trim() &&
    form.billingCountry.trim()

  const canSubmit =
    setupComplete &&
    form.clientName.trim() &&
    form.clientEmail.trim() &&
    form.clientPhone.trim() &&
    form.guests >= 1 &&
    form.guests <= maxGuests &&
    addressesComplete

  async function handleSubmit() {
    if (!canSubmit || !previewPkg) return
    setIsSubmitting(true)
    const result = await submitAdminOrderForAgent({
      agentProfileId: agentId,
      packageId: previewPkg.id,
      guests: form.guests,
      clientName: form.clientName,
      clientEmail: form.clientEmail,
      clientPhone: form.clientPhone,
      clientNationality: form.clientNationality,
      dietaryRequirements: form.dietaryRequirements,
      specialRequests: form.specialRequests,
      poNumber: form.poNumber,
      updateAgentAddressDefaults: form.updateAgentAddressDefaults,
      shippingAddressLine1: form.shippingAddressLine1,
      shippingAddressLine2: form.shippingAddressLine2,
      shippingCity: form.shippingCity,
      shippingPostcode: form.shippingPostcode,
      shippingCountry: form.shippingCountry,
      billingAddressLine1: form.billingAddressLine1,
      billingAddressLine2: form.billingAddressLine2,
      billingCity: form.billingCity,
      billingPostcode: form.billingPostcode,
      billingCountry: form.billingCountry,
    })
    setIsSubmitting(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setCompleted(result)
    toast.success(`Order ${result.orderReference} placed for ${result.agentCompany}`)
  }

  if (completed?.ok) {
    const fmt = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: previewPkg?.currency || "USD",
    })
    return (
      <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Order placed</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Booked on behalf of <span className="font-medium text-foreground">{completed.agentCompany}</span> (
            {completed.agentEmail}).
          </p>
        </div>

        {completed.confirmationEmailNotice ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-950 text-sm px-4 py-3">
            {completed.confirmationEmailNotice}
          </div>
        ) : completed.confirmationEmailSent ? (
          <p className="text-sm text-muted-foreground text-center">
            Confirmation email sent to the agent.
          </p>
        ) : null}

        <dl className="text-sm space-y-2 border border-border rounded-xl p-4">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Order</dt>
            <dd className="font-mono font-semibold">{completed.orderReference}</dd>
          </div>
          {previewPkg ? (
            <div className="flex justify-between pt-2 border-t border-border">
              <dt className="font-semibold">Total</dt>
              <dd className="font-bold text-primary">{fmt.format(totalPrice)}</dd>
            </div>
          ) : null}
        </dl>

        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/admin/orders"
            className="flex-1 text-center py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
          >
            View orders
          </Link>
          <button
            type="button"
            onClick={() => {
              setCompleted(null)
              setAgentId("")
              setPackageId("")
              setPreviewPkg(null)
            }}
            className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold hover:bg-muted"
          >
            Place another
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-foreground">
        <p className="font-medium">Admin booking</p>
        <p className="text-muted-foreground mt-1 leading-relaxed">
          This creates a real portal booking under the selected agent. Inventory and cost layers are updated
          the same way as a self-serve checkout.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Agent & package */}
          <section className="rounded-2xl border border-border bg-card p-4 sm:p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">1. Agent & package</h2>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Trade partner</label>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                  placeholder="Search company or email…"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm"
                />
              </div>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm"
              >
                <option value="">Select agent…</option>
                {filteredAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} ({a.email})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Package</label>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={packageSearch}
                  onChange={(e) => setPackageSearch(e.target.value)}
                  placeholder="Search package or race…"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm"
                />
              </div>
              <select
                value={packageId}
                onChange={(e) => setPackageId(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm"
              >
                <option value="">Select package…</option>
                {filteredPackages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.circuit} ({p.sellable} avail.)
                  </option>
                ))}
              </select>
            </div>

            {previewLoading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking availability…
              </p>
            ) : agentId && packageId && !canBook ? (
              <p className="text-sm text-red-600">This package cannot be booked (sold out, enquiry-only, or no price).</p>
            ) : previewPkg && previewPkg.agentHoldUnits ? (
              <p className="text-sm text-amber-800 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                Agent has {previewPkg.agentHoldUnits} unit(s) on hold for this package (included in availability).
              </p>
            ) : null}
          </section>

          {setupComplete && (
            <>
              <section className="rounded-2xl border border-border bg-card p-4 sm:p-6 space-y-4">
                <h2 className="text-lg font-semibold text-foreground">2. Client details</h2>
                <p className="text-xs text-muted-foreground">
                  End-client / guest contact. Use TBC if details are not confirmed yet.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(
                    [
                      ["clientName", "Full name", "text", "John Smith"],
                      ["clientEmail", "Email", "email", "john@company.com"],
                      ["clientPhone", "Phone", "tel", "+44 7700 900000"],
                      ["clientNationality", "Nationality", "text", "British"],
                    ] as const
                  ).map(([key, label, type, placeholder]) => (
                    <div key={key}>
                      <label className="block text-sm font-medium text-foreground mb-2">{label}</label>
                      <input
                        type={type}
                        value={form[key]}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                        placeholder={placeholder}
                        className="w-full px-4 py-3 rounded-xl border border-border bg-muted/30 text-sm"
                      />
                    </div>
                  ))}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-foreground mb-2">PO number</label>
                    <input
                      type="text"
                      value={form.poNumber}
                      onChange={(e) => setForm({ ...form, poNumber: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border border-border bg-muted/30 text-sm"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-foreground mb-2">Dietary requirements</label>
                    <textarea
                      value={form.dietaryRequirements}
                      onChange={(e) => setForm({ ...form, dietaryRequirements: e.target.value })}
                      rows={2}
                      className="w-full px-4 py-3 rounded-xl border border-border bg-muted/30 text-sm resize-none"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-foreground mb-2">Special requests</label>
                    <textarea
                      value={form.specialRequests}
                      onChange={(e) => setForm({ ...form, specialRequests: e.target.value })}
                      rows={2}
                      className="w-full px-4 py-3 rounded-xl border border-border bg-muted/30 text-sm resize-none"
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-card p-4 sm:p-6 space-y-4">
                <h2 className="text-lg font-semibold text-foreground">3. Guests & addresses</h2>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Guests</label>
                  <div className="inline-flex items-center gap-3">
                    <button
                      type="button"
                      disabled={form.guests <= 1}
                      onClick={() => setForm({ ...form, guests: Math.max(1, form.guests - 1) })}
                      className="h-10 w-10 rounded-lg border border-border flex items-center justify-center disabled:opacity-40"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="text-lg font-bold w-8 text-center">{form.guests}</span>
                    <button
                      type="button"
                      disabled={form.guests >= maxGuests}
                      onClick={() => setForm({ ...form, guests: Math.min(maxGuests, form.guests + 1) })}
                      className="h-10 w-10 rounded-lg border border-border flex items-center justify-center disabled:opacity-40"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <span className="text-sm text-muted-foreground">Max {maxGuests}</span>
                  </div>
                </div>

                <AddressFields
                  title="Shipping"
                  prefix="shipping"
                  form={form}
                  setForm={setForm}
                />
                <AddressFields
                  title="Billing"
                  prefix="billing"
                  form={form}
                  setForm={setForm}
                />

                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.updateAgentAddressDefaults}
                    onChange={(e) => setForm({ ...form, updateAgentAddressDefaults: e.target.checked })}
                    className="mt-1"
                  />
                  <span className="text-muted-foreground">
                    Save shipping & billing as this agent&apos;s default checkout addresses
                  </span>
                </label>
              </section>

              <button
                type="button"
                disabled={!canSubmit || isSubmitting}
                onClick={() => void handleSubmit()}
                className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Place order for agent
                <ArrowRight className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        {/* Sidebar */}
        <aside className="lg:col-span-1">
          <div className="sticky top-6 rounded-2xl border border-border bg-card overflow-hidden">
            {previewPkg?.image ? (
              <div className="relative aspect-[16/10]">
                <Image src={previewPkg.image} alt={previewPkg.name} fill className="object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                <div className="absolute bottom-0 p-4">
                  <p className="text-[10px] uppercase tracking-wider text-primary font-semibold">{previewPkg.circuit}</p>
                  <p className="text-white font-bold text-lg leading-snug">{previewPkg.name}</p>
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-muted-foreground">
                <UserCircle className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Select an agent and package to continue</p>
              </div>
            )}
            {previewPkg && canBook ? (
              <div className="p-4 space-y-3 border-t border-border text-sm">
                {selectedAgent ? (
                  <div>
                    <p className="text-muted-foreground text-xs">Agent</p>
                    <p className="font-medium">{selectedAgent.label}</p>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span className="font-medium">{previewPkg.dateRange}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Unit price</span>
                  <span className="font-medium">
                    {new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: previewPkg.currency,
                      maximumFractionDigits: 0,
                    }).format(previewPkg.price ?? 0)}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-border">
                  <span className="font-semibold">Total ({form.guests} guests)</span>
                  <span className="font-bold text-primary">
                    {new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: previewPkg.currency,
                      maximumFractionDigits: 0,
                    }).format(totalPrice)}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  )
}

type OrderFormState = {
  clientName: string
  clientEmail: string
  clientPhone: string
  clientNationality: string
  guests: number
  specialRequests: string
  dietaryRequirements: string
  poNumber: string
  updateAgentAddressDefaults: boolean
  shippingAddressLine1: string
  shippingAddressLine2: string
  shippingCity: string
  shippingPostcode: string
  shippingCountry: string
  billingAddressLine1: string
  billingAddressLine2: string
  billingCity: string
  billingPostcode: string
  billingCountry: string
}

function AddressFields({
  title,
  prefix,
  form,
  setForm,
}: {
  title: string
  prefix: "shipping" | "billing"
  form: OrderFormState
  setForm: React.Dispatch<React.SetStateAction<OrderFormState>>
}) {
  const line1 = prefix === "shipping" ? "shippingAddressLine1" : "billingAddressLine1"
  const line2 = prefix === "shipping" ? "shippingAddressLine2" : "billingAddressLine2"
  const city = prefix === "shipping" ? "shippingCity" : "billingCity"
  const postcode = prefix === "shipping" ? "shippingPostcode" : "billingPostcode"
  const country = prefix === "shipping" ? "shippingCountry" : "billingCountry"

  return (
    <div className="space-y-3 pt-2 border-t border-border">
      <h3 className="text-sm font-semibold text-foreground">{title} address</h3>
      <input
        type="text"
        placeholder="Address line 1"
        value={form[line1]}
        onChange={(e) => setForm({ ...form, [line1]: e.target.value })}
        className="w-full px-4 py-2.5 rounded-xl border border-border bg-muted/30 text-sm"
      />
      <input
        type="text"
        placeholder="Address line 2"
        value={form[line2]}
        onChange={(e) => setForm({ ...form, [line2]: e.target.value })}
        className="w-full px-4 py-2.5 rounded-xl border border-border bg-muted/30 text-sm"
      />
      <div className="grid grid-cols-2 gap-3">
        <input
          type="text"
          placeholder="City"
          value={form[city]}
          onChange={(e) => setForm({ ...form, [city]: e.target.value })}
          className="w-full px-4 py-2.5 rounded-xl border border-border bg-muted/30 text-sm"
        />
        <input
          type="text"
          placeholder="Postcode"
          value={form[postcode]}
          onChange={(e) => setForm({ ...form, [postcode]: e.target.value })}
          className="w-full px-4 py-2.5 rounded-xl border border-border bg-muted/30 text-sm"
        />
      </div>
      <input
        type="text"
        placeholder="Country"
        value={form[country]}
        onChange={(e) => setForm({ ...form, [country]: e.target.value })}
        className="w-full px-4 py-2.5 rounded-xl border border-border bg-muted/30 text-sm"
      />
    </div>
  )
}
