"use client"

import { useState } from "react"
import { toast } from "sonner"
import { formatPackageCopy } from "@/lib/catalog/format-package-copy"

export function PackageCopyFields({
  description,
  includesText,
  onDescriptionChange,
  onIncludesChange,
  descriptionLabel = "Description (portal)",
}: {
  description: string
  includesText: string
  onDescriptionChange: (value: string) => void
  onIncludesChange: (value: string) => void
  descriptionLabel?: string
}) {
  const [rawCopy, setRawCopy] = useState("")

  function formatCopy() {
    const formatted = formatPackageCopy(rawCopy)
    if (!formatted.description && formatted.includes.length === 0) {
      toast.error("Paste the supplier or website copy first.")
      return
    }
    const replacing = description.trim().length > 0 || includesText.trim().length > 0
    if (replacing && !window.confirm("Replace the description and package inclusions with this formatted copy?")) {
      return
    }
    if (formatted.description) onDescriptionChange(formatted.description)
    if (formatted.includes.length > 0) onIncludesChange(formatted.includes.join("\n"))
    toast.success("Description and inclusions updated.")
  }

  return (
    <>
      <div className="sm:col-span-2 space-y-2 rounded-xl border border-border bg-muted/20 p-4">
        <label className="block text-xs text-muted-foreground">
          Raw copy
          <textarea
            value={rawCopy}
            onChange={(e) => setRawCopy(e.target.value)}
            placeholder="Paste the supplier or website text here."
            className="mt-1.5 w-full min-h-[140px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={formatCopy}
            className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm font-medium hover:bg-muted"
          >
            Format description and inclusions
          </button>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Keeps the details, drops repeated lines, and fills the boxes below. You can still edit them before saving.
          </p>
        </div>
      </div>
      <label className="block text-xs text-muted-foreground sm:col-span-2">
        {descriptionLabel}
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          className="mt-1.5 w-full min-h-[100px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
        />
      </label>
      <label className="block text-xs text-muted-foreground sm:col-span-2">
        Package includes (one bullet per line)
        <textarea
          value={includesText}
          onChange={(e) => onIncludesChange(e.target.value)}
          className="mt-1.5 w-full min-h-[100px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
        />
      </label>
    </>
  )
}
