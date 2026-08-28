import { PageLoadingSkeleton } from "@/components/page-loading-skeleton"

export default function BookingsLoading() {
  return <PageLoadingSkeleton className="p-6 lg:p-8" rows={6} />
}
