import { Loader2 } from "lucide-react"

export function PageLoadingSpinner() {
  return (
    <div className="p-8 flex justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
    </div>
  )
}
