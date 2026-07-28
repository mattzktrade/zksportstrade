"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { CatalogImage } from "@/components/catalog-image"
import { PackageGallery } from "@/components/package-gallery"
import { prefetchCatalogImages } from "@/lib/images/prefetch-catalog-image"
import type { Package, Race } from "@/lib/types/catalog"
import {
  clampToAllowedGuestCount,
  lowStockGuestHint,
  stepAllowedGuestCount,
} from "@/lib/catalog/booking-guests"
import { nameIncludesDurationLabel, packageDurationLabel } from "@/lib/catalog/package-duration"
import { ArrowLeft, MapPin, Calendar, Users, Check, ArrowRight, ChevronDown, Minus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

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

export function RacePackagesClient({
  race,
  racePackages,
  highlightPackageId,
}: {
  race: Race
  racePackages: Package[]
  highlightPackageId?: string
}) {
  const [expandedPackage, setExpandedPackage] = useState<string | null>(null)

  useEffect(() => {
    if (!highlightPackageId) return
    if (!racePackages.some((p) => p.id === highlightPackageId)) return
    setExpandedPackage(highlightPackageId)
    const el = document.getElementById(`package-${highlightPackageId}`)
    el?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [highlightPackageId, racePackages])

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
            <CatalogImage
              src={race.image}
              alt={race.name}
              variant="hero"
              fill
              priority
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
                    rowId={`package-${pkg.id}`}
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
  rowId,
  isExpanded,
  onToggle,
}: {
  pkg: Package
  rowId: string
  isExpanded: boolean
  onToggle: () => void
}) {
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const [showFullDetails, setShowFullDetails] = useState(false)
  const isAvailabilityString = typeof pkg.availability === "string"
  const sellable = typeof pkg.availability === "number" ? pkg.availability : 0
  const maxGuests = isAvailabilityString ? 1 : Math.min(sellable, pkg.totalCapacity)
  const [guestCount, setGuestCount] = useState(() =>
    isAvailabilityString ? 1 : clampToAllowedGuestCount(sellable, 1),
  )
  const totalPrice = pkg.price ? pkg.price * guestCount : 0
  const canBook = !isAvailabilityString && pkg.price !== null && sellable > 0
  const stockHint = !isAvailabilityString ? lowStockGuestHint(sellable) : null
  const includeItems = pkg.includes.map((item) => item.trim()).filter(Boolean)
  const description = pkg.description?.trim() ? pkg.description.trim() : DEFAULT_PACKAGE_DESCRIPTION
  const shouldCollapseDetails =
    description.length > 180 || includeItems.length > 4 || includeItems.some((item) => item.length > 72)

  const packageImages = useMemo(() => {
    const primaryImage = pkg.image?.trim() || "/placeholder.svg"
    const extras = (pkg.galleryImages ?? []).filter(
      (u) => typeof u === "string" && u.trim().length > 0 && u.trim() !== primaryImage,
    )
    return [primaryImage, ...extras.map((u) => u.trim())]
  }, [pkg.image, pkg.galleryImages])

  const preloadGallery = useCallback(() => {
    prefetchCatalogImages(packageImages, "card")
  }, [packageImages])

  useEffect(() => {
    if (!isExpanded) {
      setSelectedImageIndex(0)
      setShowFullDetails(false)
    }
  }, [isExpanded])

  return (
    <div id={rowId} className="scroll-mt-24">
      {/* Desktop Row */}
      <div
        className={cn(
          "hidden lg:grid grid-cols-[2fr_1fr_140px_80px] gap-4 p-4 items-center hover:bg-muted/30 transition-colors cursor-pointer",
          isExpanded && "bg-muted/30",
        )}
        onClick={onToggle}
        onMouseEnter={preloadGallery}
        onFocus={preloadGallery}
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
        onTouchStart={preloadGallery}
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
            <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)_minmax(280px,0.8fr)] xl:items-start">
              {/* Left Column - Image Gallery */}
              <div className="min-w-0 lg:col-span-1">
                <PackageGallery
                  images={packageImages}
                  alt={pkg.name}
                  selectedIndex={selectedImageIndex}
                  onSelectIndex={setSelectedImageIndex}
                  warmCache
                  className="w-full aspect-[16/10] xl:aspect-auto xl:h-[380px]"
                />
              </div>

              {/* Middle Column - Package Details */}
              <div className="min-w-0 lg:col-span-1">
                <div
                  className={cn(
                    "relative w-full rounded-2xl border border-border bg-card p-4 sm:p-5 lg:p-6",
                    !showFullDetails && shouldCollapseDetails ? "xl:h-[380px]" : "xl:min-h-[380px]",
                    !showFullDetails && shouldCollapseDetails && "xl:overflow-hidden",
                  )}
                >
                  {/* Package Info */}
                  <div className="border-b border-border pb-4 sm:pb-5">
                    <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                      Package details
                    </p>
                    <h3 className="mt-2 text-xl sm:text-2xl font-bold leading-tight text-foreground">{pkg.name}</h3>
                    {(packageDurationLabel(pkg.duration) && !nameIncludesDurationLabel(pkg.name)) ||
                    pkg.totalCapacity > 0 ||
                    pkg.brochureUrl ? (
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs sm:text-sm text-muted-foreground">
                        {packageDurationLabel(pkg.duration) && !nameIncludesDurationLabel(pkg.name) ? (
                          <span>{packageDurationLabel(pkg.duration)}</span>
                        ) : null}
                        {pkg.totalCapacity > 0 ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Users className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
                            <span>Suite capacity {pkg.totalCapacity}</span>
                          </span>
                        ) : null}
                        {pkg.brochureUrl ? (
                          <a
                            href={pkg.brochureUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-muted-foreground underline-offset-4 hover:underline"
                          >
                            View brochure
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {/* Package Description */}
                  <div className="py-4 sm:py-5">
                    <h4 className="text-sm sm:text-base font-semibold text-foreground mb-2">About this package</h4>
                    <p
                      className={cn(
                        "max-w-prose text-sm sm:text-[15px] text-muted-foreground leading-7 whitespace-pre-wrap",
                        !showFullDetails && shouldCollapseDetails && "xl:max-h-24 xl:overflow-hidden",
                      )}
                    >
                      {description}
                    </p>
                  </div>

                  {/* Package inclusions */}
                  {includeItems.length > 0 ? (
                    <div className="border-t border-border pt-4 sm:pt-5">
                      <h4 className="text-sm sm:text-base font-semibold text-foreground mb-3">
                        Package Includes
                      </h4>
                      <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
                        {includeItems.map((item, index) => (
                          <div
                            key={item}
                            className={cn(
                              "flex items-start gap-2 text-xs sm:text-sm text-muted-foreground",
                              !showFullDetails && shouldCollapseDetails && index >= 4 && "xl:hidden",
                            )}
                          >
                            <Check className="mt-0.5 h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary flex-shrink-0" />
                            <span className="leading-relaxed">{item}</span>
                          </div>
                        ))}
                      </div>
                      {!showFullDetails && includeItems.length > 4 ? (
                        <p className="mt-2 hidden text-xs text-muted-foreground xl:block">
                          + {includeItems.length - 4} more included
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {shouldCollapseDetails ? (
                    <div
                      className={cn(
                        "mt-4 hidden xl:block",
                        !showFullDetails &&
                          "xl:absolute xl:inset-x-0 xl:bottom-0 xl:rounded-b-2xl xl:bg-gradient-to-t xl:from-card xl:via-card xl:to-card/80 xl:px-6 xl:pb-5 xl:pt-12",
                      )}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowFullDetails((v) => !v)
                        }}
                        className="inline-flex w-full items-center justify-center rounded-xl border border-border bg-background px-3 py-2 text-xs sm:text-sm font-semibold text-foreground transition-colors hover:bg-muted"
                      >
                        {showFullDetails ? "Show less" : "Show full details"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Right Column - Booking Section */}
              <div className="min-w-0 lg:col-span-2 xl:col-span-1">
                <div className="lg:sticky lg:top-6">
                  <div className="flex w-full flex-col bg-card border border-border rounded-xl p-3 sm:p-4 xl:p-3.5 space-y-2.5 xl:h-[380px] xl:overflow-hidden">
                    {/* Price */}
                    <div>
                      <p className="text-[10px] sm:text-xs text-muted-foreground mb-1">Price per person</p>
                      {pkg.price !== null ? (
                        <p className="text-xl font-bold text-foreground">${pkg.price.toLocaleString()}</p>
                      ) : (
                        <p className="text-xl sm:text-2xl font-bold text-muted-foreground">-</p>
                      )}
                    </div>

                    {/* Guest Selector - Only show if can book */}
                    {canBook && (
                      <>
                        {pkg.agentHoldUnits != null && pkg.agentHoldUnits > 0 && pkg.agentHoldExpiresAt ? (
                          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-950 dark:text-amber-100">
                            <p className="font-semibold">
                              {pkg.agentHoldUnits} held until{" "}
                              <span className="font-medium">{new Date(pkg.agentHoldExpiresAt).toLocaleTimeString()}</span>
                            </p>
                          </div>
                        ) : null}
                        <div>
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <label className="block text-xs sm:text-sm font-medium text-foreground">Number of Guests</label>
                            <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] sm:text-xs font-semibold text-emerald-700">
                              {typeof pkg.availability === "number"
                                ? `${pkg.availability} available${
                                    pkg.agentHoldUnits != null && pkg.agentHoldUnits > 0 ? " incl. hold" : ""
                                  }`
                                : String(pkg.availability)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setGuestCount(stepAllowedGuestCount(sellable, guestCount, "down"))
                              }}
                              disabled={guestCount <= stepAllowedGuestCount(sellable, guestCount, "down")}
                              className={cn(
                                "p-1.5 rounded-lg border border-border hover:bg-muted transition-colors",
                                guestCount <= stepAllowedGuestCount(sellable, guestCount, "down") &&
                                  "opacity-50 cursor-not-allowed",
                              )}
                            >
                              <Minus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            </button>
                            <div className="flex-1 text-center">
                              <span className="text-base font-semibold text-foreground">{guestCount}</span>
                              <span className="text-xs sm:text-sm text-muted-foreground ml-1.5">
                                {guestCount === 1 ? "guest" : "guests"}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setGuestCount(stepAllowedGuestCount(sellable, guestCount, "up"))
                              }}
                              disabled={guestCount >= stepAllowedGuestCount(sellable, guestCount, "up")}
                              className={cn(
                                "p-1.5 rounded-lg border border-border hover:bg-muted transition-colors",
                                guestCount >= stepAllowedGuestCount(sellable, guestCount, "up") &&
                                  "opacity-50 cursor-not-allowed",
                              )}
                            >
                              <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            </button>
                          </div>
                          {stockHint ? (
                            <p className="text-[10px] sm:text-xs text-muted-foreground text-center leading-snug px-1">
                              Limited stock: only allowed quantities can be selected.
                            </p>
                          ) : null}
                        </div>

                        {/* Total Price */}
                        {pkg.price !== null && (
                          <div className="pt-2 border-t border-border">
                            <div className="flex items-center justify-between text-xs mb-1.5">
                              <span className="text-muted-foreground">
                                ${pkg.price.toLocaleString()} × {guestCount} {guestCount === 1 ? "guest" : "guests"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between pt-2 border-t border-border">
                              <span className="text-xs sm:text-sm font-semibold text-foreground">Total</span>
                              <span className="text-lg font-bold text-primary">${totalPrice.toLocaleString()}</span>
                            </div>
                          </div>
                        )}

                        {pkg.requiresBookingApproval ? (
                          <p className="rounded-lg bg-amber-500/10 px-3 py-1.5 text-center text-[10px] font-medium text-amber-800 dark:text-amber-200">
                            Approval required before confirmation.
                          </p>
                        ) : null}
                        <Link
                          href={`/checkout?package=${pkg.id}&guests=${guestCount}`}
                          className="mt-auto w-full inline-flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 bg-primary text-white rounded-xl font-semibold hover:bg-primary/90 transition-colors text-xs sm:text-sm xl:mb-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {pkg.requiresBookingApproval ? "Request approval" : "Proceed to Checkout"}
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
