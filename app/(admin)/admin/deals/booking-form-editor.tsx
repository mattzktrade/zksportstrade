"use client"

import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { FileText, Plus, RotateCcw, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import {
  previewNativeBookingFormPdf,
  previewNativeBookingFormSnapshot,
} from "./booking-form-actions"
import {
  standardTermEdits,
  type BookingFormEdits,
  type BookingFormSendMode,
} from "@/lib/booking-forms/edits"

const inputClass = "mt-2 h-11 w-full rounded-md border px-3 font-normal"
const textareaClass = "mt-2 w-full rounded-md border p-3 font-normal"
const smallInputClass = "mt-1 h-10 w-full rounded-md border px-3 font-normal text-sm"

export function BodyPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setTarget(document.body)
  }, [])
  if (!target) return null
  return createPortal(children, target)
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-bold">{title}</h3>
      {hint ? <p className="mt-1 text-xs leading-5 text-slate-500">{hint}</p> : null}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

export function BookingFormEditor({
  dealId,
  reissueFromId,
  pending,
  canSend,
  onClose,
  onSave,
  onNotify,
  onSend,
}: {
  dealId: string
  reissueFromId?: string
  pending: boolean
  canSend: boolean
  onClose: () => void
  onSave: (edits: BookingFormEdits) => void
  onNotify: (edits: BookingFormEdits) => void
  onSend: (edits: BookingFormEdits, sendMode: BookingFormSendMode) => void
}) {
  const [edits, setEdits] = useState<BookingFormEdits | null>(null)
  const [loading, setLoading] = useState(true)
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    previewNativeBookingFormSnapshot({
      dealId,
      bookingFormId: reissueFromId,
    }).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        toast.error(result.message)
        onClose()
        return
      }
      setEdits(result.edits)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [dealId, reissueFromId])

  function update<K extends keyof BookingFormEdits>(key: K, value: BookingFormEdits[K]) {
    setEdits((current) => (current ? { ...current, [key]: value } : current))
  }

  async function previewPdf() {
    if (!edits) return
    setPreviewing(true)
    try {
      const result = await previewNativeBookingFormPdf({ dealId, edits })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      const binary = atob(result.pdfBase64)
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
      window.open(url, "_blank", "noopener,noreferrer")
    } finally {
      setPreviewing(false)
    }
  }

  return (
    <BodyPortal>
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" data-escape-close="" onClick={onClose}>
      <div
        className="flex max-h-[94vh] min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 flex items-start justify-between gap-4 border-b px-6 py-5">
          <div>
            <h2 className="text-lg font-bold">
              {reissueFromId ? "Edit booking form" : canSend ? "Review booking form before sending" : "Prepare booking form"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Everything below is copied from the deal and standard terms. Change any names, products, payment
              wording, or T&amp;Cs for this revision only.
              {canSend
                ? ""
                : " Saving does not email the client. Use notify so an approved admin can send it."}
            </p>
          </div>
          <button type="button" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {loading || !edits ? (
            <p className="text-sm text-slate-500">Loading booking form…</p>
          ) : (
            <>
              <Section title="Bill to" hint="This is who the form is addressed to and who receives the email.">
                <label className="block text-sm font-semibold">
                  Document title
                  <input
                    value={edits.dealTitle}
                    onChange={(event) => update("dealTitle", event.target.value)}
                    maxLength={240}
                    className={inputClass}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-semibold">
                    Account name
                    <input
                      value={edits.billToAccountName}
                      onChange={(event) => update("billToAccountName", event.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="block text-sm font-semibold">
                    Signer name
                    <input
                      value={edits.billToContactName}
                      onChange={(event) => update("billToContactName", event.target.value)}
                      className={inputClass}
                    />
                  </label>
                </div>
                <label className="block text-sm font-semibold">
                  Signer email
                  <input
                    type="email"
                    value={edits.billToContactEmail}
                    onChange={(event) => update("billToContactEmail", event.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Billing address
                  <textarea
                    value={edits.billToAddress}
                    onChange={(event) => update("billToAddress", event.target.value)}
                    rows={3}
                    className={textareaClass}
                  />
                </label>
              </Section>

              <Section
                title="Products"
                hint="Names and descriptions appear on the PDF. Changing quantity or price here only changes this document, not the deal."
              >
                <label className="flex items-start gap-3 rounded-md border border-slate-200 p-3">
                  <input
                    type="checkbox"
                    checked={edits.noVat}
                    onChange={(event) => update("noVat", event.target.checked)}
                    className="mt-1 h-4 w-4 accent-[#F90202]"
                  />
                  <span>
                    <span className="text-sm font-semibold">No VAT</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">
                      Leave ticked for most events. Untick for Abu Dhabi to show 5% VAT included
                      in the price breakdown. The total does not change.
                    </span>
                  </span>
                </label>
                {edits.lines.map((line, index) => (
                  <div key={index} className="rounded-md bg-slate-50 p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-xs font-semibold">
                        Event name
                        <input
                          value={line.eventName}
                          onChange={(event) =>
                            update(
                              "lines",
                              edits.lines.map((entry, entryIndex) =>
                                entryIndex === index ? { ...entry, eventName: event.target.value } : entry,
                              ),
                            )
                          }
                          className={smallInputClass}
                        />
                      </label>
                      <label className="block text-xs font-semibold">
                        Package name
                        <input
                          value={line.packageName}
                          onChange={(event) =>
                            update(
                              "lines",
                              edits.lines.map((entry, entryIndex) =>
                                entryIndex === index ? { ...entry, packageName: event.target.value } : entry,
                              ),
                            )
                          }
                          className={smallInputClass}
                        />
                      </label>
                    </div>
                    <label className="mt-3 block text-xs font-semibold">
                      Line description on PDF
                      <input
                        value={line.description}
                        onChange={(event) =>
                          update(
                            "lines",
                            edits.lines.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, description: event.target.value } : entry,
                            ),
                          )
                        }
                        className={smallInputClass}
                      />
                    </label>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <label className="block text-xs font-semibold">
                        Quantity
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={line.quantity}
                          onChange={(event) =>
                            update(
                              "lines",
                              edits.lines.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, quantity: Number(event.target.value) }
                                  : entry,
                              ),
                            )
                          }
                          className={smallInputClass}
                        />
                      </label>
                      <label className="block text-xs font-semibold">
                        Unit price (USD)
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(event) =>
                            update(
                              "lines",
                              edits.lines.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, unitPrice: Number(event.target.value) }
                                  : entry,
                              ),
                            )
                          }
                          className={smallInputClass}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </Section>

              <Section title="Payment">
                <label className="block text-sm font-semibold">
                  Payment terms
                  <textarea
                    value={edits.paymentTerms}
                    onChange={(event) => update("paymentTerms", event.target.value)}
                    rows={3}
                    className={textareaClass}
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Payment method
                  <input
                    value={edits.paymentMethod}
                    onChange={(event) => update("paymentMethod", event.target.value)}
                    className={inputClass}
                  />
                </label>
                <div className="space-y-3">
                  {edits.bankDetails.map((bank, index) => (
                    <div key={index} className="grid gap-2 rounded-md bg-slate-50 p-3 sm:grid-cols-2">
                      {(["currency", "recipient", "bank", "iban", "swift"] as const).map((field) => (
                        <label key={field} className="block text-xs font-semibold uppercase">
                          {field}
                          <input
                            value={bank[field]}
                            onChange={(event) =>
                              update(
                                "bankDetails",
                                edits.bankDetails.map((entry, entryIndex) =>
                                  entryIndex === index ? { ...entry, [field]: event.target.value } : entry,
                                ),
                              )
                            }
                            className={smallInputClass}
                          />
                        </label>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          update(
                            "bankDetails",
                            edits.bankDetails.filter((_, entryIndex) => entryIndex !== index),
                          )
                        }
                        className="inline-flex items-center gap-1 text-xs font-semibold text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove account
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      update("bankDetails", [
                        ...edits.bankDetails,
                        { currency: "USD", recipient: "", bank: "", iban: "", swift: "" },
                      ])
                    }
                    className="inline-flex items-center gap-1 text-sm font-semibold text-[#F90202]"
                  >
                    <Plus className="h-4 w-4" /> Add bank account
                  </button>
                </div>
              </Section>

              <Section title="Seller">
                <label className="block text-sm font-semibold">
                  Legal name
                  <input
                    value={edits.sellerLegalName}
                    onChange={(event) => update("sellerLegalName", event.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Address
                  <textarea
                    value={edits.sellerAddress}
                    onChange={(event) => update("sellerAddress", event.target.value)}
                    rows={3}
                    className={textareaClass}
                  />
                </label>
                <label className="block text-sm font-semibold">
                  TRN
                  <input
                    value={edits.sellerTrn}
                    onChange={(event) => update("sellerTrn", event.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Acknowledgement
                  <textarea
                    value={edits.acknowledgement}
                    onChange={(event) => update("acknowledgement", event.target.value)}
                    rows={3}
                    className={textareaClass}
                  />
                </label>
              </Section>

              <Section
                title="Terms and conditions"
                hint="Separate paragraphs with a blank line. Add or remove sections as needed for this client."
              >
                <button
                  type="button"
                  onClick={() => update("terms", standardTermEdits())}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600"
                >
                  <RotateCcw className="h-4 w-4" /> Reset to standard ZK terms
                </button>
                {edits.terms.map((section, index) => (
                  <div key={index} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <label className="block flex-1 text-xs font-semibold">
                        Heading
                        <input
                          value={section.heading}
                          onChange={(event) =>
                            update(
                              "terms",
                              edits.terms.map((entry, entryIndex) =>
                                entryIndex === index ? { ...entry, heading: event.target.value } : entry,
                              ),
                            )
                          }
                          className={smallInputClass}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          update(
                            "terms",
                            edits.terms.filter((_, entryIndex) => entryIndex !== index),
                          )
                        }
                        className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </button>
                    </div>
                    <label className="mt-3 block text-xs font-semibold">
                      Paragraphs
                      <textarea
                        value={section.body}
                        onChange={(event) =>
                          update(
                            "terms",
                            edits.terms.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, body: event.target.value } : entry,
                            ),
                          )
                        }
                        rows={6}
                        className={textareaClass}
                      />
                    </label>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    update("terms", [
                      ...edits.terms,
                      { heading: "Special terms / amendments for this booking", body: "Add the deal-specific wording here." },
                    ])
                  }
                  className="inline-flex items-center gap-1 text-sm font-semibold text-[#F90202]"
                >
                  <Plus className="h-4 w-4" /> Add terms section
                </button>
              </Section>
            </>
          )}
        </div>

        <div className="shrink-0 border-t bg-slate-50 px-6 py-4">
          {canSend ? (
            <p className="mb-3 text-xs leading-5 text-amber-900">
              Sending locks this snapshot, reserves stock for seven days, and emails the client. You can also
              save without sending so the form stays in Ready to send until an admin emails it.
            </p>
          ) : (
            <p className="mb-3 text-xs leading-5 text-amber-900">
              Saving does not email the client or reserve stock. Notify Ollie, Michel, and Matt when the form
              is ready — an approved admin still has to send it.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onClose} className="h-11 rounded-md border px-4 font-semibold">
              Cancel
            </button>
            <button
              type="button"
              disabled={pending || previewing || !edits}
              onClick={previewPdf}
              className="inline-flex h-11 items-center gap-2 rounded-md border px-4 font-semibold disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              {previewing ? "Building PDF…" : "Preview PDF"}
            </button>
            <button
              type="button"
              disabled={pending || !edits}
              onClick={() => edits && onSave(edits)}
              className="h-11 rounded-md border px-4 font-semibold disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save booking form"}
            </button>
            {!canSend ? (
              <button
                type="button"
                disabled={pending || !edits}
                onClick={() => edits && onNotify(edits)}
                className="ml-auto h-11 rounded-md bg-[#010101] px-4 font-bold text-white disabled:opacity-50"
              >
                {pending ? "Notifying…" : "Notify admins to send"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={pending || !edits}
                  onClick={() => edits && onSend(edits, "manual_pdf")}
                  className="h-11 rounded-md border px-4 font-semibold disabled:opacity-50"
                >
                  {pending ? "Sending…" : "Email PDF only"}
                </button>
                <button
                  type="button"
                  disabled={pending || !edits}
                  onClick={() => edits && onSend(edits, "signing_link")}
                  className="ml-auto h-11 rounded-md bg-[#010101] px-4 font-bold text-white disabled:opacity-50"
                >
                  {pending ? "Creating and sending…" : "Confirm, reserve & send"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
    </BodyPortal>
  )
}
