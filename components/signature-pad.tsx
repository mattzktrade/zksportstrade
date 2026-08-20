"use client"

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent } from "react"

export type SignaturePadHandle = {
  clear: () => void
  toDataURL: () => string
  hasInk: () => boolean
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
  const drawing = useRef(false)
  const hasInkRef = useRef(false)

  const setInk = useCallback(
    (next: boolean) => {
      hasInkRef.current = next
      onHasInkChange?.(next)
    },
    [onHasInkChange],
  )

  const prepareContext = useCallback((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d")
    if (!context) return null
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.lineCap = "round"
    context.lineJoin = "round"
    context.strokeStyle = "#111827"
    const ratio = canvas.width / Math.max(canvas.getBoundingClientRect().width, 1)
    context.lineWidth = Math.max(1.75, 2.25 * ratio)
    return context
  }, [])

  const syncSize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(rect.width * ratio))
    const height = Math.max(1, Math.round(rect.height * ratio))
    if (canvas.width === width && canvas.height === height) {
      prepareContext(canvas)
      return
    }
    canvas.width = width
    canvas.height = height
    prepareContext(canvas)
    setInk(false)
  }, [prepareContext, setInk])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || disabled) return
    syncSize()
    const observer = new ResizeObserver(() => syncSize())
    observer.observe(canvas)
    window.addEventListener("resize", syncSize)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", syncSize)
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
    prepareContext(canvas)?.clearRect(0, 0, canvas.width, canvas.height)
    setInk(false)
  }, [prepareContext, setInk])

  useEffect(() => {
    if (!padRef) return
    padRef.current = {
      clear,
      toDataURL: () => canvasRef.current?.toDataURL("image/png") ?? "",
      hasInk: () => hasInkRef.current,
    }
    return () => {
      padRef.current = null
    }
  }, [clear, padRef])

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
    const context = event.currentTarget.getContext("2d")
    context?.lineTo(next.x, next.y)
    context?.stroke()
    if (!hasInkRef.current) setInk(true)
  }

  function stop(event: PointerEvent<HTMLCanvasElement>) {
    drawing.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
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
