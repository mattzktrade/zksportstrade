import Image from "next/image"
import Link from "next/link"
import { MapPin, Calendar, ArrowRight, Flame } from "lucide-react"
import { packages } from "@/lib/data"
import { cn } from "@/lib/utils"

const tierColors = {
  paddock: "bg-primary",
  champions: "bg-amber-500",
  legend: "bg-violet-600",
  hero: "bg-emerald-600",
}

export function FeaturedPackages() {
  const featuredPackages = packages.filter((p) => p.featured).slice(0, 4)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-full">
            <Flame className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-primary">Hot Right Now</span>
          </div>
          <h2 className="text-2xl font-bold text-foreground">Featured Packages</h2>
        </div>
        <Link
          href="/packages"
          className="flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
        >
          View All
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        {featuredPackages.map((pkg) => (
          <Link
            key={pkg.id}
            href={`/packages/${pkg.id}`}
            className="group bg-card rounded-2xl border border-border overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all duration-300"
          >
            {/* Image */}
            <div className="relative aspect-[4/3] overflow-hidden">
              <Image
                src={pkg.image || "/placeholder.svg"}
                alt={pkg.circuit}
                fill
                className="object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

              {/* Tier Badge */}
              <div
                className={cn(
                  "absolute top-4 left-4 px-3 py-1 rounded-full text-xs font-bold text-white uppercase tracking-wider",
                  tierColors[pkg.tier],
                )}
              >
                {pkg.tier}
              </div>

              {/* Availability */}
              <div className="absolute top-4 right-4 px-2 py-1 bg-white/90 backdrop-blur-sm rounded text-xs font-semibold text-foreground">
                {pkg.availability} left
              </div>

              {/* Circuit Name Overlay */}
              <div className="absolute bottom-4 left-4 right-4">
                <p className="text-white font-bold text-lg leading-tight">{pkg.circuit}</p>
                <div className="flex items-center gap-1 text-white/80 text-sm mt-1">
                  <MapPin className="h-3.5 w-3.5" />
                  <span>
                    {pkg.location}, {pkg.country}
                  </span>
                </div>
              </div>
            </div>

            {/* Details */}
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{pkg.name}</p>
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>{pkg.dateRange}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-end justify-between pt-4 border-t border-border">
                <div>
                  <p className="text-xs text-muted-foreground">From</p>
                  <p className="text-2xl font-bold text-foreground">${pkg.price.toLocaleString()}</p>
                </div>
                <button className="px-4 py-2 bg-foreground text-background text-sm font-semibold rounded-lg hover:bg-foreground/90 transition-colors">
                  Book Now
                </button>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
