"use client"

import { useEffect, useState, useTransition } from "react"
import { Download, FileText, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { createPackageBrochure } from "@/app/(admin)/admin/catalog/brochure-actions"
import { cn } from "@/lib/utils"

function brochureDownloadName(productName: string): string {
  const slug = productName.replaceAll(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")
  return `${slug || "package"}-brochure.pdf`
}

export function PackageBrochureActions({
  packageId,
  brochureUrl,
  productName,
  compact = false,
  onUrlChange,
}: {
  packageId: string
  brochureUrl: string | null
  productName: string
  compact?: boolean
  onUrlChange?: (url: string) => void
}) {
  const [pending, start] = useTransition()
  const [liveUrl, setLiveUrl] = useState(brochureUrl)

  useEffect(() => {
    setLiveUrl(brochureUrl)
  }, [packageId, brochureUrl])

  const attached = Boolean(liveUrl)

  function generate() {
    const replace = attached
    if (replace) {
      const ok = window.confirm(
        "Replace the current brochure with a new PDF built from this product's photos, description and inclusions?",
      )
      if (!ok) return
    }
    start(async () => {
      const result = await createPackageBrochure({ packageId, replace })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setLiveUrl(result.brochureUrl)
      onUrlChange?.(result.brochureUrl)
      toast.success(result.replaced ? "Brochure updated." : "Brochure created.", {
        description: "Open it to check the layout, then send the PDF to the client.",
        action: {
          label: "Open",
          onClick: () => {
            window.open(result.brochureUrl, "_blank", "noopener,noreferrer")
          },
        },
      })
    })
  }

  const btn =
    "inline-flex items-center justify-center gap-1.5 font-semibold disabled:opacity-50 disabled:pointer-events-none"
  const compactBtn = "h-8 rounded-md px-2.5 text-[8px]"
  const fullBtn = "h-9 rounded-lg px-3 text-sm"

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      {liveUrl ? (
        <a
          href={liveUrl}
          target="_blank"
          rel="noreferrer"
          download={brochureDownloadName(productName)}
          className={cn(
            btn,
            compact ? compactBtn : fullBtn,
            compact
              ? "flex-1 bg-slate-900 text-white"
              : "border border-border bg-background text-foreground hover:bg-muted",
          )}
        >
          <FileText className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          Download brochure
          <Download className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
        </a>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={generate}
        className={cn(
          btn,
          compact ? compactBtn : fullBtn,
          attached
            ? compact
              ? "flex-1 border border-slate-200 bg-white text-slate-700"
              : "border border-border text-foreground hover:bg-muted"
            : "bg-primary text-primary-foreground",
          compact && !attached ? "flex-1" : "",
        )}
      >
        {pending ? (
          <Loader2 className={cn("animate-spin", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
        ) : (
          <Sparkles className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        )}
        {pending ? "Designing..." : attached ? "Recreate brochure" : "Create brochure"}
      </button>
    </div>
  )
}
