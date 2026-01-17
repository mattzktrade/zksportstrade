"use client"

import { useState, useMemo } from "react"
import Image from "next/image"
import Link from "next/link"
import { PortalLayout } from "@/components/portal-layout"
import { packages, type Package } from "@/lib/data"
import { Search, SlidersHorizontal, MapPin, Calendar, Users, X, Grid3X3, List } from "lucide-react"
import { cn } from "@/lib/utils"

const tierFilters = [
  { value: "all", label: "All Tiers" },
  { value: "paddock", label: "Paddock Club" },
  { value: "champions", label: "Champions Club" },
  { value: "legend", label: "Legend" },
  { value: "hero", label: "Hero" },
]

const priceFilters = [
  { value: "all", label: "Any Price" },
  { value: "under5k", label: "Under $5,000" },
  { value: "5k-7k", label: "$5,000 - $7,000" },
  { value: "over7k", label: "Over $7,000" },
]

const tierColors = {
  paddock: "bg-primary text-white",
  champions: "bg-amber-500 text-white",
  legend: "bg-violet-600 text-white",
  hero: "bg-emerald-600 text-white",
}

export default function PackagesPage() {
  const [search, setSearch] = useState("")
  const [tierFilter, setTierFilter] = useState("all")
  const [priceFilter, setPriceFilter] = useState("all")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [showFilters, setShowFilters] = useState(false)

  const filteredPackages = useMemo(() => {
    return packages.filter((pkg) => {
      // Search filter
      const searchMatch =
        search === "" ||
        pkg.circuit.toLowerCase().includes(search.toLowerCase()) ||
        pkg.location.toLowerCase().includes(search.toLowerCase()) ||
        pkg.country.toLowerCase().includes(search.toLowerCase())

      // Tier filter
      const tierMatch = tierFilter === "all" || pkg.tier === tierFilter

      // Price filter
      let priceMatch = true
      if (priceFilter === "under5k") priceMatch = pkg.price < 5000
      else if (priceFilter === "5k-7k") priceMatch = pkg.price >= 5000 && pkg.price <= 7000
      else if (priceFilter === "over7k") priceMatch = pkg.price > 7000

      return searchMatch && tierMatch && priceMatch
    })
  }, [search, tierFilter, priceFilter])

  const clearFilters = () => {
    setSearch("")
    setTierFilter("all")
    setPriceFilter("all")
  }

  const hasActiveFilters = search !== "" || tierFilter !== "all" || priceFilter !== "all"

  return (
    <PortalLayout>
      <div className="p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">F1 Hospitality Packages</h1>
            <p className="text-muted-foreground mt-1">
              Browse and book premium experiences for the {new Date().getFullYear()} season
            </p>
          </div>

          {/* Search & View Toggle */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search circuits, locations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64 pl-10 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              />
            </div>

            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all",
                showFilters ? "bg-primary text-white" : "bg-card border border-border hover:bg-muted",
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
            </button>

            <div className="flex items-center border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className={cn(
                  "p-2.5 transition-colors",
                  viewMode === "grid" ? "bg-primary text-white" : "bg-card hover:bg-muted",
                )}
              >
                <Grid3X3 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "p-2.5 transition-colors",
                  viewMode === "list" ? "bg-primary text-white" : "bg-card hover:bg-muted",
                )}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">Filter Packages</h3>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 text-sm text-primary hover:text-primary/80"
                >
                  <X className="h-3 w-3" />
                  Clear all
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Tier Filter */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Package Tier</label>
                <div className="flex flex-wrap gap-2">
                  {tierFilters.map((filter) => (
                    <button
                      key={filter.value}
                      onClick={() => setTierFilter(filter.value)}
                      className={cn(
                        "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                        tierFilter === filter.value
                          ? "bg-foreground text-background"
                          : "bg-muted hover:bg-muted/80 text-foreground",
                      )}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price Filter */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Price Range</label>
                <div className="flex flex-wrap gap-2">
                  {priceFilters.map((filter) => (
                    <button
                      key={filter.value}
                      onClick={() => setPriceFilter(filter.value)}
                      className={cn(
                        "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                        priceFilter === filter.value
                          ? "bg-foreground text-background"
                          : "bg-muted hover:bg-muted/80 text-foreground",
                      )}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results Count */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{filteredPackages.length}</span> packages
          </p>
        </div>

        {/* Packages Grid/List */}
        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredPackages.map((pkg) => (
              <PackageCard key={pkg.id} pkg={pkg} />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredPackages.map((pkg) => (
              <PackageListItem key={pkg.id} pkg={pkg} />
            ))}
          </div>
        )}

        {filteredPackages.length === 0 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <Search className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No packages found</h3>
            <p className="text-muted-foreground mb-4">Try adjusting your filters or search terms</p>
            <button onClick={clearFilters} className="text-primary font-medium hover:text-primary/80">
              Clear all filters
            </button>
          </div>
        )}
      </div>
    </PortalLayout>
  )
}

function PackageCard({ pkg }: { pkg: Package }) {
  const availabilityPercent = (pkg.availability / pkg.totalCapacity) * 100

  return (
    <Link
      href={`/packages/${pkg.id}`}
      className="group bg-card rounded-2xl border border-border overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all duration-300"
    >
      {/* Image */}
      <div className="relative aspect-[16/10] overflow-hidden">
        <Image
          src={pkg.image || "/placeholder.svg"}
          alt={pkg.circuit}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        {/* Tier Badge */}
        <div
          className={cn(
            "absolute top-4 left-4 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider",
            tierColors[pkg.tier],
          )}
        >
          {pkg.tier}
        </div>

        {/* Circuit Info */}
        <div className="absolute bottom-4 left-4 right-4">
          <h3 className="text-white font-bold text-xl mb-1">{pkg.circuit}</h3>
          <div className="flex items-center gap-1.5 text-white/80 text-sm">
            <MapPin className="h-3.5 w-3.5" />
            <span>
              {pkg.location}, {pkg.country}
            </span>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{pkg.name}</p>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
              <Calendar className="h-3.5 w-3.5" />
              <span>{pkg.dateRange}</span>
            </div>
          </div>
        </div>

        {/* Availability Bar */}
        <div>
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="text-muted-foreground">Availability</span>
            <span
              className={cn(
                "font-semibold",
                availabilityPercent < 25
                  ? "text-red-500"
                  : availabilityPercent < 50
                    ? "text-amber-500"
                    : "text-emerald-600",
              )}
            >
              {pkg.availability} spots left
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                availabilityPercent < 25 ? "bg-red-500" : availabilityPercent < 50 ? "bg-amber-500" : "bg-emerald-500",
              )}
              style={{ width: `${availabilityPercent}%` }}
            />
          </div>
        </div>

        {/* Price & CTA */}
        <div className="flex items-end justify-between pt-4 border-t border-border">
          <div>
            <p className="text-xs text-muted-foreground">From</p>
            <p className="text-2xl font-bold text-foreground">${pkg.price.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">per person</p>
          </div>
          <button className="px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 transition-colors">
            Book Now
          </button>
        </div>
      </div>
    </Link>
  )
}

function PackageListItem({ pkg }: { pkg: Package }) {
  const availabilityPercent = (pkg.availability / pkg.totalCapacity) * 100

  return (
    <Link
      href={`/packages/${pkg.id}`}
      className="group flex gap-6 bg-card rounded-2xl border border-border overflow-hidden hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 p-4"
    >
      {/* Image */}
      <div className="relative w-64 aspect-[4/3] rounded-xl overflow-hidden flex-shrink-0">
        <Image
          src={pkg.image || "/placeholder.svg"}
          alt={pkg.circuit}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div
          className={cn(
            "absolute top-3 left-3 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider",
            tierColors[pkg.tier],
          )}
        >
          {pkg.tier}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col justify-between py-2">
        <div>
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-xl font-bold text-foreground">{pkg.circuit}</h3>
              <div className="flex items-center gap-4 mt-1.5">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  <span>
                    {pkg.location}, {pkg.country}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{pkg.dateRange}</span>
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">From</p>
              <p className="text-2xl font-bold text-foreground">${pkg.price.toLocaleString()}</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mt-3">{pkg.name}</p>

          {/* Includes */}
          <div className="flex flex-wrap gap-2 mt-3">
            {pkg.includes.slice(0, 4).map((item) => (
              <span key={item} className="px-2.5 py-1 bg-muted rounded-lg text-xs font-medium text-foreground">
                {item}
              </span>
            ))}
            {pkg.includes.length > 4 && (
              <span className="px-2.5 py-1 bg-muted rounded-lg text-xs font-medium text-muted-foreground">
                +{pkg.includes.length - 4} more
              </span>
            )}
          </div>
        </div>

        {/* Bottom Row */}
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span
                className={cn(
                  "text-sm font-medium",
                  availabilityPercent < 25
                    ? "text-red-500"
                    : availabilityPercent < 50
                      ? "text-amber-500"
                      : "text-emerald-600",
                )}
              >
                {pkg.availability} spots left
              </span>
            </div>
            <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full",
                  availabilityPercent < 25
                    ? "bg-red-500"
                    : availabilityPercent < 50
                      ? "bg-amber-500"
                      : "bg-emerald-500",
                )}
                style={{ width: `${availabilityPercent}%` }}
              />
            </div>
          </div>

          <button className="px-6 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 transition-colors">
            View & Book
          </button>
        </div>
      </div>
    </Link>
  )
}
