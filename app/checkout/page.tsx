"use client"

import { useState, Suspense } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import { PortalLayout } from "@/components/portal-layout"
import { packages, currentAgent } from "@/lib/data"
import {
  ArrowLeft,
  Check,
  MapPin,
  Calendar,
  Users,
  Shield,
  Lock,
  CreditCard,
  Building,
  CheckCircle2,
  Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"

function CheckoutContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const packageId = searchParams.get("package")
  const guestsParam = searchParams.get("guests")

  const pkg = packages.find((p) => p.id === packageId)
  const initialGuests = guestsParam ? Number.parseInt(guestsParam) : 2

  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isComplete, setIsComplete] = useState(false)

  const [formData, setFormData] = useState({
    // Client Details
    clientName: "",
    clientEmail: "",
    clientPhone: "",
    clientCompany: "",
    // Guest Info
    guests: initialGuests,
    specialRequests: "",
    dietaryRequirements: "",
    // Payment
    paymentMethod: "invoice" as "invoice" | "card",
    poNumber: "",
    // Terms
    acceptTerms: false,
  })

  if (!pkg) {
    return (
      <PortalLayout>
        <div className="p-8 text-center">
          <h1 className="text-2xl font-bold">Package not found</h1>
          <Link href="/packages" className="text-primary mt-4 inline-block">
            Back to packages
          </Link>
        </div>
      </PortalLayout>
    )
  }

  const totalPrice = pkg.price * formData.guests
  const commission = totalPrice * (currentAgent.commission / 100)
  const netAmount = totalPrice - commission

  const handleSubmit = async () => {
    setIsSubmitting(true)
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 2000))
    setIsSubmitting(false)
    setIsComplete(true)
  }

  const canProceedStep1 = formData.clientName && formData.clientEmail && formData.clientPhone

  const canProceedStep2 = formData.guests > 0

  const canSubmit = formData.acceptTerms && (formData.paymentMethod === "invoice" || formData.paymentMethod === "card")

  if (isComplete) {
    return (
      <PortalLayout>
        <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-4 sm:p-6 lg:p-8">
          <div className="max-w-lg w-full text-center">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6">
              <CheckCircle2 className="h-8 w-8 sm:h-10 sm:w-10 text-emerald-600" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2 sm:mb-3">Booking Confirmed!</h1>
            <p className="text-sm sm:text-base text-muted-foreground mb-6 sm:mb-8">
              Your booking for {pkg.circuit} has been successfully submitted. A confirmation email has been sent to{" "}
              {formData.clientEmail}.
            </p>

            <div className="bg-card border border-border rounded-2xl p-4 sm:p-6 text-left mb-6 sm:mb-8">
              <h3 className="text-sm sm:text-base font-semibold text-foreground mb-3 sm:mb-4">Booking Summary</h3>
              <dl className="space-y-2 sm:space-y-3 text-xs sm:text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Booking Reference</dt>
                  <dd className="font-mono font-semibold">
                    BK-2026-{Math.random().toString(36).slice(2, 8).toUpperCase()}
                  </dd>
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
                  <dd className="font-medium">{formData.guests}</dd>
                </div>
                <div className="flex justify-between pt-3 border-t border-border">
                  <dt className="font-semibold text-foreground">Total</dt>
                  <dd className="font-bold text-primary">${totalPrice.toLocaleString()}</dd>
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
                className="w-full sm:flex-1 py-2.5 sm:py-3 border border-border rounded-xl text-sm sm:text-base font-semibold hover:bg-muted transition-colors text-center"
              >
                Book Another
              </Link>
            </div>
          </div>
        </div>
      </PortalLayout>
    )
  }

  return (
    <PortalLayout>
      <div className="min-h-screen">
        {/* Header */}
        <div className="bg-card border-b border-border">
          <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            <Link
              href={`/packages/${pkg.id}`}
              className="inline-flex items-center gap-2 text-xs sm:text-sm text-muted-foreground hover:text-foreground mb-3 sm:mb-4"
            >
              <ArrowLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              Back to Package
            </Link>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">Complete Your Booking</h1>
          </div>

          {/* Progress Steps */}
          <div className="px-4 sm:px-6 lg:px-8 pb-4 sm:pb-6 overflow-x-auto">
            <div className="flex items-center gap-2 sm:gap-4 min-w-max">
              {[
                { num: 1, label: "Client Details" },
                { num: 2, label: "Guest Information" },
                { num: 3, label: "Payment & Confirm" },
              ].map((s, i) => (
                <div key={s.num} className="flex items-center">
                  <button
                    onClick={() => s.num < step && setStep(s.num)}
                    className={cn(
                      "flex items-center gap-2 sm:gap-3 transition-colors",
                      s.num <= step ? "cursor-pointer" : "cursor-default",
                    )}
                  >
                    <div
                      className={cn(
                        "w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold transition-colors",
                        step > s.num
                          ? "bg-emerald-500 text-white"
                          : step === s.num
                            ? "bg-primary text-white"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {step > s.num ? <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : s.num}
                    </div>
                    <span
                      className={cn("text-xs sm:text-sm font-medium hidden sm:inline", step >= s.num ? "text-foreground" : "text-muted-foreground")}
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

        {/* Content */}
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            {/* Form */}
            <div className="lg:col-span-2">
              {/* Step 1: Client Details */}
              {step === 1 && (
                <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 space-y-4 sm:space-y-6">
                  <div>
                    <h2 className="text-lg sm:text-xl font-bold text-foreground mb-1">Client Details</h2>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      Enter the primary contact information for this booking
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        Full Name <span className="text-primary">*</span>
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
                        Email Address <span className="text-primary">*</span>
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
                        Phone Number <span className="text-primary">*</span>
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
                      <label className="block text-sm font-medium text-foreground mb-2">Company Name</label>
                      <input
                        type="text"
                        value={formData.clientCompany}
                        onChange={(e) => setFormData({ ...formData, clientCompany: e.target.value })}
                        className="w-full px-4 py-3 bg-muted/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                        placeholder="Acme Corp"
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => setStep(2)}
                    disabled={!canProceedStep1}
                    className="w-full py-2.5 sm:py-3 bg-primary text-white rounded-xl text-sm sm:text-base font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Continue to Guest Information
                  </button>
                </div>
              )}

              {/* Step 2: Guest Information */}
              {step === 2 && (
                <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 space-y-4 sm:space-y-6">
                  <div>
                    <h2 className="text-lg sm:text-xl font-bold text-foreground mb-1">Guest Information</h2>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      Provide details about the guests attending this experience
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-foreground mb-2">
                      Number of Guests <span className="text-primary">*</span>
                    </label>
                    <div className="flex items-center gap-3 sm:gap-4">
                      <button
                        onClick={() => setFormData({ ...formData, guests: Math.max(1, formData.guests - 1) })}
                        className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl border border-border flex items-center justify-center hover:bg-muted transition-colors text-base sm:text-lg font-semibold"
                      >
                        -
                      </button>
                      <div className="w-16 sm:w-20 text-center">
                        <span className="text-2xl sm:text-3xl font-bold text-foreground">{formData.guests}</span>
                      </div>
                      <button
                        onClick={() =>
                          setFormData({ ...formData, guests: Math.min(pkg.availability, formData.guests + 1) })
                        }
                        className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl border border-border flex items-center justify-center hover:bg-muted transition-colors text-base sm:text-lg font-semibold"
                      >
                        +
                      </button>
                      <span className="text-xs sm:text-sm text-muted-foreground">Max {pkg.availability} available</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Dietary Requirements</label>
                    <textarea
                      value={formData.dietaryRequirements}
                      onChange={(e) => setFormData({ ...formData, dietaryRequirements: e.target.value })}
                      className="w-full px-4 py-3 bg-muted/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none"
                      rows={3}
                      placeholder="Please list any dietary requirements (vegetarian, vegan, allergies, etc.)"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Special Requests</label>
                    <textarea
                      value={formData.specialRequests}
                      onChange={(e) => setFormData({ ...formData, specialRequests: e.target.value })}
                      className="w-full px-4 py-3 bg-muted/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none"
                      rows={3}
                      placeholder="Any special requests or accessibility requirements"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                    <button
                      onClick={() => setStep(1)}
                      className="w-full sm:flex-1 py-2.5 sm:py-3 border border-border rounded-xl text-sm sm:text-base font-semibold hover:bg-muted transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={() => setStep(3)}
                      disabled={!canProceedStep2}
                      className="w-full sm:flex-1 py-2.5 sm:py-3 bg-primary text-white rounded-xl text-sm sm:text-base font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Continue to Payment
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Payment & Confirm */}
              {step === 3 && (
                <div className="space-y-4 sm:space-y-6">
                  <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 space-y-4 sm:space-y-6">
                    <div>
                      <h2 className="text-lg sm:text-xl font-bold text-foreground mb-1">Payment Method</h2>
                      <p className="text-xs sm:text-sm text-muted-foreground">Select how you'd like to process this booking</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                      <button
                        onClick={() => setFormData({ ...formData, paymentMethod: "invoice" })}
                        className={cn(
                          "flex flex-col items-start gap-2 sm:gap-3 p-4 sm:p-5 rounded-xl border-2 transition-all text-left",
                          formData.paymentMethod === "invoice"
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-muted-foreground/30",
                        )}
                      >
                        <div
                          className={cn(
                            "p-2 sm:p-3 rounded-lg",
                            formData.paymentMethod === "invoice" ? "bg-primary/10" : "bg-muted",
                          )}
                        >
                          <Building
                            className={cn(
                              "h-5 w-5 sm:h-6 sm:w-6",
                              formData.paymentMethod === "invoice" ? "text-primary" : "text-muted-foreground",
                            )}
                          />
                        </div>
                        <div>
                          <p className="text-sm sm:text-base font-semibold text-foreground">Invoice Payment</p>
                          <p className="text-xs sm:text-sm text-muted-foreground">
                            We'll send an invoice to your client. Net 30 terms.
                          </p>
                        </div>
                        {formData.paymentMethod === "invoice" && (
                          <div className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-primary flex items-center justify-center ml-auto">
                            <Check className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-white" />
                          </div>
                        )}
                      </button>

                      <button
                        onClick={() => setFormData({ ...formData, paymentMethod: "card" })}
                        className={cn(
                          "flex flex-col items-start gap-2 sm:gap-3 p-4 sm:p-5 rounded-xl border-2 transition-all text-left",
                          formData.paymentMethod === "card"
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-muted-foreground/30",
                        )}
                      >
                        <div
                          className={cn(
                            "p-2 sm:p-3 rounded-lg",
                            formData.paymentMethod === "card" ? "bg-primary/10" : "bg-muted",
                          )}
                        >
                          <CreditCard
                            className={cn(
                              "h-5 w-5 sm:h-6 sm:w-6",
                              formData.paymentMethod === "card" ? "text-primary" : "text-muted-foreground",
                            )}
                          />
                        </div>
                        <div>
                          <p className="text-sm sm:text-base font-semibold text-foreground">Card Payment</p>
                          <p className="text-xs sm:text-sm text-muted-foreground">Process payment immediately via card.</p>
                        </div>
                        {formData.paymentMethod === "card" && (
                          <div className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-primary flex items-center justify-center ml-auto">
                            <Check className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-white" />
                          </div>
                        )}
                      </button>
                    </div>

                    {formData.paymentMethod === "invoice" && (
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-foreground mb-2">PO Number (Optional)</label>
                        <input
                          type="text"
                          value={formData.poNumber}
                          onChange={(e) => setFormData({ ...formData, poNumber: e.target.value })}
                          className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-muted/50 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                          placeholder="Enter PO number if applicable"
                        />
                      </div>
                    )}
                  </div>

                  {/* Terms */}
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
                        <p className="text-sm sm:text-base font-medium text-foreground">I accept the Terms & Conditions</p>
                        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                          By checking this box, you agree to our{" "}
                          <a href="#" className="text-primary hover:underline">
                            Terms of Service
                          </a>{" "}
                          and{" "}
                          <a href="#" className="text-primary hover:underline">
                            Cancellation Policy
                          </a>
                          . You confirm that you have the authority to make this booking on behalf of the client.
                        </p>
                      </div>
                    </label>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                    <button
                      onClick={() => setStep(2)}
                      className="w-full sm:flex-1 py-2.5 sm:py-3 border border-border rounded-xl text-sm sm:text-base font-semibold hover:bg-muted transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={!canSubmit || isSubmitting}
                      className="w-full sm:flex-1 py-2.5 sm:py-3 bg-primary text-white rounded-xl text-sm sm:text-base font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Lock className="h-4 w-4 sm:h-5 sm:w-5" />
                          Confirm Booking
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Order Summary */}
            <div className="lg:col-span-1">
              <div className="lg:sticky lg:top-24 bg-card rounded-2xl border border-border overflow-hidden">
                {/* Package Preview */}
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
                        ${pkg.price.toLocaleString()} × {formData.guests}
                      </span>
                      <span className="font-medium">${totalPrice.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs sm:text-sm">
                      <span className="text-muted-foreground">Your Commission ({currentAgent.commission}%)</span>
                      <span className="font-medium text-emerald-600">-${commission.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between pt-2 sm:pt-3 border-t border-border">
                      <span className="text-sm sm:text-base font-semibold">Total to Pay</span>
                      <span className="text-lg sm:text-xl font-bold text-primary">${totalPrice.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Trust Signals */}
                  <div className="pt-3 sm:pt-4 border-t border-border space-y-2 sm:space-y-3">
                    <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                      <Shield className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-500" />
                      <span>Secure checkout</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                      <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-500" />
                      <span>Free cancellation up to 30 days</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                      <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-500" />
                      <span>Official F1 Experiences partner</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PortalLayout>
  )
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <PortalLayout>
          <div className="p-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto" />
          </div>
        </PortalLayout>
      }
    >
      <CheckoutContent />
    </Suspense>
  )
}
