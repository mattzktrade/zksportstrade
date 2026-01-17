"use client"

import Image from "next/image"
import Link from "next/link"
import { ArrowRight, Calendar, MapPin } from "lucide-react"
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

  // Find next upcoming race
  const today = new Date()
  const nextRace =
    races2026.find((race) => {
      const raceDate = new Date(race.dateRange.split(" - ")[0] + " 2026")
      return raceDate >= today
    }) || races2026[0]

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
        <Link
          href={`/packages?race=${encodeURIComponent(nextRace.id)}`}
          className="group block relative rounded-2xl overflow-hidden bg-foreground"
        >
          <div className="absolute inset-0">
            <Image
              src={nextRace.image || "/placeholder.svg"}
              alt={nextRace.name}
              fill
              className="object-cover opacity-60 group-hover:scale-105 group-hover:opacity-70 transition-all duration-700"
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/60 to-transparent" />

          <div className="relative p-8 md:p-12 flex flex-col md:flex-row md:items-end justify-between min-h-[280px]">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary text-white text-xs font-semibold mb-4">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                NEXT RACE
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-2">{nextRace.name}</h2>
              <div className="flex items-center gap-4 text-white/70 text-sm">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  {nextRace.dateRange}
                </span>
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" />
                  {nextRace.location}
                </span>
              </div>
            </div>

            <div className="mt-6 md:mt-0">
              <div className="inline-flex items-center gap-3 px-5 py-3 rounded-full bg-white text-foreground font-semibold group-hover:bg-primary group-hover:text-white transition-colors">
                View Packages
                <ArrowRight className="h-4 w-4" />
              </div>
            </div>
          </div>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">2026 Season</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{races2026.length} races worldwide</p>
        </div>

        {/* Region filter tabs */}
        <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
          <button
            onClick={() => setActiveFilter("all")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
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
              className={`hidden sm:block px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {filteredRaces.map((race) => {
          const globalIndex = races2026.findIndex((r) => r.id === race.id)
          return (
            <Link
              key={race.id}
              href={`/packages?race=${encodeURIComponent(race.id)}`}
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
                <div className="absolute top-3 left-3">
                  <span className="text-[10px] font-bold text-white bg-primary px-2 py-1 rounded">
                    R{String(globalIndex + 1).padStart(2, "0")}
                  </span>
                </div>

                {/* Arrow on hover */}
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="h-8 w-8 rounded-full bg-white text-primary flex items-center justify-center">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </div>

                {/* Race info at bottom */}
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <h3 className="text-base font-bold text-white leading-tight">{race.shortName}</h3>
                  <p className="text-xs text-white/70 mt-1">{race.dateRange}</p>
                  <p className="text-[11px] text-white/50 mt-0.5">{race.location}</p>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
