"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { setPackageHidden } from "@/app/(admin)/actions"
import { cn } from "@/lib/utils"

/** Checkbox: ticked = hidden from agent portal. */
export function PackagePortalVisibilityCheckbox({
  packageId,
  isHidden: initialHidden,
  className,
  onClickStopPropagation = true,
}: {
  packageId: string
  isHidden: boolean
  className?: string
  onClickStopPropagation?: boolean
}) {
  const router = useRouter()
  const [hidden, setHidden] = useState(initialHidden)
  const [pending, start] = useTransition()

  useEffect(() => {
    setHidden(initialHidden)
  }, [initialHidden, packageId])

  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none",
        pending && "opacity-60",
        className,
      )}
      onClick={onClickStopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      <input
        type="checkbox"
        checked={hidden}
        disabled={pending}
        className="h-4 w-4 rounded border-border"
        onChange={(e) => {
          const next = e.target.checked
          setHidden(next)
          start(async () => {
            const res = await setPackageHidden(packageId, next)
            if (!res.ok) {
              setHidden(!next)
              toast.error(res.message)
              return
            }
            toast.success(next ? "Hidden from portal" : "Visible on portal")
            router.refresh()
          })
        }}
      />
      <span>Hidden on portal</span>
    </label>
  )
}
