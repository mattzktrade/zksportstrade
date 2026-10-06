import { Suspense, type ReactNode } from "react"
import { PageLoadingSkeleton } from "@/components/page-loading-skeleton"

/** Lets the admin chrome paint immediately while the route's data streams in. */
export function AdminRouteShell({
  children,
  fallback,
}: {
  children: ReactNode
  fallback?: ReactNode
}) {
  return (
    <Suspense fallback={fallback ?? <PageLoadingSkeleton className="mx-auto max-w-[1540px] p-3 sm:p-4 lg:p-5" />}>
      {children}
    </Suspense>
  )
}
