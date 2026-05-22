"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  clampToAllowedGuestCount,
  isGuestCountAllowed,
  lowStockGuestHint,
  maxBookableGuestsFromSellable,
  numericSellable,
  stepAllowedGuestCount,
} from "@/lib/catalog/booking-guests"
import type { Package } from "@/lib/types/catalog"
import type { CheckoutAddressFields } from "@/lib/types/checkout-addresses"
import { submitCheckoutOrder } from "./actions"
import {
  ArrowLeft,
  Check,
  MapPin,
  Calendar,
  Users,
  CheckCircle2,
  Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"

export function CheckoutClient({
  pkg,
  initialGuests,
  savedAddresses,
}: {
  pkg: Package
  initialGuests: number
  savedAddresses: CheckoutAddressFields
}) {
  const sellable = numericSellable(pkg.availability) ?? 0
  const maxGuests = maxBookableGuestsFromSellable(sellable, pkg.totalCapacity)
  const canBookOnline = maxGuests > 0 && pkg.price !== null
  const stockHint = lowStockGuestHint(sellable)

  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [completedSummary, setCompletedSummary] = useState<{
    orderReference: string
    totalAmount: number
    currency: string
    guests: number
    confirmationEmailSent: boolean
    confirmationEmailNotice?: string
  } | null>(null)

  const [formData, setFormData] = useState(() => ({
    clientName: "",
    clientEmail: "",
    clientPhone: "",
    clientNationality: "",
    guests: clampToAllowedGuestCount(
      sellable,
      Math.min(Math.max(1, initialGuests), Math.max(1, maxGuests)),
    ),
    specialRequests: "",
    dietaryRequirements: "",
    poNumber: "",
    acceptTerms: false,
    ...savedAddresses,
  }))

  const backToRaceHref = pkg.raceId ? `/packages/race/${pkg.raceId}` : "/packages"

  if (!canBookOnline) {
    return (
      <div className="p-8 text-center max-w-md mx-auto">
        <h1 className="text-2xl font-bold text-foreground">Not available to book online</h1>
        <p className="text-sm text-muted-foreground mt-3">
          This package is enquiry-only, sold out, or pricing is on request. Please contact ZK Sports & Entertainment to proceed.
        </p>
        <Link href={backToRaceHref} className="text-primary font-medium mt-6 inline-block hover:underline">
          Back to packages
        </Link>
      </div>
    )
  }

  const totalPrice = (pkg.price ?? 0) * formData.guests

  const handleSubmit = async () => {
    setSubmitError(null)
    setIsSubmitting(true)
    const result = await submitCheckoutOrder({
      packageId: pkg.id,
      guests: formData.guests,
      clientName: formData.clientName.trim(),
      clientEmail: formData.clientEmail.trim(),
      clientPhone: formData.clientPhone.trim(),
      clientNationality: formData.clientNationality.trim(),
      dietaryRequirements: formData.dietaryRequirements.trim(),
      specialRequests: formData.specialRequests.trim(),
      poNumber: formData.poNumber.trim(),
      shippingAddressLine1: formData.shippingAddressLine1.trim(),
      shippingAddressLine2: formData.shippingAddressLine2.trim(),
      shippingCity: formData.shippingCity.trim(),
      shippingPostcode: formData.shippingPostcode.trim(),
      shippingCountry: formData.shippingCountry.trim(),
      billingAddressLine1: formData.billingAddressLine1.trim(),
      billingAddressLine2: formData.billingAddressLine2.trim(),
      billingCity: formData.billingCity.trim(),
      billingPostcode: formData.billingPostcode.trim(),
      billingCountry: formData.billingCountry.trim(),
    })
    setIsSubmitting(false)
    if (!result.ok) {
      setSubmitError(result.error)
      return
    }
    setCompletedSummary({
      orderReference: result.orderReference,
      totalAmount: result.totalAmount,
      currency: result.currency,
      guests: result.guests,
      confirmationEmailSent: result.confirmationEmailSent,
      confirmationEmailNotice: result.confirmationEmailNotice,
    })
    setIsComplete(true)
  }

  const canProceedStep1 = formData.clientName && formData.clientEmail && formData.clientPhone

  const canProceedStep2 =
    formData.guests > 0 && formData.guests <= maxGuests && isGuestCountAllowed(sellable, formData.guests)

  const checkoutAddressesComplete =
    formData.shippingAddressLine1.trim() &&
    formData.shippingCity.trim() &&
    formData.shippingCountry.trim() &&
    formData.billingAddressLine1.trim() &&
    formData.billingCity.trim() &&
    formData.billingCountry.trim()

  const canSubmit = formData.acceptTerms && checkoutAddressesComplete

  if (isComplete && completedSummary) {
    const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: completedSummary.currency })
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="max-w-lg w-full text-center">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6">
            <CheckCircle2 className="h-8 w-8 sm:h-10 sm:w-10 text-emerald-600" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2 sm:mb-3">Booking confirmed</h1>
          {completedSummary.confirmationEmailNotice ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-950 text-left text-sm px-4 py-3 mb-6 sm:mb-8 space-y-2">
              <p className="font-medium">Booking saved — email not sent</p>
              <p className="text-amber-900/90 leading-relaxed">{completedSummary.confirmationEmailNotice}</p>
            </div>
          ) : (
            <p className="text-sm sm:text-base text-muted-foreground mb-6 sm:mb-8">
              You should receive a booking confirmation email shortly. Payment details will follow from our team separately.
            </p>
          )}

          <div className="bg-card border border-border rounded-2xl p-4 sm:p-6 text-left mb-6 sm:mb-8">
            <h3 className="text-sm sm:text-base font-semibold text-foreground mb-3 sm:mb-4">Summary</h3>
            <dl className="space-y-2 sm:space-y-3 text-xs sm:text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground shrink-0">Booking reference</dt>
                <dd className="font-mono font-semibold text-right">{completedSummary.orderReference}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Package</dt>
                <dd className="font-medium">{pkg.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Event</dt>
                <dd className="font-medium">{pkg.circuit}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Date</dt>
                <dd className="font-medium">{pkg.dateRange}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Guests</dt>
                <dd className="font-medium">{completedSummary.guests}</dd>
              </div>
              <div className="flex justify-between pt-3 border-t border-border">
                <dt className="font-semibold text-foreground">Total</dt>
                <dd className="font-bold text-primary">{fmt.format(completedSummary.totalAmount)}</dd>
              </div>
            </dl>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
            <Link
              href="/bookings"
              className="w-full sm:flex-1 py-2.5 sm:py-3 bg-foreground text-background rounded-xl text-sm sm:text-base font-semibold hover:bg-foreground/90 transition-colors text-center"
            >
              View Bookings
            </Link>
            <Link
              href="/packages"
              className="w-full sm:flex-1 py-2.5 sm:py-3 bg-white dark:bg-card text-foreground border border-border rounded-xl text-sm sm:text-base font-semibold shadow-sm hover:bg-zinc-50 dark:hover:bg-muted transition-colors text-center"
            >
              Book Another
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="bg-card border-b border-border">
        <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <Link
            href={backToRaceHref}
            className="inline-flex items-center gap-2 text-xs sm:text-sm text-muted-foreground hover:text-foreground mb-3 sm:mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            Back to race packages
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Complete your booking</h1>
          {pkg.agentHoldUnits != null && pkg.agentHoldUnits > 0 && pkg.agentHoldExpiresAt ? (
            <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs sm:text-sm text-amber-950 dark:text-amber-100 max-w-2xl">
              <p className="font-semibold">Your active hold</p>
              <p className="mt-1 leading-relaxed">
                {pkg.agentHoldUnits} seat{pkg.agentHoldUnits !== 1 ? "s are" : " is"} reserved for you until{" "}
                <span className="font-medium whitespace-nowrap">{new Date(pkg.agentHoldExpiresAt).toLocaleString()}</span>
                . You can complete checkout for up to the guest limit shown; the booking uses your hold first.
              </p>
            </div>
          ) : null}
        </div>

        <div className="px-4 sm:px-6 lg:px-8 pb-4 sm:pb-6 overflow-x-auto">
          <div className="flex items-center gap-2 sm:gap-4 min-w-max">
            {[
              { num: 1, label: "Client details" },
              { num: 2, label: "Guests" },
              { num: 3, label: "Checkout" },
            ].map((s, i) => (
              <div key={s.num} className="flex items-center">
                <button
                  type="button"
                  onClick={() => s.num < step && setStep(s.num)}
                  className={cn("flex items-center gap-2 sm:gap-3 transition-colors", s.num <= step ? "cursor-pointer" : "cursor-default")}
                >
                  <div
                    className={cn(
                      "w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold transition-colors",
                      step > s.num ? "bg-emerald-500 text-white" : step === s.num ? "bg-primary text-white" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {step > s.num ? <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : s.num}
                  </div>
                  <span
                    className={cn(
                      "text-xs sm:text-sm font-medium hidden sm:inline",
                      step >= s.num ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {s.label}
                  </span>
                </button>
                {i < 2 && <div className={cn("w-6 sm:w-12 h-0.5 mx-2 sm:mx-4", step > s.num ? "bg-emerald-500" : "bg-muted")} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
          <div className="lg:col-span-2">
            {step === 1 && (
              <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 space-y-4 sm:space-y-6">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-foreground mb-1">Client details</h2>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    Primary guest / client contact for this booking. If you do not have final details yet, enter <span className="font-medium text-foreground">TBC</span> in any field and update your booking later with our team.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Full name <span className="text-primary">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.clientName}
                      onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                      className="w-full px-4 py-3 bg-muted/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      placeholder="John Smith"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Email <span className="text-primary">*</span>
                    </label>
                    <input
                      type="email"
                      value={formData.clientEmail}
                      onChange={(e) => setFormData({ ...formData, clientEmail: e.target.value })}
                      className="w-full px-4 py-3 bg-muted/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      placeholder="john@company.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Phone <span className="text-primary">*</span>
                    </label>
                    <input
                      type="tel"
                      value={formData.clientPhone}
                      onChange={(e) => setFormData({ ...formData, clientPhone: e.target.value })}
                      className="w-full px-4 py-3 bg-muted/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      placeholder="+44 7700 900000"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Nationality (optional)</label>
                    <input
                      type="text"
                      value={formData.clientNationality}
                      onChange={(e) => setFormData({ ...formData, clientNationality: e.target.value })}
                      className="w-full px-4 py-3 bg-muted/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      placeholder="e.g. British"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={!canProceedStep1}
                  className="w-full py-2.5 sm:py-3 bg-primary text-white rounded-xl text-sm sm:text-base font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 space-y-4 sm:space-y-6">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-foreground mb-1">Guest information</h2>
                  <p className="text-xs sm:text-sm text-muted-foreground">Numbers and requests for the experience</p>
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-medium text-foreground mb-2">
                    Number of guests <span className="text-primary">*</span>
                  </label>
                  <div className="flex items-center gap-3 sm:gap-4">
                    <button
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          guests: stepAllowedGuestCount(sellable, formData.guests, "down"),
                        })
                      }
                      disabled={formData.guests <= stepAllowedGuestCount(sellable, formData.guests, "down")}
                      className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl border border-border flex items-center justify-center hover:bg-muted transition-colors text-base sm:text-lg font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      -
                    </button>
                    <div className="w-16 sm:w-20 text-center">
                      <span className="text-2xl sm:text-3xl font-bold text-foreground">{formData.guests}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          guests: stepAllowedGuestCount(sellable, formData.guests, "up"),
                        })
                      }
                      disabled={formData.guests >= stepAllowedGuestCount(sellable, formData.guests, "up")}
                      className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl border border-border flex items-center justify-center hover:bg-muted transition-colors text-base sm:text-lg font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      +
                    </button>
                    <span className="text-xs sm:text-sm text-muted-foreground">Max {maxGuests} available</span>
                  </div>
                  {stockHint ? (
                    <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{stockHint}</p>
                  ) : null}
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Dietary requirements</label>
                  <textarea
                    value={formData.dietaryRequirements}
                    onChange={(e) => setFormData({ ...formData, dietaryRequirements: e.target.value })}
                    className="w-full px-4 py-3 bg-muted/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none"
                    rows={3}
                    placeholder="Vegetarian, allergies, etc."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Special requests</label>
                  <textarea
                    value={formData.specialRequests}
                    onChange={(e) => setFormData({ ...formData, specialRequests: e.target.value })}
                    className="w-full px-4 py-3 bg-muted/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none"
                    rows={3}
                    placeholder="Accessibility or other notes"
                  />
                </div>

                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="w-full sm:flex-1 py-2.5 sm:py-3 border border-border rounded-xl text-sm sm:text-base font-semibold hover:bg-muted transition-colors"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    disabled={!canProceedStep2}
                    className="w-full sm:flex-1 py-2.5 sm:py-3 bg-primary text-white rounded-xl text-sm sm:text-base font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Continue to checkout
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4 sm:space-y-6">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-foreground">Checkout</h2>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-1">Payment, addresses, and confirmation</p>
                </div>

                <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Payment</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    Payment is arranged offline after confirmation. Our team will contact you with terms; unless otherwise agreed, payment is typically due within{" "}
                    <span className="font-medium text-foreground">7 days</span>. Failure to pay on time may result in your booking being cancelled.
                  </p>
                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-foreground mb-2">PO number (optional)</label>
                    <input
                      type="text"
                      value={formData.poNumber}
                      onChange={(e) => setFormData({ ...formData, poNumber: e.target.value })}
                      className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-muted/50 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      placeholder="If you use a PO reference"
                    />
                  </div>
                </div>

                <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 space-y-4">
                  <h3 className="text-sm font-semibold text-foreground">Shipping address</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-foreground mb-1.5">
                        Address line 1 <span className="text-primary">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.shippingAddressLine1}
                        onChange={(e) => setFormData({ ...formData, shippingAddressLine1: e.target.value })}
                        className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-muted/50 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-foreground mb-1.5">Address line 2</label>
                      <input
                        type="text"
                        value={formData.shippingAddressLine2}
                        onChange={(e) => setFormData({ ...formData, shippingAddressLine2: e.target.value })}
                        className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-muted/50 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">
                        City <span className="text-primary">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.shippingCity}
                        onChange={(e) => setFormData({ ...formData, shippingCity: e.target.value })}
                        className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-muted/50 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">Postcode / ZIP</label>
                      <input
                        type="text"
                        value={formData.shippingPostcode}
                        onChange={(e) => setFormData({ ...formData, shippingPostcode: e.target.value })}
                        className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-muted/50 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-foreground mb-1.5">
                        Country <span className="text-primary">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.shippingCountry}
                        onChange={(e) => setFormData({ ...formData, shippingCountry: e.target.value })}
                        className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-muted/50 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 space-y-4">
                  <h3 className="text-sm font-semibold text-foreground">Billing address</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-foreground mb-1.5">
                        Address line 1 <span className="text-primary">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.billingAddressLine1}
                        onChange={(e) => setFormData({ ...formData, billingAddressLine1: e.target.value })}
                        className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-muted/50 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-foreground mb-1.5">Address line 2</label>
                      <input
                        type="text"
                        value={formData.billingAddressLine2}
                        onChange={(e) => setFormData({ ...formData, billingAddressLine2: e.target.value })}
                        className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-muted/50 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">
                        City <span className="text-primary">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.billingCity}
                        onChange={(e) => setFormData({ ...formData, billingCity: e.target.value })}
                        className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-muted/50 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">Postcode / ZIP</label>
                      <input
                        type="text"
                        value={formData.billingPostcode}
                        onChange={(e) => setFormData({ ...formData, billingPostcode: e.target.value })}
                        className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-muted/50 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-foreground mb-1.5">
                        Country <span className="text-primary">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.billingCountry}
                        onChange={(e) => setFormData({ ...formData, billingCountry: e.target.value })}
                        className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-muted/50 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    These addresses are saved to your profile after you complete checkout so your next booking is faster. You can edit them anytime in Profile.
                  </p>
                </div>

                {submitError && (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {submitError}
                  </div>
                )}

                <div className="bg-card rounded-2xl border border-border p-4 sm:p-6">
                  <label className="flex items-start gap-3 sm:gap-4 cursor-pointer">
                    <div className="mt-0.5">
                      <input
                        type="checkbox"
                        checked={formData.acceptTerms}
                        onChange={(e) => setFormData({ ...formData, acceptTerms: e.target.checked })}
                        className="sr-only"
                      />
                      <div
                        className={cn(
                          "w-4 h-4 sm:w-5 sm:h-5 rounded border-2 flex items-center justify-center transition-colors",
                          formData.acceptTerms ? "bg-primary border-primary" : "border-muted-foreground/30",
                        )}
                      >
                        {formData.acceptTerms && <Check className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-white" />}
                      </div>
                    </div>
                    <div>
                      <p className="text-sm sm:text-base font-medium text-foreground">
                        I accept the{" "}
                        <Link href="/terms" className="text-primary underline underline-offset-2 hover:no-underline">
                          terms and conditions
                        </Link>
                      </p>
                      <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                        You confirm you have authority to place this booking and agree to our cancellation policy.
                      </p>
                    </div>
                  </label>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                  <button type="button" onClick={() => setStep(2)} className="w-full sm:flex-1 py-2.5 sm:py-3 border border-border rounded-xl text-sm sm:text-base font-semibold hover:bg-muted transition-colors">
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={!canSubmit || isSubmitting}
                    className="w-full sm:flex-1 py-2.5 sm:py-3 bg-primary text-white rounded-xl text-sm sm:text-base font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
                        Processing…
                      </>
                    ) : (
                      "Complete booking"
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-24 bg-card rounded-2xl border border-border overflow-hidden">
              <div className="relative aspect-video">
                <Image src={pkg.image || "/placeholder.svg"} alt={pkg.circuit} fill className="object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                <div className="absolute bottom-3 sm:bottom-4 left-3 sm:left-4 right-3 sm:right-4">
                  <p className="text-white text-sm sm:text-base font-bold">{pkg.circuit}</p>
                  <p className="text-white/80 text-xs sm:text-sm">{pkg.name}</p>
                </div>
              </div>

              <div className="p-4 sm:p-6 space-y-3 sm:space-y-4">
                <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span>
                    {pkg.location}, {pkg.country}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span>{pkg.dateRange}</span>
                </div>
                <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                  <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span>{formData.guests} guests</span>
                </div>

                <div className="pt-3 sm:pt-4 border-t border-border space-y-2 sm:space-y-3">
                  <div className="flex justify-between text-xs sm:text-sm">
                    <span className="text-muted-foreground">
                      ${(pkg.price ?? 0).toLocaleString()} × {formData.guests}
                    </span>
                    <span className="font-medium">${totalPrice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between pt-2 sm:pt-3 border-t border-border">
                    <span className="text-sm sm:text-base font-semibold">Total</span>
                    <span className="text-lg sm:text-xl font-bold text-primary">${totalPrice.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
