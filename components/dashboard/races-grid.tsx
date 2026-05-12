"use client"

import Image from "next/image"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { races2026 } from "@/lib/data"
import { useState } from "react"

const regions = [
  { id: "middle-east", name: "Middle East", countries: ["Bahrain", "Saudi Arabia", "Qatar", "Abu Dhabi"] },
  { id: "asia-pacific", name: "Asia Pacific", countries: ["Australia", "Japan", "China", "Singapore"] },
  {
    id: "europe",
    name: "Europe",
    countries: ["Monaco", "Spain", "Austria", "UK", "Belgium", "Hungary", "Netherlands", "Italy", "Azerbaijan"],
  },
  { id: "americas", name: "Americas", countries: ["USA", "Canada", "Mexico", "Brazil"] },
]

export function RacesGrid() {
  const [activeFilter, setActiveFilter] = useState<string>("all")

  // Filter races based on region
  const filteredRaces =
    activeFilter === "all"
      ? races2026
      : races2026.filter((race) => {
          const region = regions.find((r) => r.id === activeFilter)
          return region?.countries.some((country) => race.location.includes(country) || race.country === country)
        })

  return (
    <section>
      <div className="mb-10">
        <div className="group relative rounded-2xl overflow-hidden bg-foreground">
          <div className="absolute inset-0">
            <Image
              src="/dashboardheader.jpg"
              alt="Dashboard Header"
              fill
              className="object-cover opacity-50 group-hover:opacity-55 group-hover:scale-105 transition-all duration-700"
              priority
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/65 to-black/75" />

          <div className="relative flex flex-col min-h-[240px] sm:min-h-[280px] p-6 sm:p-8 md:p-10">
            <div className="flex-1 flex flex-col justify-center items-start max-w-2xl">
              <div className="mb-6 sm:mb-8">
                <div className="inline-flex items-center gap-2 mb-3 sm:mb-4">
                  <div className="h-px w-6 sm:w-8 bg-primary" />
                  <span className="text-primary text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.25em]">Trade Portal</span>
                </div>
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-2 tracking-tight">
                  Welcome to <span className="text-primary">ZK</span> Sports & Entertainment
                </h1>
                <p className="text-white/70 text-xs sm:text-sm md:text-base">
                  Access exclusive F1 hospitality packages and manage your bookings
                </p>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-2 sm:gap-2.5">
              <Link
                href="/packages"
                className="group inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-md bg-white/10 backdrop-blur-sm text-white text-xs sm:text-sm font-medium hover:bg-primary hover:text-white border border-white/20 hover:border-primary/50 transition-all duration-200"
              >
                <span>Packages</span>
                <ArrowRight className="h-3 w-3 sm:h-3.5 sm:w-3.5 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </Link>
              <Link
                href="/bookings"
                className="group inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-md bg-white/10 backdrop-blur-sm text-white text-xs sm:text-sm font-medium hover:bg-primary hover:text-white border border-white/20 hover:border-primary/50 transition-all duration-200"
              >
                <span>Bookings</span>
                <ArrowRight className="h-3 w-3 sm:h-3.5 sm:w-3.5 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </Link>
              <Link
                href="/invoices"
                className="group inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-md bg-white/10 backdrop-blur-sm text-white text-xs sm:text-sm font-medium hover:bg-primary hover:text-white border border-white/20 hover:border-primary/50 transition-all duration-200"
              >
                <span>Invoices</span>
                <ArrowRight className="h-3 w-3 sm:h-3.5 sm:w-3.5 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="relative inline-block">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground tracking-tight">
            2026 Season
          </h2>
          <div className="absolute -bottom-1.5 left-0 h-[2px] w-16 sm:w-20 md:w-28 bg-gradient-to-r from-red-600 via-red-500/70 to-transparent" />
        </div>

        {/* Region filter tabs */}
        <div className="flex items-center gap-1 p-1 bg-muted rounded-lg overflow-x-auto">
          <button
            onClick={() => setActiveFilter("all")}
            className={`px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
              activeFilter === "all"
                ? "bg-white text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All Races
          </button>
          {regions.map((region) => (
            <button
              key={region.id}
              onClick={() => setActiveFilter(region.id)}
              className={`px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                activeFilter === region.id
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {region.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {filteredRaces.map((race) => {
          const globalIndex = races2026.findIndex((r) => r.id === race.id)
          return (
            <Link
              key={race.id}
              href={`/packages/race/${race.id}`}
              className="group relative rounded-xl overflow-hidden hover:shadow-xl hover:shadow-primary/10 transition-all duration-300"
            >
              {/* Race Image - full card */}
              <div className="relative aspect-[4/3] overflow-hidden">
                <Image
                  src={race.image || "/placeholder.svg"}
                  alt={race.name}
                  fill
                  className="object-cover group-hover:scale-110 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />

                {/* Round badge */}
                <div className="absolute top-2 left-2 sm:top-3 sm:left-3">
                  <span className="text-[9px] sm:text-[10px] font-bold text-white bg-primary px-1.5 sm:px-2 py-0.5 sm:py-1 rounded">
                    R{String(globalIndex + 1).padStart(2, "0")}
                  </span>
                </div>

                {/* Arrow on hover */}
                <div className="absolute top-2 right-2 sm:top-3 sm:right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-white text-primary flex items-center justify-center">
                    <ArrowRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </div>
                </div>

                {/* Race info at bottom */}
                <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4">
                  <h3 className="text-sm sm:text-base font-bold text-white leading-tight">{race.shortName}</h3>
                  <p className="text-[10px] sm:text-xs text-white/70 mt-0.5 sm:mt-1">{race.dateRange}</p>
                  <p className="text-[10px] text-white/50 mt-0.5">{race.location}</p>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
