export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-[1540px] space-y-3 p-3 sm:p-4 lg:p-5 animate-pulse">
      <div className="h-8 w-48 rounded-md bg-muted" />
      <div className="h-10 max-w-md rounded-md bg-muted" />
      <div className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-12 border-b border-[#f0f1f3] bg-muted/40 last:border-b-0" />
        ))}
      </div>
    </div>
  )
}
