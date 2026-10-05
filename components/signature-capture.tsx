"use client"

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react"
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad"
import { signatureScript } from "@/lib/signatures/script-font"
import { cn } from "@/lib/utils"

export type SignatureCaptureHandle = SignaturePadHandle
export type SignatureMode = "draw" | "type"

function renderTypedSignature(text: string, fontFamily: string): string {
  const value = text.replace(/\s+/g, " ").trim()
  if (value.length < 2) return ""
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")
  if (!context) return ""
  const size = 72
  const font = `${size}px ${fontFamily}, "Segoe Script", "Apple Chancery", cursive`
  context.font = font
  const width = Math.min(2000, Math.max(80, Math.ceil(context.measureText(value).width) + 48))
  const height = Math.min(220, Math.max(80, Math.round(size * 1.85)))
  canvas.width = width
  canvas.height = height
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, width, height)
  context.fillStyle = "#111827"
  context.font = font
  context.textBaseline = "alphabetic"
  context.fillText(value, 24, Math.round(height * 0.68))
  return canvas.toDataURL("image/png")
}

export function SignatureCapture({
  className,
  disabled = false,
  onHasInkChange,
  padRef,
  typedName = "",
}: {
  className?: string
  disabled?: boolean
  onHasInkChange?: (hasInk: boolean) => void
  padRef?: MutableRefObject<SignatureCaptureHandle | null>
  typedName?: string
}) {
  const drawRef = useRef<SignaturePadHandle | null>(null)
  const typedUrlRef = useRef("")
  const [mode, setMode] = useState<SignatureMode>("draw")
  const [typed, setTyped] = useState("")
  const fontFamily = signatureScript.style.fontFamily

  const reportInk = useCallback(
    (next: boolean) => {
      onHasInkChange?.(next)
    },
    [onHasInkChange],
  )

  const applyTyped = useCallback(
    (value: string) => {
      const png = renderTypedSignature(value, fontFamily)
      typedUrlRef.current = png
      reportInk(png.startsWith("data:image/png"))
      return png
    },
    [fontFamily, reportInk],
  )

  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts?.load) return
    void document.fonts.load(`72px ${fontFamily}`).then(() => {
      if (typed.trim().length >= 2) applyTyped(typed)
    })
  }, [applyTyped, fontFamily, typed])

  useEffect(() => {
    if (!padRef) return
    padRef.current = {
      clear: () => {
        typedUrlRef.current = ""
        setTyped("")
        drawRef.current?.clear()
        reportInk(false)
      },
      toDataURL: () => {
        if (mode === "type") {
          if (typedUrlRef.current.startsWith("data:image/png")) return typedUrlRef.current
          return applyTyped(typed)
        }
        return drawRef.current?.toDataURL() ?? ""
      },
      hasInk: () => {
        if (mode === "type") {
          return typedUrlRef.current.startsWith("data:image/png") || typed.trim().length >= 2
        }
        return drawRef.current?.hasInk() ?? false
      },
    }
    return () => {
      padRef.current = null
    }
  }, [applyTyped, mode, padRef, reportInk, typed])

  function choose(next: SignatureMode) {
    if (disabled || next === mode) return
    typedUrlRef.current = ""
    drawRef.current?.clear()
    reportInk(false)
    setMode(next)
    if (next === "type") {
      const value = typed.trim() || typedName.trim()
      if (value) {
        setTyped(value)
        applyTyped(value)
      }
    }
  }

  return (
    <div>
      <span className={signatureScript.className} aria-hidden="true" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
        .
      </span>
      <div className="flex items-center gap-1">
        <ModeButton active={mode === "draw"} disabled={disabled} onClick={() => choose("draw")}>
          Draw
        </ModeButton>
        <ModeButton active={mode === "type"} disabled={disabled} onClick={() => choose("type")}>
          Type
        </ModeButton>
      </div>
      {mode === "draw" ? (
        <SignaturePad
          padRef={drawRef}
          disabled={disabled}
          onHasInkChange={reportInk}
          className={className}
        />
      ) : (
        <div className={cn("rounded-lg border-2 border-dashed border-[#d9d9d9] bg-white px-3 py-3", className)}>
          <input
            value={typed}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            placeholder="Type your signature"
            onChange={(event) => {
              const value = event.target.value.slice(0, 80)
              setTyped(value)
              applyTyped(value)
            }}
            className={cn(
              "h-16 w-full border-0 bg-transparent text-[40px] leading-none outline-none",
              signatureScript.className,
            )}
          />
        </div>
      )}
    </div>
  )
}

function ModeButton({
  active,
  disabled,
  children,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "mb-2 h-8 rounded-md px-3 text-xs font-semibold",
        active ? "bg-[#18191c] text-white" : "text-[#5f636b] hover:bg-slate-100",
      )}
    >
      {children}
    </button>
  )
}
