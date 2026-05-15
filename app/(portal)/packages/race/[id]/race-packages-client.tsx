"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import type { Package, Race } from "@/lib/types/catalog"
import { packageDurationLabel } from "@/lib/catalog/package-duration"
import { ArrowLeft, MapPin, Calendar, Users, Check, ArrowRight, ChevronDown, Minus, Plus, ChevronLeft, ChevronRight, FileDown, Link2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const DEFAULT_PACKAGE_DESCRIPTION =
  "Experience the ultimate Formula 1 hospitality with this premium package. Enjoy exclusive access to the paddock area, world-class dining, and unforgettable moments with the sport's elite. This package includes all race weekend sessions - Friday practice, Saturday qualifying, and Sunday's main event."

const PACKAGE_ENQUIRY_EMAIL = "matt@zk-sports.com"

function packageEnquireMailto(pkg: Package): string {
  const subject = `Enquiry: ${pkg.name} (${pkg.circuit})`
  const body = `Hi,

I would like to enquire about the following package:

Package: ${pkg.name}
Event: ${pkg.circuit}
Dates: ${pkg.dateRange}

`
  return `mailto:${PACKAGE_ENQUIRY_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export function RacePackagesClient({ race, racePackages }: { race: Race; racePackages: Package[] }) {
  const [expandedPackage, setExpandedPackage] = useState<string | null>(null)

  return (
    <>
      <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
        {/* Back Button */}
        <Link
          href="/packages"
          className="inline-flex items-center gap-2 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          Back to all races
        </Link>

        {/* Race Header */}
        <div className="relative rounded-2xl overflow-hidden bg-foreground min-h-[200px] sm:min-h-[240px] md:min-h-[280px] lg:min-h-[320px] group">
          <div className="absolute inset-0">
            <Image
              src={race.image || "/placeholder.svg"}
              alt={race.name}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-700"
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-black/85 via-black/75 to-black/85" />

          <div className="relative p-4 sm:p-6 md:p-8 lg:p-10 xl:p-12">
            <div className="max-w-3xl">
              <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold text-white mb-4 sm:mb-6 leading-tight tracking-tight">
                {race.name}
              </h1>
              
              <div className="flex flex-wrap items-center gap-4 sm:gap-6 md:gap-8">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-white/10 backdrop-blur-sm border border-white/20">
                    <MapPin className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wider mb-0.5">Location</p>
                    <p className="text-sm sm:text-base md:text-lg font-semibold text-white">{race.location}, {race.country}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-white/10 backdrop-blur-sm border border-white/20">
                    <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wider mb-0.5">Date</p>
                    <p className="text-sm sm:text-base md:text-lg font-semibold text-white">{race.dateRange}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Packages Section */}
        <div>
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-foreground">Available Packages</h2>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                {racePackages.length} package{racePackages.length !== 1 ? "s" : ""} available
              </p>
            </div>
          </div>

          {racePackages.length === 0 ? (
            <div className="bg-card border border-border rounded-2xl p-8 sm:p-12 text-center">
              <p className="text-sm sm:text-base text-muted-foreground">No packages available for this race.</p>
            </div>
          ) : (
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              {/* Table Header - Desktop */}
              <div className="hidden lg:grid grid-cols-[2fr_1fr_140px_80px] gap-4 p-4 bg-muted/30 border-b border-border text-sm font-medium text-muted-foreground">
                <div>Package</div>
                <div>Price</div>
                <div className="text-center">Stock</div>
                <div></div>
              </div>

              {/* Packages List */}
              <div className="divide-y divide-border">
                {racePackages.map((pkg) => (
                  <PackageRow
                    key={pkg.id}
                    pkg={pkg}
                    isExpanded={expandedPackage === pkg.id}
                    onToggle={() => setExpandedPackage(expandedPackage === pkg.id ? null : pkg.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function PackageRow({
  pkg,
  isExpanded,
  onToggle,
}: {
  pkg: Package
  isExpanded: boolean
  onToggle: () => void
}) {
  const [guestCount, setGuestCount] = useState(1)
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const isAvailabilityString = typeof pkg.availability === "string"
  const totalPrice = pkg.price ? pkg.price * guestCount : 0
  const sellable = typeof pkg.availability === "number" ? pkg.availability : 0
  const maxGuests = isAvailabilityString ? 1 : Math.min(sellable, pkg.totalCapacity)
  const canBook = !isAvailabilityString && pkg.price !== null && sellable > 0

  const primaryImage = pkg.image?.trim() || "/placeholder.svg"
  const extras = (pkg.galleryImages ?? []).filter((u) => typeof u === "string" && u.trim().length > 0 && u.trim() !== primaryImage)
  const packageImages = [primaryImage, ...extras.map((u) => u.trim())]

  return (
    <div>
      {/* Desktop Row */}
      <div
        className={cn(
          "hidden lg:grid grid-cols-[2fr_1fr_140px_80px] gap-4 p-4 items-center hover:bg-muted/30 transition-colors cursor-pointer",
          isExpanded && "bg-muted/30",
        )}
        onClick={onToggle}
      >
        <div>
          <p className="font-semibold text-foreground">{pkg.name}</p>
        </div>
        <div>
          {pkg.price !== null ? (
            <>
              <p className="font-bold text-foreground">${pkg.price.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">per person</p>
            </>
          ) : (
            <p className="font-bold text-muted-foreground">-</p>
          )}
        </div>
        <div className="text-center">
          <span className="text-base font-semibold text-foreground">
            {isAvailabilityString ? pkg.availability : pkg.availability}
          </span>
        </div>
        <div className="flex items-center justify-end">
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")}
          />
        </div>
      </div>

      {/* Mobile Row */}
      <div
        className={cn(
          "lg:hidden p-3 sm:p-4 border-b border-border hover:bg-muted/30 transition-colors cursor-pointer",
          isExpanded && "bg-muted/30",
        )}
        onClick={onToggle}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex-1 min-w-0 pr-2">
            <p className="text-sm sm:text-base font-semibold text-foreground truncate">{pkg.name}</p>
          </div>
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform flex-shrink-0", isExpanded && "rotate-180")}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div>
            {pkg.price !== null ? (
              <>
                <p className="text-sm sm:text-base font-bold text-foreground">${pkg.price.toLocaleString()}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground">per person</p>
              </>
            ) : (
              <p className="text-sm sm:text-base font-bold text-muted-foreground">-</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] sm:text-xs text-muted-foreground mb-0.5">Stock</p>
            <p className="text-sm sm:text-base font-semibold text-foreground">
              {isAvailabilityString ? pkg.availability : pkg.availability}
            </p>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-3 sm:px-4 pb-3 sm:pb-4 lg:px-6 lg:pb-6">
          <div className="pt-3 sm:pt-4 border-t border-border">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
              {/* Left Column - Image Gallery */}
              <div className="lg:col-span-1">
                <div className="relative aspect-[16/10] rounded-xl overflow-hidden group">
                  <Image
                    src={packageImages[selectedImageIndex]}
                    alt={pkg.name}
                    fill
                    className="object-cover"
                  />
                  {/* Navigation Arrows */}
                  {packageImages.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedImageIndex((prev) => (prev === 0 ? packageImages.length - 1 : prev - 1))
                        }}
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 sm:p-2 bg-black/50 hover:bg-black/70 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedImageIndex((prev) => (prev === packageImages.length - 1 ? 0 : prev + 1))
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 sm:p-2 bg-black/50 hover:bg-black/70 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                      </button>
                    </>
                  )}
                  {/* Image Counter */}
                  {packageImages.length > 1 && (
                    <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/50 rounded text-[10px] sm:text-xs text-white">
                      {selectedImageIndex + 1} / {packageImages.length}
                    </div>
                  )}
                </div>
              </div>

              {/* Middle Column - Package Details */}
              <div className="lg:col-span-1 flex flex-col lg:aspect-[16/10]">
                {/* Package Info */}
                <div>
                  <h3 className="text-lg sm:text-xl font-bold text-foreground mb-2 sm:mb-3">{pkg.name}</h3>
                  <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs sm:text-sm text-muted-foreground mb-3 sm:mb-4">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      <span>{pkg.dateRange}</span>
                    </div>
                    {packageDurationLabel(pkg.duration) ? (
                      <span className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-foreground font-medium">
                        {packageDurationLabel(pkg.duration)}
                      </span>
                    ) : null}
                    <div className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      <span>Suite Capacity: {pkg.totalCapacity}</span>
                    </div>
                  </div>
                </div>

                {/* Package Description */}
                <div className="mb-3 sm:mb-4">
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {pkg.description?.trim() ? pkg.description.trim() : DEFAULT_PACKAGE_DESCRIPTION}
                  </p>
                </div>

                {/* Package Inclusions */}
                <div className="mt-auto">
                  <h4 className="text-xs sm:text-sm font-semibold text-foreground mb-2 sm:mb-3">Package Includes</h4>
                  <div className="space-y-1.5 sm:space-y-2">
                    {pkg.includes.map((item) => (
                      <div key={item} className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                        <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary flex-shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                  {pkg.brochureUrl ? (
                    <div className="mt-4 rounded-xl border border-border bg-muted/20 p-3 sm:p-4 space-y-2">
                      <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Brochure</p>
                      <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                        Share this PDF or page with your client. Opens in a new tab — use your browser to download or share.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                        <a
                          href={pkg.brochureUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs sm:text-sm font-semibold hover:bg-primary/90 transition-colors"
                        >
                          <FileDown className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                          View brochure
                        </a>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void navigator.clipboard.writeText(pkg.brochureUrl!).then(
                              () => toast.success("Link copied"),
                              () => toast.error("Could not copy — open the brochure and copy from the address bar"),
                            )
                          }}
                          className="inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-xl border border-border bg-background text-xs sm:text-sm font-semibold text-foreground hover:bg-muted transition-colors"
                        >
                          <Link2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                          Copy link
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Right Column - Booking Section */}
              <div className="lg:col-span-1">
                <div className="lg:sticky lg:top-6">
                  <div className="bg-card border border-border rounded-xl p-3 sm:p-4 space-y-3 sm:space-y-4">
                    {/* Price */}
                    <div>
                      <p className="text-[10px] sm:text-xs text-muted-foreground mb-1">Price per person</p>
                      {pkg.price !== null ? (
                        <p className="text-xl sm:text-2xl font-bold text-foreground">${pkg.price.toLocaleString()}</p>
                      ) : (
                        <p className="text-xl sm:text-2xl font-bold text-muted-foreground">-</p>
                      )}
                    </div>

                    {/* Guest Selector - Only show if can book */}
                    {canBook && (
                      <>
                        {pkg.agentHoldUnits != null && pkg.agentHoldUnits > 0 && pkg.agentHoldExpiresAt ? (
                          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100 mb-3">
                            <p className="font-semibold">Your active hold</p>
                            <p className="mt-0.5 leading-relaxed">
                              {pkg.agentHoldUnits} seat{pkg.agentHoldUnits !== 1 ? "s" : ""} reserved until{" "}
                              {new Date(pkg.agentHoldExpiresAt).toLocaleString()}. Stock shown includes your hold so you
                              can proceed to checkout.
                            </p>
                          </div>
                        ) : null}
                        <div>
                          <label className="block text-xs sm:text-sm font-medium text-foreground mb-2">Number of Guests</label>
                          <div className="flex items-center gap-2 sm:gap-3 mb-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setGuestCount(Math.max(1, guestCount - 1))
                              }}
                              disabled={guestCount <= 1}
                              className={cn(
                                "p-1.5 sm:p-2 rounded-lg border border-border hover:bg-muted transition-colors",
                                guestCount <= 1 && "opacity-50 cursor-not-allowed"
                              )}
                            >
                              <Minus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            </button>
                            <div className="flex-1 text-center">
                              <span className="text-base sm:text-lg font-semibold text-foreground">{guestCount}</span>
                              <span className="text-xs sm:text-sm text-muted-foreground ml-1.5">
                                {guestCount === 1 ? "guest" : "guests"}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setGuestCount(Math.min(maxGuests, guestCount + 1))
                              }}
                              disabled={guestCount >= maxGuests}
                              className={cn(
                                "p-1.5 sm:p-2 rounded-lg border border-border hover:bg-muted transition-colors",
                                guestCount >= maxGuests && "opacity-50 cursor-not-allowed"
                              )}
                            >
                              <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            </button>
                          </div>
                          <p className="text-[10px] sm:text-xs text-muted-foreground text-center">
                            {typeof pkg.availability === "number"
                              ? `${pkg.availability} available${
                                  pkg.agentHoldUnits != null && pkg.agentHoldUnits > 0 ? " (includes your hold)" : ""
                                }`
                              : String(pkg.availability)}
                          </p>
                        </div>

                        {/* Total Price */}
                        {pkg.price !== null && (
                          <div className="pt-2 sm:pt-3 border-t border-border">
                            <div className="flex items-center justify-between text-xs sm:text-sm mb-2">
                              <span className="text-muted-foreground">
                                ${pkg.price.toLocaleString()} × {guestCount} {guestCount === 1 ? "guest" : "guests"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between pt-2 border-t border-border">
                              <span className="text-xs sm:text-sm font-semibold text-foreground">Total</span>
                              <span className="text-lg sm:text-xl font-bold text-primary">${totalPrice.toLocaleString()}</span>
                            </div>
                          </div>
                        )}

                        {/* Book Button */}
                        <Link
                          href={`/checkout?package=${pkg.id}&guests=${guestCount}`}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 bg-primary text-white rounded-xl font-semibold hover:bg-primary/90 transition-colors text-xs sm:text-sm"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Proceed to Checkout
                          <ArrowRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </Link>
                      </>
                    )}
                    {!canBook && (
                      <div className="pt-2 sm:pt-3 border-t border-border space-y-3">
                        <p className="text-xs sm:text-sm text-muted-foreground text-center">
                          {isAvailabilityString
                            ? `Please contact us for availability and pricing`
                            : pkg.price === null
                              ? "Pricing available upon request"
                              : "Not available for booking"}
                        </p>
                        <a
                          href={packageEnquireMailto(pkg)}
                          className="w-full inline-flex items-center justify-center px-4 sm:px-5 py-2 sm:py-2.5 bg-primary text-primary-foreground rounded-xl text-xs sm:text-sm font-semibold hover:bg-primary/90 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Enquire
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
