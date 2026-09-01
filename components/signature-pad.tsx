"use client"

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent } from "react"
import { paddedInkRect, signatureInkBounds } from "@/lib/booking-forms/signature-ink"

export type SignaturePadHandle = {
  clear: () => void
  toDataURL: () => string
  hasInk: () => boolean
}

function canvasContext(canvas: HTMLCanvasElement) {
  return canvas.getContext("2d", { willReadFrequently: true })
}

function exportCroppedPng(source: HTMLCanvasElement): string {
  const context = canvasContext(source)
  if (!context || source.width < 1 || source.height < 1) return ""
  let imageData: ImageData
  try {
    imageData = context.getImageData(0, 0, source.width, source.height)
  } catch {
    return source.toDataURL("image/png")
  }
  const bounds = signatureInkBounds(imageData.data, source.width, source.height)
  if (!bounds) return ""
  const crop = paddedInkRect(bounds, source.width, source.height)
  const out = document.createElement("canvas")
  out.width = crop.width
  out.height = crop.height
  const output = canvasContext(out)
  if (!output) return source.toDataURL("image/png")
  output.fillStyle = "#ffffff"
  output.fillRect(0, 0, crop.width, crop.height)
  output.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  )
  return out.toDataURL("image/png")
}

export function SignaturePad({
  className,
  disabled = false,
  onHasInkChange,
  padRef,
}: {
  className?: string
  disabled?: boolean
  onHasInkChange?: (hasInk: boolean) => void
  padRef?: MutableRefObject<SignaturePadHandle | null>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const backupRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const hasInkRef = useRef(false)

  const setInk = useCallback(
    (next: boolean) => {
      hasInkRef.current = next
      if (!next) backupRef.current = null
      onHasInkChange?.(next)
    },
    [onHasInkChange],
  )

  const prepareContext = useCallback((canvas: HTMLCanvasElement) => {
    const context = canvasContext(canvas)
    if (!context) return null
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.lineCap = "round"
    context.lineJoin = "round"
    context.strokeStyle = "#111827"
    const ratio = canvas.width / Math.max(canvas.getBoundingClientRect().width, 1)
    context.lineWidth = Math.max(1.75, 2.25 * ratio)
    return context
  }, [])

  const fillWhite = useCallback((canvas: HTMLCanvasElement) => {
    const context = prepareContext(canvas)
    if (!context) return null
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = "#111827"
    return context
  }, [prepareContext])

  const saveBackup = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !hasInkRef.current) return
    const backup = backupRef.current ?? document.createElement("canvas")
    backup.width = canvas.width
    backup.height = canvas.height
    canvasContext(backup)?.drawImage(canvas, 0, 0)
    backupRef.current = backup
  }, [])

  const restoreBackup = useCallback(
    (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => {
      const backup = backupRef.current
      if (!backup || backup.width < 1 || backup.height < 1) return
      context.drawImage(backup, 0, 0, canvas.width, canvas.height)
    },
    [],
  )

  const syncSize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(rect.width * ratio))
    const height = Math.max(1, Math.round(rect.height * ratio))
    if (canvas.width === width && canvas.height === height) {
      return
    }
    if (hasInkRef.current) saveBackup()
    drawing.current = false
    canvas.width = width
    canvas.height = height
    const context = fillWhite(canvas)
    if (!context) return
    if (hasInkRef.current) restoreBackup(canvas, context)
    prepareContext(canvas)
  }, [fillWhite, prepareContext, restoreBackup, saveBackup])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || disabled) return
    syncSize()
    const observer = new ResizeObserver(() => syncSize())
    observer.observe(canvas)
    window.addEventListener("resize", syncSize)
    const visualViewport = window.visualViewport
    visualViewport?.addEventListener("resize", syncSize)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", syncSize)
      visualViewport?.removeEventListener("resize", syncSize)
    }
  }, [disabled, syncSize])

  const point = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / Math.max(rect.width, 1)
    const scaleY = canvas.height / Math.max(rect.height, 1)
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    }
  }, [])

  const clear = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    fillWhite(canvas)
    setInk(false)
  }, [fillWhite, setInk])

  const exportPng = useCallback(() => {
    const canvas = canvasRef.current
    if (canvas && hasInkRef.current) {
      const live = exportCroppedPng(canvas)
      if (live) return live
    }
    if (backupRef.current) return exportCroppedPng(backupRef.current)
    return ""
  }, [])

  useEffect(() => {
    if (!padRef) return
    padRef.current = {
      clear,
      toDataURL: exportPng,
      hasInk: () => hasInkRef.current,
    }
    return () => {
      padRef.current = null
    }
  }, [clear, exportPng, padRef])

  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const next = point(event)
    const context = prepareContext(event.currentTarget)
    context?.beginPath()
    context?.moveTo(next.x, next.y)
    drawing.current = true
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled || !drawing.current) return
    const next = point(event)
    const context = canvasContext(event.currentTarget)
    context?.lineTo(next.x, next.y)
    context?.stroke()
    if (!hasInkRef.current) setInk(true)
  }

  function stop(event: PointerEvent<HTMLCanvasElement>) {
    drawing.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (hasInkRef.current) saveBackup()
  }

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={stop}
      onPointerCancel={stop}
      className={className}
      style={{ touchAction: "none" }}
      aria-label="Signature"
    />
  )
}
