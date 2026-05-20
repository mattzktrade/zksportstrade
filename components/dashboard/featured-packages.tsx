import Image from "next/image"
import Link from "next/link"
import type { Package } from "@/lib/types/catalog"
import {
  featuredPackageTagline,
  packageCheckoutHref,
  packageDetailsHref,
  packageIsBookable,
} from "@/lib/catalog/featured-packages"
import { packageDurationLabel } from "@/lib/catalog/package-duration"
import { ArrowRight, Calendar, Flame, MapPin } from "lucide-react"
import { cn } from "@/lib/utils"

function formatPrice(pkg: Package): string | null {
  if (pkg.price === null) return null
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: pkg.currency || "USD",
    maximumFractionDigits: 0,
  }).format(pkg.price)
}

function availabilityLabel(pkg: Package): { text: string; tone: "available" | "enquire" | "sold" } {
  if (typeof pkg.availability === "string") {
    return { text: pkg.availability, tone: "enquire" }
  }
  if (pkg.price === null) {
    return { text: "Enquire", tone: "enquire" }
  }
  if (pkg.availability <= 0) {
    return { text: "Sold out", tone: "sold" }
  }
  return { text: `${pkg.availability} available`, tone: "available" }
}

function FeaturedPackageCard({ pkg, rank }: { pkg: Package; rank: number }) {
  const bookable = packageIsBookable(pkg)
  const price = formatPrice(pkg)
  const tagline = featuredPackageTagline(pkg.id)
  const duration = packageDurationLabel(pkg.duration)
  const stock = availabilityLabel(pkg)

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5">
      <div className="relative aspect-[16/10] overflow-hidden">
        <Image
          src={pkg.image || "/placeholder.svg"}
          alt={pkg.name}
          fill
          className="object-cover transition-transform duration-700 group-hover:scale-105"
          sizes="(max-width: 768px) 100vw, 33vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/20" />

        <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow-lg">
            <Flame className="h-3 w-3" />
            Trending
          </span>
          <span className="rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-white/90 backdrop-blur-sm">
            #{rank}
          </span>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">{pkg.circuit}</p>
          <h3 className="mt-1 text-lg font-bold leading-snug text-white sm:text-xl">{pkg.name}</h3>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
        {tagline ? <p className="text-sm leading-relaxed text-muted-foreground">{tagline}</p> : null}

        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-primary/80" />
            {pkg.location}, {pkg.country}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 shrink-0 text-primary/80" />
            {pkg.dateRange}
          </span>
        </div>

        {duration ? <p className="text-xs font-medium text-foreground/80">{duration}</p> : null}

        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-4">
          <div>
            {price ? (
              <>
                <p className="text-xl font-bold text-foreground">{price}</p>
                <p className="text-xs text-muted-foreground">per person</p>
              </>
            ) : (
              <p className="text-sm font-semibold text-muted-foreground">Price on enquiry</p>
            )}
          </div>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
              stock.tone === "available" && "bg-emerald-500/10 text-emerald-700",
              stock.tone === "enquire" && "bg-amber-500/10 text-amber-800",
              stock.tone === "sold" && "bg-muted text-muted-foreground",
            )}
          >
            {stock.text}
          </span>
        </div>

        <div className="mt-auto flex flex-col gap-2 sm:flex-row">
          {bookable ? (
            <Link
              href={packageCheckoutHref(pkg)}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Book now
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <Link
              href={packageDetailsHref(pkg)}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              View package
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
          <Link
            href={packageDetailsHref(pkg)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/60",
              !bookable && "sm:hidden",
            )}
          >
            Details
          </Link>
        </div>
      </div>
    </article>
  )
}

export function FeaturedPackages({ packages }: { packages: Package[] }) {
  if (packages.length === 0) return null

  return (
    <section className="mb-10 sm:mb-12">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="relative max-w-2xl">
          <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl md:text-3xl">
            Trending hospitality
          </h2>
          <div className="absolute -bottom-1.5 left-0 h-[2px] w-16 bg-gradient-to-r from-primary via-primary/60 to-transparent sm:w-24" />
        </div>
        <Link
          href="/packages"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          Browse all packages
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {packages.map((pkg, index) => (
          <FeaturedPackageCard key={pkg.id} pkg={pkg} rank={index + 1} />
        ))}
      </div>
    </section>
  )
}
