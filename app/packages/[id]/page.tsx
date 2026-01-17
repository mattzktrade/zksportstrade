"use client"

import { useState } from "react"
import { use } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { PortalLayout } from "@/components/portal-layout"
import { packages } from "@/lib/data"
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Users,
  Clock,
  Check,
  Minus,
  Plus,
  Star,
  Shield,
  CreditCard,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"

const tierColors = {
  paddock: "bg-primary",
  champions: "bg-amber-500",
  legend: "bg-violet-600",
  hero: "bg-emerald-600",
}

export default function PackageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [guestCount, setGuestCount] = useState(2)
  const [selectedDays, setSelectedDays] = useState<string[]>(["friday", "saturday", "sunday"])

  const pkg = packages.find((p) => p.id === id)

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

  const totalPrice = pkg.price * guestCount
  const availabilityPercent = (pkg.availability / pkg.totalCapacity) * 100

  const handleBooking = () => {
    router.push(`/checkout?package=${pkg.id}&guests=${guestCount}`)
  }

  return (
    <PortalLayout>
      <div className="min-h-screen">
        {/* Hero Section */}
        <div className="relative h-80 lg:h-96">
          <Image src={pkg.image || "/placeholder.svg"} alt={pkg.circuit} fill className="object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

          {/* Back Button */}
          <Link
            href="/packages"
            className="absolute top-6 left-6 flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-lg text-white text-sm font-medium hover:bg-white/20 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            All Packages
          </Link>

          {/* Hero Content */}
          <div className="absolute bottom-0 left-0 right-0 p-8">
            <div className="max-w-4xl">
              <div
                className={cn(
                  "inline-flex px-3 py-1.5 rounded-lg text-sm font-bold uppercase tracking-wider mb-4",
                  tierColors[pkg.tier],
                )}
              >
                {pkg.name}
              </div>
              <h1 className="text-4xl lg:text-5xl font-bold text-white mb-3">{pkg.circuit}</h1>
              <div className="flex flex-wrap items-center gap-6 text-white/80">
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  <span>
                    {pkg.location}, {pkg.country}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  <span>{pkg.dateRange}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  <span
                    className={cn(
                      "font-semibold",
                      availabilityPercent < 25
                        ? "text-red-400"
                        : availabilityPercent < 50
                          ? "text-amber-400"
                          : "text-emerald-400",
                    )}
                  >
                    {pkg.availability} spots remaining
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-8">
              {/* What's Included */}
              <div className="bg-card rounded-2xl border border-border p-6">
                <h2 className="text-xl font-bold text-foreground mb-6">What's Included</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {pkg.includes.map((item) => (
                    <div key={item} className="flex items-center gap-3 p-4 bg-muted/50 rounded-xl">
                      <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                        <Check className="h-4 w-4 text-emerald-600" />
                      </div>
                      <span className="font-medium text-foreground">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Experience Details */}
              <div className="bg-card rounded-2xl border border-border p-6">
                <h2 className="text-xl font-bold text-foreground mb-6">Experience Details</h2>
                <div className="prose prose-gray max-w-none">
                  <p className="text-muted-foreground leading-relaxed">
                    Experience the thrill of Formula 1 like never before with our exclusive {pkg.name} package at the{" "}
                    {pkg.circuit}. This premium hospitality experience offers unparalleled access to the paddock,
                    world-class dining, and unforgettable moments with the sport's elite.
                  </p>
                  <p className="text-muted-foreground leading-relaxed mt-4">
                    Your package includes all race weekend sessions - Friday practice, Saturday qualifying, and Sunday's
                    main event. Enjoy the finest cuisine, premium beverages, and exclusive access areas throughout the
                    weekend.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-4 mt-6">
                  <div className="p-4 bg-muted/50 rounded-xl text-center">
                    <Clock className="h-6 w-6 text-primary mx-auto mb-2" />
                    <p className="text-sm font-medium text-foreground">3-Day Access</p>
                    <p className="text-xs text-muted-foreground">Full weekend</p>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-xl text-center">
                    <Star className="h-6 w-6 text-primary mx-auto mb-2" />
                    <p className="text-sm font-medium text-foreground">VIP Treatment</p>
                    <p className="text-xs text-muted-foreground">Premium service</p>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-xl text-center">
                    <Shield className="h-6 w-6 text-primary mx-auto mb-2" />
                    <p className="text-sm font-medium text-foreground">Fully Insured</p>
                    <p className="text-xs text-muted-foreground">Peace of mind</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Booking Sidebar */}
            <div className="lg:col-span-1">
              <div className="sticky top-24 bg-card rounded-2xl border border-border overflow-hidden">
                <div className="p-6 border-b border-border">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-3xl font-bold text-foreground">${pkg.price.toLocaleString()}</span>
                    <span className="text-muted-foreground">/ person</span>
                  </div>
                  <p className="text-sm text-muted-foreground">Includes all taxes & fees</p>
                </div>

                <div className="p-6 space-y-6">
                  {/* Guest Count */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-3">Number of Guests</label>
                    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl">
                      <button
                        onClick={() => setGuestCount(Math.max(1, guestCount - 1))}
                        className="h-10 w-10 rounded-lg bg-background border border-border flex items-center justify-center hover:bg-muted transition-colors"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <div className="text-center">
                        <span className="text-2xl font-bold text-foreground">{guestCount}</span>
                        <p className="text-xs text-muted-foreground">guests</p>
                      </div>
                      <button
                        onClick={() => setGuestCount(Math.min(pkg.availability, guestCount + 1))}
                        className="h-10 w-10 rounded-lg bg-background border border-border flex items-center justify-center hover:bg-muted transition-colors"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Days Selection */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-3">Race Weekend</label>
                    <div className="space-y-2">
                      {[
                        { id: "friday", label: "Friday Practice", date: "Day 1" },
                        { id: "saturday", label: "Saturday Qualifying", date: "Day 2" },
                        { id: "sunday", label: "Sunday Race", date: "Day 3" },
                      ].map((day) => (
                        <div key={day.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
                          <div>
                            <p className="text-sm font-medium text-foreground">{day.label}</p>
                            <p className="text-xs text-muted-foreground">{day.date}</p>
                          </div>
                          <div className="h-5 w-5 rounded bg-emerald-500 flex items-center justify-center">
                            <Check className="h-3 w-3 text-white" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Total */}
                  <div className="pt-4 border-t border-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-muted-foreground">
                        ${pkg.price.toLocaleString()} × {guestCount} guests
                      </span>
                      <span className="font-medium text-foreground">${totalPrice.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-lg font-bold">
                      <span>Total</span>
                      <span className="text-primary">${totalPrice.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Book Button */}
                  <button
                    onClick={handleBooking}
                    className="w-full flex items-center justify-center gap-2 py-4 bg-primary text-white text-lg font-semibold rounded-xl hover:bg-primary/90 transition-colors"
                  >
                    <CreditCard className="h-5 w-5" />
                    Proceed to Checkout
                    <ChevronRight className="h-5 w-5" />
                  </button>

                  <p className="text-xs text-center text-muted-foreground">
                    Free cancellation up to 30 days before the event
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PortalLayout>
  )
}
