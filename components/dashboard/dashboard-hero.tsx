import Image from "next/image"
import { NavLink } from "@/components/nav-link"
import { ArrowRight } from "lucide-react"

/** Server-rendered so the LCP image is in the first HTML, not after catalog/JS. */
export function DashboardHero() {
  return (
    <div className="mb-10">
      <div className="group relative overflow-hidden rounded-2xl bg-foreground">
        <div className="absolute inset-0">
          <Image
            src="/dashboardheader.jpg"
            alt=""
            fill
            priority
            fetchPriority="high"
            quality={75}
            sizes="100vw"
            className="object-cover opacity-50 transition-all duration-700 group-hover:scale-105 group-hover:opacity-55"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-zk-black/70 via-zk-black/65 to-zk-black/75" />

        <div className="relative flex min-h-[240px] flex-col p-6 sm:min-h-[280px] sm:p-8 md:p-10">
          <div className="flex flex-1 flex-col items-start justify-center max-w-2xl">
            <div className="mb-6 sm:mb-8">
              <div className="mb-3 inline-flex items-center gap-2 sm:mb-4">
                <div className="h-px w-6 bg-primary sm:w-8" />
                <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-primary sm:text-[10px]">
                  Trade Portal
                </span>
              </div>
              <h1 className="mb-2 text-2xl font-bold tracking-tight text-white sm:text-3xl md:text-4xl">
                Welcome to ZK Sports & Entertainment
              </h1>
              <p className="text-xs text-white/70 sm:text-sm md:text-base">
                Access exclusive F1 hospitality packages and manage your bookings
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 sm:gap-2.5">
            <NavLink
              href="/packages"
              className="group inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-all duration-200 hover:border-primary/50 hover:bg-primary hover:text-white sm:gap-2 sm:px-4 sm:py-2 sm:text-sm"
            >
              <span>Packages</span>
              <ArrowRight className="h-3 w-3 opacity-60 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 sm:h-3.5 sm:w-3.5" />
            </NavLink>
            <NavLink
              href="/bookings"
              className="group inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-all duration-200 hover:border-primary/50 hover:bg-primary hover:text-white sm:gap-2 sm:px-4 sm:py-2 sm:text-sm"
            >
              <span>Bookings</span>
              <ArrowRight className="h-3 w-3 opacity-60 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 sm:h-3.5 sm:w-3.5" />
            </NavLink>
          </div>
        </div>
      </div>
    </div>
  )
}
