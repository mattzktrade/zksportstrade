import { PageLoadingSkeleton } from "@/components/page-loading-skeleton"

export default function InvoicesLoading() {
  return <PageLoadingSkeleton className="p-6 lg:p-8" rows={6} />
}
