"use client"

import { useState, useMemo } from "react"
import Image from "next/image"
import Link from "next/link"
import { PortalLayout } from "@/components/portal-layout"
import { races2026, packages } from "@/lib/data"
import { Search, MapPin, Calendar, ArrowRight } from "lucide-react"

export default function PackagesPage() {
  const [search, setSearch] = useState("")

  const filteredRaces = useMemo(() => {
    return races2026.filter((race) => {
      const searchMatch =
        search === "" ||
        race.name.toLowerCase().includes(search.toLowerCase()) ||
        race.shortName.toLowerCase().includes(search.toLowerCase()) ||
        race.location.toLowerCase().includes(search.toLowerCase()) ||
        race.country.toLowerCase().includes(search.toLowerCase())
      return searchMatch
    })
  }, [search])

  // Get package counts and lowest prices for each race
  const racesWithPackages = useMemo(() => {
    return filteredRaces.map((race) => {
      const racePackages = packages.filter((pkg) => {
        // Match by circuit name or date
        return (
          pkg.circuit.toLowerCase().includes(race.shortName.toLowerCase()) ||
          pkg.circuit.toLowerCase().includes(race.name.toLowerCase()) ||
          pkg.date === race.date
        )
      })
      const validPrices = racePackages.map((p) => p.price).filter((p): p is number => p !== null && p > 0)
      const lowestPrice = validPrices.length > 0 ? Math.min(...validPrices) : 0
      return {
        ...race,
        packageCount: racePackages.length,
        lowestPrice,
      }
    })
  }, [filteredRaces])

  return (
    <PortalLayout>
      <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">All Packages</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">
              Select a race to view available hospitality packages
            </p>
          </div>

          {/* Search */}
          <div className="relative max-w-md w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search races..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 sm:py-2.5 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
          </div>
        </div>

        {/* Races Table - Desktop */}
        <div className="hidden lg:block bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  <th className="text-left px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground">Race</th>
                  <th className="text-left px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground">Location</th>
                  <th className="text-left px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground">Packages</th>
                  <th className="text-right px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {racesWithPackages.map((race) => (
                  <tr key={race.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="relative w-10 h-10 sm:w-12 sm:h-12 rounded-lg overflow-hidden flex-shrink-0">
                          <Image
                            src={race.image || "/placeholder.svg"}
                            alt={race.name}
                            fill
                            className="object-cover"
                          />
                        </div>
                        <div>
                          <p className="text-sm sm:text-base font-semibold text-foreground">{race.shortName}</p>
                          <p className="text-xs sm:text-sm text-muted-foreground">{race.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <div className="flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        <span>{race.location}</span>
                      </div>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <div className="flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        <span>{race.dateRange}</span>
                      </div>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <span className="text-xs sm:text-sm font-medium text-foreground">
                        {race.packageCount} package{race.packageCount !== 1 ? "s" : ""}
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <Link
                        href={`/packages/race/${race.id}`}
                        className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-primary text-white text-xs sm:text-sm font-medium hover:bg-primary/90 transition-colors ml-auto"
                      >
                        View Packages
                        <ArrowRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {racesWithPackages.length === 0 && (
            <div className="p-8 sm:p-12 text-center">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2">No races found</h3>
              <p className="text-sm sm:text-base text-muted-foreground">Try adjusting your search</p>
            </div>
          )}
        </div>

        {/* Races Cards - Mobile */}
        <div className="lg:hidden space-y-3 sm:space-y-4">
          {racesWithPackages.map((race) => (
            <Link
              key={race.id}
              href={`/packages/race/${race.id}`}
              className="block bg-card rounded-2xl border border-border overflow-hidden hover:shadow-lg transition-shadow"
            >
              <div className="p-3 sm:p-4 space-y-2 sm:space-y-3">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="relative w-12 h-12 sm:w-16 sm:h-16 rounded-lg overflow-hidden flex-shrink-0">
                    <Image
                      src={race.image || "/placeholder.svg"}
                      alt={race.name}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm sm:text-base font-semibold text-foreground truncate">{race.shortName}</p>
                    <p className="text-xs sm:text-sm text-muted-foreground truncate">{race.name}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:gap-3 text-xs sm:text-sm">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                    <span className="truncate">{race.location}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                    <span>{race.dateRange}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <div>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">Packages</p>
                    <p className="text-xs sm:text-sm font-medium text-foreground">
                      {race.packageCount} available
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5 text-primary flex-shrink-0" />
                </div>
              </div>
            </Link>
          ))}

          {racesWithPackages.length === 0 && (
            <div className="bg-card border border-border rounded-2xl p-8 sm:p-12 text-center">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2">No races found</h3>
              <p className="text-sm sm:text-base text-muted-foreground">Try adjusting your search</p>
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  )
}

