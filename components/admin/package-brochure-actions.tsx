"use client"

import { useEffect, useState, useTransition } from "react"
import { Download, FileText, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { createPackageBrochure } from "@/app/(admin)/admin/catalog/brochure-actions"
import { cn } from "@/lib/utils"
import { brochureFilename, zkBrochureFilename } from "@/lib/brochures/text"

function pdfDownloadName(
  url: string | null,
  fallback: string,
  skipNames: string[],
): string {
  if (url) {
    try {
      const last = decodeURIComponent(new URL(url, "https://zk-sports.trade").pathname.split("/").pop() ?? "")
      if (last.toLowerCase().endsWith(".pdf") && !skipNames.includes(last.toLowerCase())) return last
    } catch {
      /* use generated name */
    }
  }
  return fallback
}

export function PackageBrochureActions({
  packageId,
  brochureUrl,
  zkBrochureUrl,
  productName,
  eventName,
  compact = false,
  downloadOnly = false,
  onUrlChange,
}: {
  packageId: string
  brochureUrl: string | null
  zkBrochureUrl?: string | null
  productName: string
  eventName?: string | null
  compact?: boolean
  /** List preview can download an existing file. Recreate stays on the product page when both files exist. */
  downloadOnly?: boolean
  onUrlChange?: (urls: { brochureUrl: string; zkBrochureUrl: string }) => void
}) {
  const [pending, start] = useTransition()
  const [liveUrl, setLiveUrl] = useState(brochureUrl)
  const [liveZkUrl, setLiveZkUrl] = useState(zkBrochureUrl ?? null)

  useEffect(() => {
    setLiveUrl(brochureUrl)
    setLiveZkUrl(zkBrochureUrl ?? null)
  }, [packageId, brochureUrl, zkBrochureUrl])

  const attached = Boolean(liveUrl || liveZkUrl)
  const bothReady = Boolean(liveUrl && liveZkUrl)

  function generate() {
    const replace = attached
    if (replace) {
      const ok = window.confirm(
        "Replace the current brochures with a new white-label PDF for agents and a ZK branded PDF with our closing page?",
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
      setLiveZkUrl(result.zkBrochureUrl)
      onUrlChange?.({ brochureUrl: result.brochureUrl, zkBrochureUrl: result.zkBrochureUrl })
      toast.success(result.replaced ? "Brochures updated." : "Brochures created.", {
        description: "White-label is for agents. ZK branded includes our contact page.",
        action: {
          label: "Open ZK branded",
          onClick: () => {
            window.open(result.zkBrochureUrl, "_blank", "noopener,noreferrer")
          },
        },
      })
    })
  }

  const btn =
    "inline-flex items-center justify-center gap-1.5 font-semibold disabled:opacity-50 disabled:pointer-events-none"
  const compactBtn = "h-9 w-full rounded-md px-2.5 text-[9px]"
  const fullBtn = "h-9 rounded-lg px-3 text-sm"

  const whiteName = pdfDownloadName(liveUrl, brochureFilename(productName, eventName), [
    "brochure.pdf",
  ])
  const zkName = pdfDownloadName(liveZkUrl, zkBrochureFilename(productName, eventName), [
    "brochure.pdf",
    "zk-brochure.pdf",
  ])

  return (
    <div className={cn("flex w-full gap-2", compact ? "flex-col" : "flex-wrap items-center")}>
      {liveUrl ? (
        <a
          href={liveUrl}
          target="_blank"
          rel="noreferrer"
          download={whiteName}
          title="White-label brochure for agents — no ZK branding"
          aria-label="Download white-label brochure for agents"
          className={cn(
            btn,
            compact ? compactBtn : fullBtn,
            "bg-slate-900 text-white hover:bg-slate-800",
          )}
        >
          <FileText className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          White-label
          <Download className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
        </a>
      ) : null}
      {liveZkUrl ? (
        <a
          href={liveZkUrl}
          target="_blank"
          rel="noreferrer"
          download={zkName}
          title="ZK branded brochure — includes our logo and Oliver's details"
          aria-label="Download ZK branded brochure"
          className={cn(
            btn,
            compact ? compactBtn : fullBtn,
            "bg-red-700 text-white hover:bg-red-800",
          )}
        >
          <FileText className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          ZK branded
          <Download className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
        </a>
      ) : null}
      {downloadOnly && bothReady ? null : (
        <button
          type="button"
          disabled={pending}
          onClick={generate}
          className={cn(
            btn,
            compact ? compactBtn : fullBtn,
            attached
              ? compact
                ? "border border-slate-200 bg-white text-slate-700"
                : "border border-border text-foreground hover:bg-muted"
              : "bg-primary text-primary-foreground",
          )}
        >
          {pending ? (
            <Loader2 className={cn("animate-spin", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
          ) : (
            <Sparkles className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          )}
          {pending ? "Designing..." : attached ? "Recreate brochures" : "Create brochures"}
        </button>
      )}
      {compact ? (
        <p className="text-[8px] leading-4 text-[#93979f]">
          {bothReady
            ? "White-label is for agents. ZK branded includes our logo and Oliver's details."
            : "Creates a white-label PDF for agents and a ZK branded PDF with our contact page."}
        </p>
      ) : null}
    </div>
  )
}
