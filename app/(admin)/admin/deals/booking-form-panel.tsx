"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  CheckCircle2,
  Copy,
  Download,
  FileSignature,
  Mail,
  PenLine,
  RotateCcw,
  X,
} from "lucide-react"
import { toast } from "sonner"
import {
  createAndSendNativeBookingForm,
  getNativeBookingFormDownloadUrl,
  getNativeBookingFormSigningUrl,
  notifyNativeBookingFormReady,
  resendNativeBookingForm,
  saveNativeBookingFormDraft,
  sendSavedNativeBookingForm,
  signNativeBookingFormAsAdmin,
  voidNativeBookingForm,
} from "./booking-form-actions"
import { BookingFormEditor, BodyPortal } from "./booking-form-editor"
import type {
  BookingFormAdminRow,
  BookingFormEventRow,
} from "@/lib/booking-forms/types"
import type { BookingFormEdits, BookingFormSendMode } from "@/lib/booking-forms/edits"
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad"
import { BOOKING_SIGNATURE_CONSENT } from "@/lib/booking-forms/template"

const STATUS_LABELS: Record<BookingFormAdminRow["status"], string> = {
  draft: "Ready to send",
  sent: "Sent",
  viewed: "Viewed",
  awaiting_zk_signature: "Client signed — ZK signature required",
  zk_signed: "Generating final document",
  completed: "Completed",
  declined: "Declined",
  expired: "Expired",
  voided: "Voided",
  failed: "Failed",
}

function dateTime(value: string | null): string {
  if (!value) return "—"
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function AdminSignatureModal({
  form,
  defaultName,
  onClose,
}: {
  form: BookingFormAdminRow
  defaultName: string
  onClose: () => void
}) {
  const router = useRouter()
  const padRef = useRef<SignaturePadHandle | null>(null)
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [name, setName] = useState(defaultName)
  const [consent, setConsent] = useState(false)
  const [hasInk, setHasInk] = useState(false)

  async function submit() {
    if (inFlight.current) return
    if (!name.trim()) return toast.error("Enter the admin signer's full name.")
    const signatureDataUrl = padRef.current?.toDataURL() ?? ""
    if (!hasInk || !padRef.current?.hasInk() || !signatureDataUrl.startsWith("data:image/png")) {
      return toast.error("Draw the admin signature.")
    }
    if (!consent) return toast.error("Confirm the electronic signature consent.")
    inFlight.current = true
    setPending(true)
    try {
      const result = await signNativeBookingFormAsAdmin({
        bookingFormId: form.id,
        signerName: name.trim(),
        signatureDataUrl,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      onClose()
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not complete the agreement.")
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <BodyPortal>
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" data-escape-close="" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">ZK countersignature</h2>
            <p className="mt-1 text-sm text-slate-500">{form.document_ref} · client signature recorded</p>
          </div>
          <button type="button" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-5 rounded-lg bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          Review the PDF before signing. Completing this step locks the final agreement and advances
          the deal to Signed.
        </div>
        <label className="mt-5 block text-sm font-semibold">
          Admin full name
          <input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 h-11 w-full rounded-md border px-3" />
        </label>
        <div className="mt-5 flex items-center justify-between">
          <span className="text-sm font-semibold">Draw signature</span>
          <button type="button" onClick={() => padRef.current?.clear()} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500">
            <RotateCcw className="h-4 w-4" /> Clear
          </button>
        </div>
        <SignaturePad
          padRef={padRef}
          onHasInkChange={setHasInk}
          className="mt-2 h-40 w-full rounded-lg border-2 border-dashed border-slate-300"
        />
        <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-slate-600">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 accent-[#F90202]" />
          <span>{BOOKING_SIGNATURE_CONSENT}</span>
        </label>
        <button type="button" disabled={pending} onClick={submit} className="mt-5 h-11 w-full rounded-md bg-[#010101] font-bold text-white disabled:opacity-50">
          {pending ? "Completing agreement…" : "Sign and complete agreement"}
        </button>
      </div>
    </div>
    </BodyPortal>
  )
}

export function BookingFormPanel({
  dealId,
  dealClosed,
  form,
  events,
  currentIsAdmin,
  currentCanManageDeals,
  currentProfileName,
  orderAlreadyConfirmed = false,
  confirmedOffPlatform = false,
}: {
  dealId: string
  dealClosed: boolean
  form: BookingFormAdminRow | null
  events: BookingFormEventRow[]
  currentIsAdmin: boolean
  currentCanManageDeals: boolean
  currentProfileName: string
  orderAlreadyConfirmed?: boolean
  confirmedOffPlatform?: boolean
}) {
  const router = useRouter()
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [showSignature, setShowSignature] = useState(false)
  const [editorMode, setEditorMode] = useState<"create" | "edit" | "reissue" | null>(null)
  const [localPreviewUrl, setLocalPreviewUrl] = useState("")

  async function run(
    action: () => Promise<{ ok: boolean; message: string; previewUrl?: string }>,
    onSuccess?: () => void,
  ) {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    try {
      const result = await action()
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      if (result.previewUrl) {
        setLocalPreviewUrl(result.previewUrl)
      }
      onSuccess?.()
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the booking form.")
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  async function download() {
    if (!form) return
    const result = await getNativeBookingFormDownloadUrl(form.id)
    if (!result.ok) return toast.error(result.message)
    window.open(result.url, "_blank", "noopener,noreferrer")
  }

  async function copySigningLink() {
    const copy = async (url: string, rotated = false) => {
      try {
        await navigator.clipboard.writeText(url)
        toast.success(
          rotated
            ? "A new signing link was copied. The previous emailed link will no longer work."
            : "Signing link copied. You can send it on WhatsApp.",
        )
      } catch {
        toast.error("Could not copy the signing link.")
      }
    }
    if (localPreviewUrl) {
      await copy(localPreviewUrl)
      return
    }
    if (!form) return
    const result = await getNativeBookingFormSigningUrl(form.id)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    setLocalPreviewUrl(result.url)
    await copy(result.url, result.rotated)
  }

  function voidForm() {
    if (!form) return
    const reason = window.prompt("Why is this booking form being voided?")
    if (!reason?.trim()) return
    run(() => voidNativeBookingForm(form.id, reason))
  }

  function sendForm(edits: BookingFormEdits, sendMode: BookingFormSendMode) {
    run(
      () =>
        createAndSendNativeBookingForm({
          dealId,
          edits,
          sendMode,
          reissueFromId: editorMode === "reissue" || editorMode === "edit" ? form?.id : undefined,
        }),
      () => setEditorMode(null),
    )
  }

  function saveForm(edits: BookingFormEdits) {
    run(
      () =>
        saveNativeBookingFormDraft({
          dealId,
          edits,
          reissueFromId: editorMode === "reissue" || editorMode === "edit" ? form?.id : undefined,
        }),
      () => setEditorMode(null),
    )
  }

  function notifyForm(edits?: BookingFormEdits) {
    run(
      () =>
        notifyNativeBookingFormReady({
          dealId,
          edits,
          reissueFromId: editorMode === "reissue" || editorMode === "edit" ? form?.id : undefined,
          bookingFormId: edits ? undefined : form?.id,
        }),
      () => setEditorMode(null),
    )
  }

  function sendSaved(sendMode: BookingFormSendMode) {
    if (!form) return
    run(() => sendSavedNativeBookingForm({ bookingFormId: form.id, sendMode }))
  }

  const lastReadyNotice = events.find((event) => event.event_type === "ready_notified")
  const isDraft = form?.status === "draft" || form?.status === "failed"
  const active = form && ["draft", "failed", "sent", "viewed", "awaiting_zk_signature", "zk_signed"].includes(form.status)

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center gap-2">
        <FileSignature className="h-4 w-4 text-[#F90202]" />
        <h3 className="text-[9px] font-semibold">Native booking form</h3>
      </div>

      {!form || (!active && form.status !== "completed") ? (
        <div className="mt-3">
          {orderAlreadyConfirmed && !form ? (
            <p className="text-[8px] text-slate-500">
              {confirmedOffPlatform
                ? "This sale was booked on the previous platform. A portal booking form is not required."
                : "This booking was confirmed when the order was placed. Terms were accepted in place of a booking form, so a signing link is not needed."}
            </p>
          ) : (
            <>
          {form ? (
            <p className="mb-2 text-[8px] text-slate-500">
              Previous revision {form.document_ref}: {STATUS_LABELS[form.status]}
            </p>
          ) : (
            <p className="mb-2 text-[8px] text-slate-500">
              Creates an editable PDF snapshot. Stock is reserved for seven days only when an approved admin
              sends it to the client.
            </p>
          )}
          <button
            type="button"
            disabled={pending || dealClosed || orderAlreadyConfirmed}
            onClick={() => setEditorMode("create")}
            className="h-10 w-full rounded-md bg-[#010101] text-[9px] font-semibold text-white disabled:opacity-50"
          >
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              Create booking form
            </span>
          </button>
            </>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="rounded-md bg-slate-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-semibold">{form.document_ref}</p>
                <p className="mt-1 text-[8px] text-slate-500">Revision {form.revision}</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${
                form.status === "completed"
                  ? "bg-slate-900 text-white"
                  : form.status === "awaiting_zk_signature" || isDraft
                    ? "bg-amber-100 text-amber-900"
                    : "bg-slate-100 text-slate-800"
              }`}>
                {STATUS_LABELS[form.status]}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-[82px_1fr] gap-y-1.5 text-[8px]">
              <dt className="text-slate-400">Sent</dt><dd>{dateTime(form.sent_at)}</dd>
              <dt className="text-slate-400">Viewed</dt><dd>{dateTime(form.first_viewed_at)}</dd>
              <dt className="text-slate-400">Client signed</dt><dd>{dateTime(form.client_signed_at)}</dd>
              <dt className="text-slate-400">ZK signed</dt><dd>{dateTime(form.zk_signed_at)}</dd>
              {["sent", "viewed"].includes(form.status) ? (
                <><dt className="text-slate-400">Expires</dt><dd>{dateTime(form.client_token_expires_at)}</dd></>
              ) : null}
            </dl>
            {form.last_error ? <p className="mt-2 text-[8px] font-medium text-red-600">{form.last_error}</p> : null}
            {isDraft && lastReadyNotice ? (
              <p className="mt-2 text-[8px] text-slate-500">
                Admins notified {dateTime(lastReadyNotice.created_at)}. An approved admin still needs to send this to the client.
              </p>
            ) : isDraft ? (
              <p className="mt-2 text-[8px] text-slate-500">
                Saved for an approved admin to send. Stock is not reserved yet.
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={download} className="h-9 rounded-md border text-[9px] font-semibold">
              <span className="inline-flex items-center gap-1"><Download className="h-3.5 w-3.5" /> View PDF</span>
            </button>
            {["sent", "viewed"].includes(form.status) && currentIsAdmin ? (
              <button type="button" disabled={pending} onClick={() => void copySigningLink()} className="h-9 rounded-md border text-[9px] font-semibold disabled:opacity-50">
                <span className="inline-flex items-center gap-1"><Copy className="h-3.5 w-3.5" /> Copy signing link</span>
              </button>
            ) : null}
            {["sent", "viewed"].includes(form.status) && currentIsAdmin ? (
              <button type="button" disabled={pending} onClick={() => run(() => resendNativeBookingForm(form.id))} className="h-9 rounded-md border text-[9px] font-semibold disabled:opacity-50">
                Resend email
              </button>
            ) : null}
            {isDraft ? (
              <button type="button" disabled={pending} onClick={() => setEditorMode("edit")} className="h-9 rounded-md border text-[9px] font-semibold disabled:opacity-50">
                Edit
              </button>
            ) : null}
            {["sent", "viewed"].includes(form.status) && currentIsAdmin ? (
              <button type="button" disabled={pending} onClick={() => setEditorMode("reissue")} className="h-9 rounded-md border text-[9px] font-semibold disabled:opacity-50">
                Edit &amp; reissue
              </button>
            ) : null}
            {isDraft ? (
              <button type="button" disabled={pending} onClick={() => notifyForm()} className="h-9 rounded-md border text-[9px] font-semibold disabled:opacity-50">
                Notify admins to send
              </button>
            ) : null}
            {isDraft && currentIsAdmin ? (
              <button type="button" disabled={pending} onClick={() => sendSaved("signing_link")} className="h-9 rounded-md bg-[#010101] text-[9px] font-semibold text-white disabled:opacity-50">
                Send to client
              </button>
            ) : null}
            {isDraft && currentIsAdmin ? (
              <button type="button" disabled={pending} onClick={() => sendSaved("manual_pdf")} className="h-9 rounded-md border text-[9px] font-semibold disabled:opacity-50">
                Email PDF only
              </button>
            ) : null}
            {form.status === "awaiting_zk_signature" && currentIsAdmin ? (
              <button type="button" onClick={() => setShowSignature(true)} className="h-9 rounded-md bg-[#010101] text-[9px] font-semibold text-white">
                <span className="inline-flex items-center gap-1"><PenLine className="h-3.5 w-3.5" /> Review &amp; sign</span>
              </button>
            ) : null}
            {active && form.status !== "zk_signed" && currentCanManageDeals ? (
              <button type="button" disabled={pending} onClick={voidForm} className="h-9 rounded-md border border-red-200 text-[9px] font-semibold text-red-600 disabled:opacity-50">
                Void &amp; release
              </button>
            ) : null}
          </div>
          {form.status === "completed" ? (
            <p className="flex items-center gap-1.5 text-[8px] font-semibold text-slate-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Final signed PDF is immutable and stored privately.
            </p>
          ) : null}
          {events.length ? (
            <div>
              <p className="text-[8px] font-semibold text-slate-500">Audit trail</p>
              <div className="mt-1 space-y-1 text-[8px] text-slate-500">
                {events
                  .filter((event) => event.event_type !== "signing_token_issued")
                  .slice(0, 5)
                  .map((event) => (
                  <p key={event.id}>{event.event_type.replaceAll("_", " ")} · {dateTime(event.created_at)}</p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {showSignature && form ? (
        <AdminSignatureModal form={form} defaultName={currentProfileName} onClose={() => setShowSignature(false)} />
      ) : null}
      {editorMode ? (
        <BookingFormEditor
          dealId={dealId}
          reissueFromId={editorMode === "create" ? undefined : form?.id}
          pending={pending}
          canSend={currentIsAdmin}
          onClose={() => setEditorMode(null)}
          onSave={saveForm}
          onNotify={notifyForm}
          onSend={sendForm}
        />
      ) : null}
      {localPreviewUrl && currentIsAdmin && form && ["sent", "viewed"].includes(form.status) ? (
        <button
          type="button"
          onClick={() => void copySigningLink()}
          className="mt-3 block w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-center text-[9px] font-semibold text-slate-800"
        >
          Copy WhatsApp signing link
        </button>
      ) : null}
    </div>
  )
}

