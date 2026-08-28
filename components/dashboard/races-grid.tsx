"use client"

import { NavLink } from "@/components/nav-link"
import { CatalogImage } from "@/components/catalog-image"
import { ArrowRight } from "lucide-react"
import type { PortalCatalog } from "@/lib/catalog/portal-catalog"
import { getSeasonSlice, type PortalCatalogSeasonYear } from "@/lib/catalog/portal-catalog"
import { pickFeaturedPackages } from "@/lib/catalog/featured-packages"
import { CATALOG_REGIONS, raceMatchesRegion } from "@/lib/catalog/regions"
import { FeaturedPackages } from "@/components/dashboard/featured-packages"
import { CatalogSeasonTabs } from "@/components/catalog/catalog-season-tabs"
import { useState } from "react"

export function RacesGrid({ catalog }: { catalog: PortalCatalog }) {
  const [seasonYear, setSeasonYear] = useState<PortalCatalogSeasonYear>(catalog.defaultSeasonYear)
  const [activeFilter, setActiveFilter] = useState<string>("all")

  const slice =
    getSeasonSlice(catalog, seasonYear) ?? catalog.seasons[0]
  const races = slice?.races ?? []
  const featuredPackages = slice ? pickFeaturedPackages(slice.packages) : []

  const filteredRaces =
    activeFilter === "all" ? races : races.filter((race) => raceMatchesRegion(race, activeFilter))

  const seasonTabs = catalog.seasons.map((s) => ({
    year: s.year,
    label: s.label,
    raceCount: s.races.length,
  }))

  return (
    <section>
      {featuredPackages.length > 0 ? <FeaturedPackages packages={featuredPackages} /> : null}

      <div className="flex flex-col gap-4 mb-5 sm:mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <CatalogSeasonTabs
            seasons={seasonTabs}
            activeYear={seasonYear}
            onChange={(y) => {
              setSeasonYear(y)
              setActiveFilter("all")
            }}
          />

          <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg overflow-x-auto shrink-0">
            <button
              type="button"
              onClick={() => setActiveFilter("all")}
              className={`px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                activeFilter === "all"
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Races
            </button>
            {CATALOG_REGIONS.map((region) => (
              <button
                key={region.id}
                type="button"
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

        {slice?.datesNote ? (
          <p className="text-sm text-muted-foreground bg-muted/50 border border-border rounded-xl px-4 py-3 max-w-3xl">
            {slice.datesNote}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {filteredRaces.map((race) => (
          <NavLink
            key={race.id}
            href={`/packages/race/${race.id}`}
            className="group relative rounded-xl overflow-hidden hover:shadow-xl hover:shadow-primary/10 transition-all duration-300"
          >
            <div className="relative aspect-[4/3] overflow-hidden">
              <CatalogImage
                src={race.image}
                alt={race.name}
                variant="card"
                fill
                sizes="(max-width: 640px) 50vw, 25vw"
                loading="lazy"
                className="object-cover group-hover:scale-110 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />

              <div className="absolute top-2 right-2 sm:top-3 sm:right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-white text-primary flex items-center justify-center">
                  <ArrowRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </div>
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4">
                <h3 className="text-sm sm:text-base font-bold text-white leading-tight">{race.shortName}</h3>
                <p className="text-[10px] sm:text-xs text-white/70 mt-0.5 sm:mt-1">{race.dateRange}</p>
                <p className="text-[10px] text-white/50 mt-0.5">{race.location}</p>
              </div>
            </div>
          </NavLink>
        ))}
      </div>

      {filteredRaces.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No races in this region for the selected season.</p>
      ) : null}
    </section>
  )
}
