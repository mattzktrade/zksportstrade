"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  loadCheckInEvents,
  loadCheckInGuests,
  scanCheckInTicket,
  undoCheckIn,
  type CheckInEventOption,
  type CheckInGuest,
  type CheckInScanResult,
} from "./actions"

const QUEUE_KEY = "zk-checkin-queue"
const GUESTS_CACHE_PREFIX = "zk-checkin-guests:"

type QueuedScan = { raw: string; raceId: string; todayIso: string; queuedAt: string }

function guestsCacheKey(raceId: string, eventDate: string | null | undefined) {
  return `${GUESTS_CACHE_PREFIX}${raceId}|${eventDate ?? ""}`
}

function readGuestCache(raceId: string, eventDate: string | null | undefined): CheckInGuest[] {
  try {
    const raw = window.localStorage.getItem(guestsCacheKey(raceId, eventDate))
    return raw ? (JSON.parse(raw) as CheckInGuest[]) : []
  } catch {
    return []
  }
}

function writeGuestCache(raceId: string, eventDate: string | null | undefined, guests: CheckInGuest[]) {
  window.localStorage.setItem(guestsCacheKey(raceId, eventDate), JSON.stringify(guests))
}

function playScanTone(code: CheckInScanResult["code"]) {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = code === "ok" ? 880 : code === "already_arrived" ? 440 : 220
    gain.gain.value = 0.08
    osc.start()
    osc.stop(ctx.currentTime + 0.18)
    void ctx.resume()
  } catch {
    /* phones without Web Audio still show the colour result */
  }
}

function readQueue(): QueuedScan[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY)
    return raw ? (JSON.parse(raw) as QueuedScan[]) : []
  } catch {
    return []
  }
}

function writeQueue(items: QueuedScan[]) {
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(items))
}

function toneFor(code: CheckInScanResult["code"]): string {
  if (code === "ok") return "bg-emerald-600"
  if (code === "already_arrived") return "bg-amber-500"
  if (code === "wrong_day" || code === "too_early") return "bg-amber-600"
  return "bg-red-600"
}

export function CheckInClient({ canScan }: { canScan: boolean }) {
  const [pending, start] = useTransition()
  const [events, setEvents] = useState<CheckInEventOption[]>([])
  const [eventKey, setEventKey] = useState("")
  const [todayIso, setTodayIso] = useState(() => new Date().toISOString().slice(0, 10))
  const [guests, setGuests] = useState<CheckInGuest[]>([])
  const [search, setSearch] = useState("")
  const [result, setResult] = useState<CheckInScanResult | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [offlineCount, setOfflineCount] = useState(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const selected = useMemo(() => events.find((event) => `${event.raceId}|${event.eventDate ?? ""}` === eventKey), [events, eventKey])

  function refreshEvents() {
    start(async () => {
      const loaded = await loadCheckInEvents()
      if (!loaded.ok) {
        toast.error(loaded.message)
        return
      }
      setEvents(loaded.events)
      if (!eventKey && loaded.events[0]) {
        setEventKey(`${loaded.events[0].raceId}|${loaded.events[0].eventDate ?? ""}`)
      }
    })
  }

  function refreshGuests(key = eventKey) {
    const event = events.find((row) => `${row.raceId}|${row.eventDate ?? ""}` === key) ?? selected
    if (!event) return
    const cached = readGuestCache(event.raceId, event.eventDate)
    setGuests(cached)
    start(async () => {
      try {
        const loaded = await loadCheckInGuests({ raceId: event.raceId, eventDate: event.eventDate })
        if (!loaded.ok) {
          if (cached.length) {
            setGuests(cached)
            toast.message("Showing the list saved on this phone.")
            return
          }
          toast.error(loaded.message)
          return
        }
        setGuests(loaded.guests)
        writeGuestCache(event.raceId, event.eventDate, loaded.guests)
      } catch {
        if (cached.length) setGuests(cached)
      }
    })
  }

  useEffect(() => {
    refreshEvents()
    setOfflineCount(readQueue().length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (eventKey) refreshGuests(eventKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventKey])

  async function handleScan(raw: string, method: "qr" | "short_code" | "manual" | "offline" = "qr") {
    if (!canScan) {
      toast.error("You can view the list, but scanning needs operations manage access.")
      return
    }
    const raceId = selected?.raceId ?? ""
    if (!navigator.onLine) {
      const queue = readQueue()
      queue.push({ raw, raceId, todayIso, queuedAt: new Date().toISOString() })
      writeQueue(queue)
      setOfflineCount(queue.length)
      toast.message("No signal — scan queued on this phone.")
      return
    }
    const scanned = await scanCheckInTicket({
      raw,
      raceId,
      todayIso,
      method,
    })
    if (!scanned.ok) {
      toast.error(scanned.message)
      return
    }
    setResult(scanned.result)
    playScanTone(scanned.result.code)
    refreshGuests()
    refreshEvents()
  }

  async function flushQueue() {
    const queue = readQueue()
    if (!queue.length) return
    const leftover: QueuedScan[] = []
    for (const item of queue) {
      const scanned = await scanCheckInTicket({
        raw: item.raw,
        raceId: item.raceId,
        todayIso: item.todayIso,
        method: "offline",
        offlineQueuedAt: item.queuedAt,
      })
      if (!scanned.ok || scanned.result.code === "invalid") leftover.push(item)
    }
    writeQueue(leftover)
    setOfflineCount(leftover.length)
    if (leftover.length) toast.error("Some offline scans still need review.")
    else toast.success("Offline scans synced.")
    refreshGuests()
  }

  useEffect(() => {
    function onOnline() {
      void flushQueue()
    }
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
  })

  useEffect(() => {
    if (!cameraOn) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        const Detector = window.BarcodeDetector
        if (!Detector) return
        const detector = new Detector({ formats: ["qr_code"] })
        const tick = async () => {
          if (cancelled || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            const value = codes[0]?.rawValue
            if (value) {
              await handleScan(value, "qr")
              await new Promise((resolve) => setTimeout(resolve, 1200))
            }
          } catch {
            /* keep scanning */
          }
          if (!cancelled) requestAnimationFrame(() => void tick())
        }
        void tick()
      } catch {
        toast.error("Camera permission is needed to scan. You can still type the short code.")
        setCameraOn(false)
      }
    })()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn, eventKey, todayIso])

  const filtered = guests.filter((guest) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return `${guest.guestName} ${guest.shortCode}`.toLowerCase().includes(q)
  })

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-16">
      <div>
        <h1 className="text-xl font-semibold">Check-in</h1>
        <p className="mt-1 text-sm text-slate-500">Scan the ZK QR or search the guest name. The photo is the check, not the screenshot.</p>
      </div>

      <label className="block text-[11px] font-medium text-slate-600">
        Event
        <select
          value={eventKey}
          onChange={(event) => setEventKey(event.target.value)}
          className="mt-1 h-11 w-full rounded-lg border bg-white px-3 text-sm"
        >
          {events.length === 0 ? <option value="">No tickets issued yet</option> : null}
          {events.map((event) => (
            <option key={`${event.raceId}|${event.eventDate ?? ""}`} value={`${event.raceId}|${event.eventDate ?? ""}`}>
              {event.label} · {event.arrived} in · {event.remaining} left
            </option>
          ))}
        </select>
      </label>

      <label className="block text-[11px] font-medium text-slate-600">
        Door date
        <input
          type="date"
          value={todayIso}
          onChange={(event) => setTodayIso(event.target.value)}
          className="mt-1 h-11 w-full rounded-lg border bg-white px-3 text-sm"
        />
      </label>

      <button
        type="button"
        onClick={() => setCameraOn((value) => !value)}
        className="h-12 w-full rounded-xl bg-primary text-sm font-semibold text-white"
      >
        {cameraOn ? "Stop camera" : "Scan QR"}
      </button>

      {cameraOn ? (
        <video ref={videoRef} autoPlay playsInline muted className="aspect-[3/4] w-full rounded-xl bg-black object-cover" />
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          const raw = String(data.get("code") ?? "")
          if (raw.trim()) void handleScan(raw.trim(), "short_code")
          event.currentTarget.reset()
        }}
        className="flex gap-2"
      >
        <input name="code" placeholder="ZK-ABC123 or paste QR text" className="h-11 flex-1 rounded-lg border px-3 text-sm" />
        <button type="submit" className="h-11 rounded-lg border px-4 text-sm font-semibold">
          Go
        </button>
      </form>

      {offlineCount > 0 ? (
        <button type="button" onClick={() => void flushQueue()} className="text-sm font-semibold text-primary">
          Sync {offlineCount} offline scan{offlineCount === 1 ? "" : "s"}
        </button>
      ) : null}

      {result ? (
        <div className={`rounded-2xl p-5 text-white ${toneFor(result.code)}`}>
          <p className="text-xs font-semibold uppercase tracking-wide">{result.code.replace("_", " ")}</p>
          <p className="mt-1 text-2xl font-bold">{result.guestName || result.message}</p>
          <p className="mt-1 text-sm">{result.message}</p>
          {result.headshotUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={result.headshotUrl} alt="" className="mt-3 h-28 w-28 rounded-full object-cover ring-4 ring-white/40" />
          ) : null}
          <p className="mt-3 text-sm">{result.daysLabel}</p>
          {result.tableNumber ? <p className="text-sm">Table {result.tableNumber}</p> : null}
          {result.dietary ? <p className="text-sm">Dietary: {result.dietary}</p> : null}
          {result.ticketId && result.code === "ok" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const reason = window.prompt("Undo reason") ?? ""
                if (!reason.trim()) return
                start(async () => {
                  const undone = await undoCheckIn({ ticketId: result.ticketId!, reason })
                  if (!undone.ok) toast.error(undone.message)
                  else {
                    toast.success(undone.message)
                    setResult(null)
                    refreshGuests()
                  }
                })
              }}
              className="mt-4 text-sm font-semibold underline"
            >
              Undo this scan
            </button>
          ) : null}
        </div>
      ) : null}

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search name"
        className="h-11 w-full rounded-lg border px-3 text-sm"
      />

      <ul className="divide-y rounded-xl border bg-white">
        {filtered.map((guest) => (
          <li key={guest.ticketId} className="flex items-center gap-3 px-3 py-2">
            {guest.headshotUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={guest.headshotUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <span className="h-10 w-10 rounded-full bg-slate-200" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{guest.guestName}</p>
              <p className="text-[11px] text-slate-500">
                {guest.shortCode} · {guest.status}
                {guest.tableNumber ? ` · Table ${guest.tableNumber}` : ""}
              </p>
            </div>
            {canScan && guest.status !== "arrived" ? (
              <button
                type="button"
                className="text-[11px] font-semibold text-primary"
                onClick={() => void handleScan(guest.ticketId, "manual")}
              >
                Check in
              </button>
            ) : null}
          </li>
        ))}
        {filtered.length === 0 ? <li className="px-3 py-6 text-center text-sm text-slate-400">No guests on this list.</li> : null}
      </ul>
    </div>
  )
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>
    }
  }
}
