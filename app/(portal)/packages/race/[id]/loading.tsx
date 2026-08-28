export default function RacePackagesLoading() {
  return (
    <div className="p-6 lg:p-8 space-y-6 animate-pulse">
      <div className="h-10 w-64 rounded-lg bg-muted" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="aspect-[4/3] rounded-2xl bg-muted" />
        ))}
      </div>
    </div>
  )
}
