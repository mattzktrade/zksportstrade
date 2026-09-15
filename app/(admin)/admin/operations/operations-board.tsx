"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Mail } from "lucide-react"
import { toast } from "sonner"
import { StatusPill } from "@/components/admin/admin-page-kit"
import { AccountNameLink, ContactNameLink } from "@/components/admin/profile-name-link"
import { formatEventDate } from "@/lib/admin/workflow-event-filter"
import type { OperationsBookingRow } from "@/lib/admin/operations-bookings"
import type { OperationsGuest, OperationsSupportingData } from "@/lib/admin/workflow-views"
import { saveGuestListSeat } from "@/app/(admin)/admin/catalog/guest-list-actions"
import { getDeliveryProofDownloadUrl } from "@/app/(admin)/actions"
import {
  addOperationsContact,
  addOperationsDeliveryProof,
  markNamesSentToSupplier,
  saveFulfilmentPlan,
  saveOperationsContact,
  skipOperationsThankYou,
  stampTicketsReceived,
} from "@/app/(admin)/admin/operations/board-actions"
import { OperationsEmailComposer } from "@/app/(admin)/admin/operations/operations-email-composer"
import { OperationsGuestEditor, type GuestDraft } from "@/app/(admin)/admin/operations/guest-editor"
import { OperationsSupplierEditor } from "@/app/(admin)/admin/operations/supplier-editor"
import { deleteOrderGuest, reassignDealPackageStock, reassignOrderPackageStock, saveOrderGuests } from "@/app/(admin)/admin/operations/actions"
import { bookingStepInput, lastEmailAt } from "@/lib/operations/booking-view"
import type { OperationsEmailKind } from "@/lib/operations/emails"
import {
  CLIENT_DELIVERY_METHODS,
  SUPPLIER_FULFILMENT_METHODS,
  clientDeliveryLabel,
  isOperationsDelivered,
  isOperationsPaid,
  lockedClientDelivery,
  operationsBoardStepStatus,
  parseClientDeliveryMethod,
  parseSupplierFulfilmentMethod,
  supplierFulfilmentLabel,
  supplierNeedsNamesSent,
  supplierNeedsTicketsIn,
  unpaidCloseToEvent,
  type OperationsBoardStep,
} from "@/lib/operations/fulfilment"
import { GUEST_TICKET_STATUSES } from "@/lib/admin/package-guest-list-model"

function orderIdOf(row: OperationsBookingRow): string | null {
  return row.id.startsWith("deal:") ? null : row.id
}

function guestsForRow(guests: OperationsGuest[], row: OperationsBookingRow): OperationsGuest[] {
  if (orderIdOf(row)) return guests.filter((guest) => guest.orderId === row.id)
  return guests.filter((guest) => guest.dealId === row.dealId)
}

const STEPS: Array<{ id: OperationsBoardStep; title: string }> = [
  { id: "paid", title: "Paid" },
  { id: "ops_contact", title: "Ops contact" },
  { id: "guests", title: "Guest details" },
  { id: "supplier", title: "Tickets from supplier" },
  { id: "allocate", title: "Allocate seats" },
  { id: "fulfil", title: "Fulfil and proof" },
  { id: "after_event", title: "After the event" },
]

export function OperationsBoard({
  row,
  supporting,
  canManage,
  onBack,
}: {
  row: OperationsBookingRow
  supporting: OperationsSupportingData
  canManage: boolean
  onBack: () => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [emailKind, setEmailKind] = useState<OperationsEmailKind | null>(null)
  const [guestsOpen, setGuestsOpen] = useState(false)
  const [supplierOpen, setSupplierOpen] = useState(false)
  const [newContact, setNewContact] = useState({ fullName: "", email: "", phone: "", jobTitle: "" })
  const [plan, setPlan] = useState({
    supplier: row.supplierFulfilmentMethod ?? "",
    client: row.clientDeliveryMethod ?? "",
    collectionPoint: row.collectionPoint ?? "",
    collectionTime: row.collectionTime ?? "",
    contactOnSite: row.contactOnSite ?? "",
    deliveryDueAt: row.deliveryDueAt?.slice(0, 10) ?? "",
    notes: row.internalNotes ?? "",
  })
  const [proofNote, setProofNote] = useState("")
  const [proofFile, setProofFile] = useState<File | null>(null)

  const input = bookingStepInput(row, supporting.emails)
  const paid = isOperationsPaid(input)
  const guests = guestsForRow(supporting.guests, row)
  const contacts = supporting.contacts.filter((contact) => contact.accountId === row.accountId)
  const proofs = supporting.proofs.filter(
    (proof) => (orderIdOf(row) && proof.orderId === row.id) || (row.dealId && proof.dealId === row.dealId),
  )
  const lines = supporting.lines.filter((line) => line.orderId === row.id)
  const lockedClient = lockedClientDelivery(plan.supplier)
  const clientValue = lockedClient ?? plan.client
  const supplierMethod = parseSupplierFulfilmentMethod(plan.supplier)
  const clientMethod = parseClientDeliveryMethod(clientValue)

  const activeStep = useMemo(() => {
    for (const step of STEPS) {
      if (operationsBoardStepStatus(step.id, input) === "current") return step.id
    }
    return "guests"
  }, [input])

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    start(async () => {
      const result = await action()
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  function savePlan() {
    run(() =>
      saveFulfilmentPlan({
        orderId: orderIdOf(row),
        dealId: row.dealId,
        supplierFulfilmentMethod: plan.supplier || null,
        clientDeliveryMethod: clientValue || null,
        collectionPoint: plan.collectionPoint,
        collectionTime: plan.collectionTime,
        contactOnSite: plan.contactOnSite,
        deliveryDueAt: plan.deliveryDueAt || null,
        internalNotes: plan.notes,
      }),
    )
  }

  function submitProof() {
    const data = new FormData()
    data.set("orderId", orderIdOf(row) ?? "")
    data.set("dealId", row.dealId ?? "")
    data.set("note", proofNote)
    if (proofFile) data.set("file", proofFile)
    run(() => addOperationsDeliveryProof(data))
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to queue
      </button>

      <div className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {row.dealId ? (
              <Link href={`/admin/deals/${row.dealId}`} className="text-lg font-semibold text-primary hover:underline">
                {row.dealReference || row.reference}
              </Link>
            ) : (
              <h2 className="text-lg font-semibold">{row.dealReference || row.reference}</h2>
            )}
            <AccountNameLink accountId={row.accountId} name={row.accountName} className="mt-1 block font-medium" />
            <p className="mt-1 max-w-2xl text-[11px] leading-snug text-slate-600">{row.eventPackage}</p>
            <p className="mt-1 text-[10px] text-slate-400">{formatEventDate(row.eventDate)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill tone={paid ? "green" : "amber"}>{paid ? "Paid" : "Unpaid"}</StatusPill>
            <StatusPill tone="blue">{row.completeGuestCount}/{row.quantity} guests</StatusPill>
            {unpaidCloseToEvent(input) ? <StatusPill tone="red">Unpaid · event soon</StatusPill> : null}
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <ol className="rounded-lg border bg-white p-3 text-[11px]">
          {STEPS.map((step) => {
            const status = operationsBoardStepStatus(step.id, input)
            if (status === "skipped") return null
            return (
              <li key={step.id} className={`border-b px-1 py-2 last:border-0 ${step.id === activeStep ? "font-semibold text-primary" : "text-slate-600"}`}>
                <span className="mr-2 text-[9px] uppercase tracking-wide text-slate-400">
                  {status === "done" ? "Done" : status === "current" ? "Now" : "Next"}
                </span>
                {step.title}
              </li>
            )
          })}
        </ol>

        <div className="space-y-3">
          <section className="rounded-lg border bg-white p-4">
            <h3 className="text-[12px] font-semibold">1. Paid</h3>
            <p className="mt-1 text-[11px] text-slate-500">Finance owns this. Xero marks it paid automatically.</p>
            <p className="mt-2 text-[11px]">{paid ? "Paid." : "Awaiting payment."}</p>
          </section>

          <section className="rounded-lg border bg-white p-4">
            <h3 className="text-[12px] font-semibold">2. Operations contact</h3>
            <p className="mt-1 text-[11px] text-slate-500">Guest and ticket emails go to this person, not necessarily the person who bought.</p>
            {row.dealId && canManage ? (
              <div className="mt-3 space-y-2">
                <select
                  disabled={pending || contacts.length === 0}
                  value={row.operationsContactId ?? ""}
                  onChange={(event) =>
                    run(() => saveOperationsContact({ dealId: row.dealId!, contactId: event.target.value || null }))
                  }
                  className="h-9 w-full max-w-md rounded-md border bg-white px-2 text-[11px]"
                >
                  <option value="">{row.contactName ? `Default · ${row.contactName}` : "Deal primary contact"}</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.fullName}
                      {contact.email ? ` · ${contact.email}` : ""}
                    </option>
                  ))}
                </select>
                {row.operationsContactName ? (
                  <ContactNameLink
                    accountId={row.accountId}
                    contactId={row.operationsContactId}
                    name={`${row.operationsContactName}${row.operationsContactEmail ? ` · ${row.operationsContactEmail}` : ""}`}
                    className="block text-[10px] text-slate-500"
                  />
                ) : (
                  <p className="text-[10px] text-slate-400">Using the deal’s primary contact until you pick someone else.</p>
                )}
                {row.accountId ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={newContact.fullName}
                      onChange={(event) => setNewContact((current) => ({ ...current, fullName: event.target.value }))}
                      placeholder="Add contact name"
                      className="h-9 rounded-md border px-2 text-[11px]"
                    />
                    <input
                      value={newContact.email}
                      onChange={(event) => setNewContact((current) => ({ ...current, email: event.target.value }))}
                      placeholder="Email"
                      className="h-9 rounded-md border px-2 text-[11px]"
                    />
                    <input
                      value={newContact.phone}
                      onChange={(event) => setNewContact((current) => ({ ...current, phone: event.target.value }))}
                      placeholder="Phone"
                      className="h-9 rounded-md border px-2 text-[11px]"
                    />
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          const result = await addOperationsContact({
                            dealId: row.dealId!,
                            accountId: row.accountId!,
                            ...newContact,
                          })
                          if (result.ok) setNewContact({ fullName: "", email: "", phone: "", jobTitle: "" })
                          return result
                        })
                      }
                      className="h-9 rounded-md border px-3 text-[11px] font-semibold"
                    >
                      Add and use
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-[11px]">{row.operationsContactName || row.contactName}</p>
            )}
          </section>

          <section className="rounded-lg border bg-white p-4">
            <h3 className="text-[12px] font-semibold">3. Guest details</h3>
            <p className="mt-1 text-[11px] text-slate-500">
              {row.completeGuestCount}/{row.quantity} complete
              {row.guestDetailsDeadline ? ` · supplier deadline ${formatEventDate(row.guestDetailsDeadline)}` : ""}
            </p>
            {canManage && row.dealId ? (
              <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-semibold text-primary">
                <button type="button" onClick={() => setEmailKind("operations_intro")}>Intro email</button>
                <button type="button" onClick={() => setEmailKind("guest_details")}>Request guests</button>
                <button type="button" onClick={() => setEmailKind("guest_details_reminder")}>Reminder</button>
                <button type="button" onClick={() => setGuestsOpen(true)}>Edit names</button>
              </div>
            ) : null}
            {lastEmailAt(supporting.emails, row.dealId, "guest_details") ? (
              <p className="mt-2 text-[10px] text-slate-400">
                Last asked {new Date(lastEmailAt(supporting.emails, row.dealId, "guest_details")!).toLocaleDateString("en-GB")}
              </p>
            ) : null}
          </section>

          <section className="rounded-lg border bg-white p-4">
            <h3 className="text-[12px] font-semibold">4. Tickets from supplier</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-[11px] font-semibold">
                From the supplier
                <select
                  disabled={!canManage || pending}
                  value={plan.supplier}
                  onChange={(event) => setPlan((current) => ({ ...current, supplier: event.target.value }))}
                  className="mt-1 h-9 w-full rounded-md border bg-white px-2 font-normal"
                >
                  <option value="">Choose…</option>
                  {SUPPLIER_FULFILMENT_METHODS.map((value) => (
                    <option key={value} value={value}>
                      {supplierFulfilmentLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[11px] font-semibold">
                To the client
                <select
                  disabled={!canManage || pending || Boolean(lockedClient)}
                  value={clientValue}
                  onChange={(event) => setPlan((current) => ({ ...current, client: event.target.value }))}
                  className="mt-1 h-9 w-full rounded-md border bg-white px-2 font-normal"
                >
                  <option value="">Choose…</option>
                  {CLIENT_DELIVERY_METHODS.map((value) => (
                    <option key={value} value={value}>
                      {clientDeliveryLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {clientMethod === "local_collection" || clientMethod === "posted_to_guest" || clientMethod === "official_shipment" ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <input
                  value={plan.collectionPoint}
                  onChange={(event) => setPlan((current) => ({ ...current, collectionPoint: event.target.value }))}
                  placeholder="Collection / meet point"
                  className="h-9 rounded-md border px-2 text-[11px]"
                />
                <input
                  value={plan.collectionTime}
                  onChange={(event) => setPlan((current) => ({ ...current, collectionTime: event.target.value }))}
                  placeholder="Time"
                  className="h-9 rounded-md border px-2 text-[11px]"
                />
                <input
                  type="date"
                  value={plan.deliveryDueAt}
                  onChange={(event) => setPlan((current) => ({ ...current, deliveryDueAt: event.target.value }))}
                  className="h-9 rounded-md border px-2 text-[11px]"
                />
                <input
                  value={plan.contactOnSite}
                  onChange={(event) => setPlan((current) => ({ ...current, contactOnSite: event.target.value }))}
                  placeholder="On-site contact"
                  className="h-9 rounded-md border px-2 text-[11px]"
                />
              </div>
            ) : null}
            {canManage ? (
              <button type="button" disabled={pending} onClick={savePlan} className="mt-3 h-9 rounded-md bg-primary px-4 text-[11px] font-semibold text-white">
                Save fulfilment plan
              </button>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3 text-[11px]">
              <label className="inline-flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={Boolean(row.supplierDetailsSentAt)}
                  disabled={!canManage || pending}
                  onChange={(event) =>
                    run(() =>
                      markNamesSentToSupplier({
                        orderId: orderIdOf(row),
                        dealId: row.dealId,
                        sent: event.target.checked,
                      }),
                    )
                  }
                />
                Names sent to supplier
              </label>
              {supplierNeedsTicketsIn(supplierMethod) || row.purchaseOrders.length > 0 ? (
                <label className="inline-flex items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={Boolean(row.ticketsReceivedAt) || row.supplierStatus === "tickets_received"}
                    disabled={!canManage || pending}
                    onChange={(event) =>
                      run(() =>
                        stampTicketsReceived({
                          orderId: orderIdOf(row),
                          dealId: row.dealId,
                          purchaseOrderIds: row.purchaseOrders.map((po) => po.id),
                          received: event.target.checked,
                        }),
                      )
                    }
                  />
                  Tickets received
                  {row.ticketsReceivedAt ? ` (${formatEventDate(row.ticketsReceivedAt)})` : ""}
                </label>
              ) : null}
              {canManage ? (
                <button type="button" className="font-semibold text-primary" onClick={() => setSupplierOpen(true)}>
                  Manage supplier stock
                </button>
              ) : null}
              {canManage && row.dealId && supplierNeedsNamesSent(supplierMethod) ? (
                <button type="button" className="font-semibold text-primary" onClick={() => setEmailKind("names_sent")}>
                  Email: names sent
                </button>
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4">
            <h3 className="text-[12px] font-semibold">5. Allocate seats</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="text-[8px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="py-2 pr-3">Guest</th>
                    <th className="py-2 pr-3">Ticket</th>
                    <th className="py-2 pr-3">Table</th>
                    <th className="py-2 pr-3">Paddock</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {guests.map((guest, index) => (
                    <tr key={guest.id}>
                      <td className="py-2 pr-3 font-medium">{guest.fullName || "Unnamed"}</td>
                      <td className="py-2 pr-3">
                        <input
                          defaultValue={guest.ticketNumber ?? ""}
                          disabled={!canManage}
                          onBlur={(event) =>
                            run(() =>
                              saveGuestListSeat({
                                guestId: guest.id,
                                orderId: guest.orderId,
                                dealId: guest.dealId,
                                slotIndex: guest.sortOrder ?? index,
                                ticketNumber: event.target.value,
                                tableNumber: guest.tableNumber,
                                paddockTour: guest.paddockTour,
                                ticketStatus: guest.ticketStatus,
                              }),
                            )
                          }
                          className="h-8 w-28 rounded border px-2"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          defaultValue={guest.tableNumber ?? ""}
                          disabled={!canManage}
                          onBlur={(event) =>
                            run(() =>
                              saveGuestListSeat({
                                guestId: guest.id,
                                orderId: guest.orderId,
                                dealId: guest.dealId,
                                slotIndex: guest.sortOrder ?? index,
                                ticketNumber: guest.ticketNumber,
                                tableNumber: event.target.value,
                                paddockTour: guest.paddockTour,
                                ticketStatus: guest.ticketStatus,
                              }),
                            )
                          }
                          className="h-8 w-20 rounded border px-2"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          defaultValue={guest.paddockTour ?? ""}
                          disabled={!canManage}
                          onBlur={(event) =>
                            run(() =>
                              saveGuestListSeat({
                                guestId: guest.id,
                                orderId: guest.orderId,
                                dealId: guest.dealId,
                                slotIndex: guest.sortOrder ?? index,
                                ticketNumber: guest.ticketNumber,
                                tableNumber: guest.tableNumber,
                                paddockTour: event.target.value,
                                ticketStatus: guest.ticketStatus,
                              }),
                            )
                          }
                          className="h-8 w-24 rounded border px-2"
                        />
                      </td>
                      <td className="py-2">
                        <select
                          defaultValue={guest.ticketStatus ?? "pending"}
                          disabled={!canManage}
                          onChange={(event) =>
                            run(() =>
                              saveGuestListSeat({
                                guestId: guest.id,
                                orderId: guest.orderId,
                                dealId: guest.dealId,
                                slotIndex: guest.sortOrder ?? index,
                                ticketNumber: guest.ticketNumber,
                                tableNumber: guest.tableNumber,
                                paddockTour: guest.paddockTour,
                                ticketStatus: event.target.value,
                              }),
                            )
                          }
                          className="h-8 rounded border bg-white px-1"
                        >
                          {GUEST_TICKET_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                  {guests.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-slate-400">
                        No guests yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4">
            <h3 className="text-[12px] font-semibold">6. Fulfil and proof</h3>
            <p className="mt-1 text-[11px] text-slate-500">
              A note or photo is required to mark this booking fulfilled. That is the same proof finance already uses.
            </p>
            {proofs.length ? (
              <ul className="mt-3 space-y-1 text-[11px] text-slate-600">
                {proofs.map((proof) => (
                  <li key={proof.id}>
                    {new Date(proof.createdAt).toLocaleString("en-GB")}
                    {proof.note ? ` · ${proof.note}` : ""}
                    {proof.fileName ? (
                      <button
                        type="button"
                        className="ml-2 font-semibold text-primary"
                        onClick={() =>
                          start(async () => {
                            const result = await getDeliveryProofDownloadUrl(proof.id)
                            if (!result.ok) {
                              toast.error(result.message)
                              return
                            }
                            window.open(result.url, "_blank", "noopener,noreferrer")
                          })
                        }
                      >
                        {proof.fileName}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-slate-400">No proof recorded yet.</p>
            )}
            {canManage && !isOperationsDelivered(input) ? (
              <div className="mt-3 space-y-2">
                <textarea
                  value={proofNote}
                  onChange={(event) => setProofNote(event.target.value)}
                  rows={3}
                  placeholder="e.g. Collected Yas Marina box office, 08:20"
                  className="w-full rounded-md border p-2 text-[11px]"
                />
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setProofFile(event.target.files?.[0] ?? null)} />
                <div className="flex flex-wrap gap-3">
                  <button type="button" disabled={pending} onClick={submitProof} className="h-9 rounded-md bg-primary px-4 text-[11px] font-semibold text-white">
                    Save proof and mark fulfilled
                  </button>
                  {row.dealId ? (
                    <>
                      <button type="button" className="text-[11px] font-semibold text-primary" onClick={() => setEmailKind("collection_details")}>
                        Collection email
                      </button>
                      <button type="button" className="text-[11px] font-semibold text-primary" onClick={() => setEmailKind("tickets_sent")}>
                        Tickets sent email
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          {row.isDirectClient ? (
            <section className="rounded-lg border bg-white p-4">
              <h3 className="text-[12px] font-semibold">7. After the event</h3>
              <p className="mt-1 text-[11px] text-slate-500">Direct clients only. One click sends the thank-you template.</p>
              {canManage && row.dealId ? (
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setEmailKind("after_event")}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[11px] font-semibold text-white"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    Send thank-you
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        skipOperationsThankYou({
                          orderId: orderIdOf(row),
                          dealId: row.dealId,
                          skip: !row.thankYouSkippedAt,
                        }),
                      )
                    }
                    className="h-9 rounded-md border px-3 text-[11px] font-semibold"
                  >
                    {row.thankYouSkippedAt ? "Undo skip" : "Don't send"}
                  </button>
                </div>
              ) : null}
              {lastEmailAt(supporting.emails, row.dealId, "after_event") ? (
                <p className="mt-2 text-[10px] text-slate-400">Thank-you already sent.</p>
              ) : null}
            </section>
          ) : (
            <p className="rounded-lg border bg-white p-4 text-[11px] text-slate-500">Agent bookings do not get the after-event thank-you.</p>
          )}
        </div>
      </div>

      {guestsOpen ? (
        <OperationsGuestEditor
          title="Manage guests"
          subtitle={`${row.dealReference || row.reference} · ${row.accountName}`}
          expectedCount={row.quantity}
          existing={guests}
          pending={pending}
          onClose={() => setGuestsOpen(false)}
          onSave={(drafts: GuestDraft[]) => {
            start(async () => {
              const result = await saveOrderGuests({
                orderId: orderIdOf(row) ?? undefined,
                dealId: row.dealId,
                guests: drafts.map((draft, index) => ({
                  guestId: draft.id,
                  fullName: draft.fullName,
                  email: draft.email,
                  phone: draft.phone,
                  nationality: draft.nationality,
                  dateOfBirth: draft.dateOfBirth,
                  dietaryRequirements: draft.dietaryRequirements,
                  specialRequests: draft.specialRequests,
                  isLeadGuest: draft.isLeadGuest,
                  detailsComplete: true,
                  sortOrder: draft.sortOrder ?? index,
                  attendanceDay: draft.attendanceDay,
                  headshotPath: draft.headshotPath,
                })),
              })
              if (!result.ok) {
                toast.error(result.message)
                return
              }
              toast.success(result.message)
              setGuestsOpen(false)
              router.refresh()
            })
          }}
          onDelete={(guestId) => {
            run(() => deleteOrderGuest({ orderId: orderIdOf(row) ?? undefined, dealId: row.dealId, guestId }))
          }}
        />
      ) : null}

      {supplierOpen ? (
        <OperationsSupplierEditor
          title="Manage supplier"
          subtitle={`${row.dealReference || row.reference} · ${row.accountName}`}
          orderId={row.id}
          lines={lines}
          layers={supporting.stockLayers}
          allocations={supporting.allocations}
          pending={pending}
          onClose={() => setSupplierOpen(false)}
          onSave={(packageId, takes) => {
            run(() =>
              orderIdOf(row)
                ? reassignOrderPackageStock({ orderId: row.id, packageId, allocations: takes })
                : reassignDealPackageStock({
                    dealId: row.dealId || row.id.replace(/^deal:/, ""),
                    packageId,
                    allocations: takes,
                  }),
            )
          }}
        />
      ) : null}

      {emailKind && row.dealId ? (
        <OperationsEmailComposer
          dealId={row.dealId}
          kind={emailKind}
          onClose={() => setEmailKind(null)}
          onSent={() => {
            setEmailKind(null)
            router.refresh()
          }}
        />
      ) : null}
    </div>
  )
}
