"use client"

import { useRef, useTransition } from "react"
import { ImagePlus } from "lucide-react"
import { toast } from "sonner"
import { prepareCatalogImageUpload } from "@/app/(admin)/admin/catalog/catalog-image-actions"
import { CATALOG_IMAGE_MAX_BYTES } from "@/lib/catalog/catalog-image-upload"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

function isUnusableImageUrl(url: string): boolean {
  const value = url.trim().toLowerCase()
  if (!value) return false
  return (
    value.includes("chatgpt.com") ||
    value.includes("oaidalle") ||
    value.startsWith("blob:") ||
    value.startsWith("data:")
  )
}

export function CatalogImageField({
  value,
  onChange,
  label = "Event image",
  className,
}: {
  value: string
  onChange: (url: string) => void
  label?: string
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, start] = useTransition()
  const preview = value.trim()
  const unusable = isUnusableImageUrl(value)

  function pickFile(file: File | undefined) {
    if (!file) return
    if (file.size > CATALOG_IMAGE_MAX_BYTES) {
      toast.error("Image must be 8MB or smaller.")
      return
    }
    start(async () => {
      try {
        const prepared = await prepareCatalogImageUpload({
          fileName: file.name,
          contentType: file.type,
          size: file.size,
        })
        if (!prepared.ok) {
          toast.error(prepared.message)
          return
        }
        const supabase = createClient()
        const { error } = await supabase.storage
          .from(prepared.bucket)
          .uploadToSignedUrl(prepared.path, prepared.token, file, {
            contentType: prepared.contentType,
            cacheControl: "31536000",
          })
        if (error) {
          toast.error(error.message || "Image upload failed.")
          return
        }
        onChange(prepared.url)
        toast.success("Image uploaded.")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Image upload failed.")
      }
    })
  }

  return (
    <div className={cn("text-sm", className)}>
      <span className="mb-1.5 block font-medium text-slate-700">{label}</span>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div
          className="h-20 w-28 shrink-0 overflow-hidden rounded-md border bg-slate-50 bg-cover bg-center"
          style={preview && !unusable ? { backgroundImage: `url("${preview.replaceAll('"', "%22")}")` } : undefined}
        >
          {!preview || unusable ? (
            <div className="flex h-full items-center justify-center text-[10px] text-slate-400">No image</div>
          ) : null}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
            className="sr-only"
            onChange={(event) => {
              pickFile(event.target.files?.[0])
              event.target.value = ""
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="inline-flex h-10 items-center gap-1.5 rounded-md border bg-white px-3 text-sm font-medium disabled:opacity-50"
            >
              <ImagePlus className="h-4 w-4" />
              {uploading ? "Uploading…" : "Upload image"}
            </button>
            {preview ? (
              <button
                type="button"
                disabled={uploading}
                onClick={() => onChange("")}
                className="h-10 text-sm text-slate-500 hover:text-slate-800 disabled:opacity-50"
              >
                Remove
              </button>
            ) : null}
          </div>
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="or paste an https image URL"
            className="h-10 w-full rounded-md border bg-white px-3 text-sm outline-none focus:border-primary/50"
          />
          {unusable ? (
            <p className="text-xs text-amber-700">
              ChatGPT and similar links expire and will not display. Upload the file instead.
            </p>
          ) : (
            <p className="text-xs text-slate-500">JPG, PNG, WebP or GIF, up to 8MB.</p>
          )}
        </div>
      </div>
    </div>
  )
}
