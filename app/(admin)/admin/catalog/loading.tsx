export default function AdminCatalogLoading() {
  return (
    <div className="p-6 lg:p-8 max-w-[1400px] space-y-6 animate-pulse">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="space-y-2">
          <div className="h-8 w-40 rounded-lg bg-muted" />
          <div className="h-4 w-96 max-w-full rounded bg-muted" />
        </div>
        <div className="flex gap-2">
          <div className="h-10 w-36 rounded-lg bg-muted" />
          <div className="h-10 w-40 rounded-lg bg-muted" />
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="h-10 rounded-lg bg-muted" />
        <div className="flex flex-wrap gap-3">
          <div className="h-10 flex-1 min-w-[150px] rounded-lg bg-muted" />
          <div className="h-10 flex-1 min-w-[150px] rounded-lg bg-muted" />
          <div className="h-10 flex-1 min-w-[150px] rounded-lg bg-muted" />
        </div>
      </div>
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
            {[1, 2, 3, 4].map((j) => (
              <div key={j} className="h-14 bg-muted/30" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
