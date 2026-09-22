"use client"

import { useEffect, useState, useTransition } from "react"
import { Download, FileText, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { createPackageGuestGuide } from "@/app/(admin)/admin/catalog/brochure-actions"
import type { GuestGuideContent } from "@/lib/brochures/guest-guide/types"
import { guestGuideFilename } from "@/lib/brochures/text"
import { cn } from "@/lib/utils"

function guestGuideDownloadName(url: string | null, productName: string, eventName?: string | null): string {
  if (url) {
    try {
      const last = decodeURIComponent(new URL(url, "https://zk-sports.trade").pathname.split("/").pop() ?? "")
      if (last.toLowerCase().endsWith(".pdf") && last.toLowerCase() !== "guest-guide.pdf") return last
    } catch {
      /* use generated name */
    }
  }
  return guestGuideFilename(productName, eventName)
}

export function PackageGuestGuideActions({
  packageId,
  guestGuideUrl,
  productName,
  eventName,
  content,
  compact = false,
  onUrlChange,
}: {
  packageId: string
  guestGuideUrl: string | null
  productName: string
  eventName?: string | null
  content?: GuestGuideContent
  compact?: boolean
  onUrlChange?: (url: string) => void
}) {
  const [pending, start] = useTransition()
  const [liveUrl, setLiveUrl] = useState(guestGuideUrl)

  useEffect(() => {
    setLiveUrl(guestGuideUrl)
  }, [packageId, guestGuideUrl])

  const attached = Boolean(liveUrl)

  function generate() {
    const replace = attached
    if (replace) {
      const ok = window.confirm(
        "Replace the current guest guide with a new PDF from the guest guide copy and this product's photos?",
      )
      if (!ok) return
    }
    start(async () => {
      const result = await createPackageGuestGuide({ packageId, replace, content })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setLiveUrl(result.guestGuideUrl)
      onUrlChange?.(result.guestGuideUrl)
      toast.success(result.replaced ? "Guest guide updated." : "Guest guide created.", {
        description: "Open it to check the pages, then send the PDF to guests.",
        action: {
          label: "Open",
          onClick: () => {
            window.open(result.guestGuideUrl, "_blank", "noopener,noreferrer")
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
          download={guestGuideDownloadName(liveUrl, productName, eventName)}
          className={cn(
            btn,
            compact ? compactBtn : fullBtn,
            compact
              ? "flex-1 bg-slate-900 text-white"
              : "border border-border bg-background text-foreground hover:bg-muted",
          )}
        >
          <FileText className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          Download guest guide
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
        {pending ? "Designing..." : attached ? "Recreate guest guide" : "Create guest guide"}
      </button>
    </div>
  )
}
