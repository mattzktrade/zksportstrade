import type { BookingFormAdminRow, BookingFormEventRow, BookingFormStatus } from "@/lib/booking-forms/types"

export type BookingFormHandoffKind =
  | "draft"
  | "approval"
  | "sent"
  | "viewed"
  | "awaiting_zk"
  | "completed"
  | "other"

export type BookingFormHandoffStatus = {
  kind: BookingFormHandoffKind
  title: string
  detail: string
  badge: string
}

const APPROVAL_CONTACTS = "Ollie and Michel"

export function bookingFormWasSentForApproval(
  events: Array<Pick<BookingFormEventRow, "event_type">>,
): boolean {
  return events.some((event) => event.event_type === "ready_notified")
}

export function bookingFormHandoffStatus(
  form: Pick<BookingFormAdminRow, "status"> | null | undefined,
  events: Array<Pick<BookingFormEventRow, "event_type">> = [],
): BookingFormHandoffStatus | null {
  if (!form) return null
  const status = form.status as BookingFormStatus
  const awaitingSend = status === "draft" || status === "failed"

  if (awaitingSend && bookingFormWasSentForApproval(events)) {
    return {
      kind: "approval",
      title: `Sent for approval to ${APPROVAL_CONTACTS}`,
      detail: "They still need to send this booking form to the client.",
      badge: "Sent for approval",
    }
  }

  if (awaitingSend) {
    return {
      kind: "draft",
      title: "Booking form saved",
      detail: "Not sent yet. Send for approval, or send it to the client if you can.",
      badge: "Draft",
    }
  }

  if (status === "sent") {
    return {
      kind: "sent",
      title: "Booking form sent to the client",
      detail: "Waiting for them to open and sign it.",
      badge: "Sent to client",
    }
  }

  if (status === "viewed") {
    return {
      kind: "viewed",
      title: "Booking form sent to the client",
      detail: "The client has opened it. Waiting for their signature.",
      badge: "Sent to client",
    }
  }

  if (status === "awaiting_zk_signature") {
    return {
      kind: "awaiting_zk",
      title: "Client signed — ZK signature required",
      detail: "An admin or finance needs to countersign.",
      badge: "Client signed",
    }
  }

  if (status === "completed" || status === "zk_signed") {
    return {
      kind: "completed",
      title: status === "completed" ? "Booking form completed" : "Generating the signed document",
      detail:
        status === "completed"
          ? "The signed PDF is stored on this deal."
          : "The final signed PDF is being generated.",
      badge: status === "completed" ? "Completed" : "Signing",
    }
  }

  return {
    kind: "other",
    title: `Booking form: ${status.replaceAll("_", " ")}`,
    detail: "",
    badge: status.replaceAll("_", " "),
  }
}

export function bookingFormHandoffTone(kind: BookingFormHandoffKind): string {
  switch (kind) {
    case "approval":
    case "awaiting_zk":
      return "border-amber-200 bg-amber-50 text-amber-950"
    case "sent":
    case "viewed":
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-950"
    default:
      return "border-slate-200 bg-slate-50 text-slate-800"
  }
}
