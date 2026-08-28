import { cn } from "@/lib/utils"

export function PageLoadingSkeleton({
  className,
  rows = 8,
}: {
  className?: string
  rows?: number
}) {
  return (
    <div className={cn("space-y-4 animate-pulse", className)}>
      <div className="h-8 w-48 rounded-lg bg-muted" />
      <div className="h-10 max-w-md rounded-xl bg-muted" />
      <div className="overflow-hidden rounded-2xl border border-border">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="h-14 border-b border-border bg-muted/40 last:border-b-0" />
        ))}
      </div>
    </div>
  )
}
