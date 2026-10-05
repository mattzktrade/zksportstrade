"use client"

import Image from "next/image"
import { useRef, useState } from "react"
import { CheckCircle2, Download, Eraser, LockKeyhole } from "lucide-react"
import { CONTRACT_SIGNATURE_CONSENT } from "@/lib/contracts/content"
import type { PublicInclusionContract } from "@/lib/contracts/public"
import { SignatureCapture, type SignatureCaptureHandle } from "@/components/signature-capture"
import { BRAND_RED, LOGO_MAIN } from "@/lib/branding"
import { BOOKING_SELLER } from "@/lib/booking-forms/template"

function isoDate(value: string): string {
  return value.slice(0, 10)
}

export function ContractSigningClient({
  token,
  form,
}: {
  token: string
  form: PublicInclusionContract
}) {
  const padRef = useRef<SignatureCaptureHandle | null>(null)
  const [hasInk, setHasInk] = useState(false)
  const [signerName, setSignerName] = useState(form.clientName)
  const [signerPosition, setSignerPosition] = useState("")
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [signed, setSigned] = useState(form.status === "signed")
  const facts = [
    ["Event", form.content.event],
    ["Dates", form.content.dates],
    ["Operating hours", form.content.operatingHours],
    ["Guest allocation", form.content.guestAllocation],
  ].filter(([, value]) => value.trim())

  const expiry = new Date(form.expiresAt).toLocaleString("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  })

  async function submit() {
    if (signerName.trim().length < 2) {
      setError("Enter your full name.")
      return
    }
    if (signerPosition.trim().length < 2) {
      setError("Enter your position.")
      return
    }
    const signatureDataUrl = padRef.current?.toDataURL() ?? ""
    if (!hasInk || !padRef.current?.hasInk() || !signatureDataUrl.startsWith("data:image/png")) {
      setError("Add your signature by drawing it or typing it.")
      return
    }
    if (!consent) {
      setError("Please confirm you accept these inclusions.")
      return
    }
    setSubmitting(true)
    setError("")
    try {
      const response = await fetch("/api/contracts/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          signerName: signerName.trim(),
          signerPosition: signerPosition.trim(),
          contentHash: form.contentHash,
          signatureDataUrl,
          consent: true,
        }),
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(payload.error || "Could not record your signature.")
      setSigned(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not record your signature.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#f3f3f3] px-4 py-8 text-[#010101] sm:px-6 lg:py-12">
      <div className="mx-auto max-w-4xl">
        <section className="rounded-xl border border-[#e5e5e5] bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-8 px-8 py-8 sm:px-10">
            <div>
              <Image
                src={LOGO_MAIN.src}
                alt="ZK Sports & Entertainment"
                width={LOGO_MAIN.width}
                height={LOGO_MAIN.height}
                className="h-10 w-auto"
                sizes="200px"
                priority
              />
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[#6b6b6b]">
                <LockKeyhole className="h-3.5 w-3.5" />
                Encrypted secure link · expires {expiry} UTC
              </div>
            </div>
            <div className="text-right text-xs leading-6 text-[#010101]">
              {BOOKING_SELLER.addressLines.map((line) => (
                <div key={line}>{line}</div>
              ))}
              <div>TRN {BOOKING_SELLER.trn}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-8 px-8 pb-4 sm:px-10">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: BRAND_RED }}>
                Contract N° {form.documentRef}
              </h1>
              <p className="mt-3 text-sm">Date : {isoDate(form.signedAt ?? form.createdAt)}</p>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold" style={{ color: BRAND_RED }}>
                BILL TO:
              </div>
              <div className="mt-2 space-y-0.5 text-sm leading-6">
                {form.companyName ? <div className="font-semibold">{form.companyName}</div> : null}
                {form.clientName ? <div className="font-semibold">{form.clientName}</div> : null}
                {form.clientEmail ? <div>{form.clientEmail}</div> : null}
              </div>
            </div>
          </div>

          <div className="px-8 py-8 sm:px-10">
            <h2 className="text-center text-base font-bold underline decoration-1 underline-offset-8">
              {form.title}
            </h2>

            {facts.length > 0 ? (
              <div className="mt-8 overflow-hidden rounded-md border border-[#e5e5e5]">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#f0f0f0] text-[#6b6b6b]">
                      <th className="border-r border-[#e5e5e5] px-4 py-3 text-left font-semibold">Item</th>
                      <th className="px-4 py-3 text-left font-semibold">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facts.map(([label, value]) => (
                      <tr key={label} className="border-t border-[#e5e5e5]">
                        <td className="w-[28%] border-r border-[#e5e5e5] px-4 py-4 font-medium">{label}</td>
                        <td className="px-4 py-4 leading-6">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="mt-10 space-y-6">
              {form.content.sections.map((section, index) => (
                <section key={section.id}>
                  <h3 className="text-sm font-bold">
                    {index + 1}. {section.heading}
                  </h3>
                  <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6">
                    {section.bullets.map((bullet, bulletIndex) => (
                      <li key={`${section.id}-${bulletIndex}`}>{bullet}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <div className="mt-12 grid gap-10 md:grid-cols-[1fr_280px] md:items-end">
              <p className="text-xs font-bold uppercase leading-6 tracking-wide">
                {form.content.confirmationIntro}
              </p>
              <div>
                {signed ? (
                  <div className="rounded-md border border-[#e5e5e5] bg-[#f7f7f7] p-4 text-center">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-[#010101]" />
                    <p className="mt-2 text-sm font-bold">Your signature is complete</p>
                    <p className="mt-1 text-xs leading-5 text-[#6b6b6b]">
                      {form.signerName || signerName
                        ? `${form.signerName || signerName}${form.signerPosition || signerPosition ? `, ${form.signerPosition || signerPosition}` : ""}. `
                        : ""}
                      ZK has been notified. A copy of the signed document has been sent by email.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs font-semibold text-[#6b6b6b]">Client signature</label>
                      <button
                        type="button"
                        onClick={() => padRef.current?.clear()}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6b6b6b] hover:text-[#010101]"
                      >
                        <Eraser className="h-3.5 w-3.5" /> Clear
                      </button>
                    </div>
                    <SignatureCapture
                      padRef={padRef}
                      disabled={signed}
                      typedName={signerName}
                      onHasInkChange={setHasInk}
                      className="mt-3 h-28 w-full border-b border-[#010101] bg-white"
                    />
                    <p className="mt-2 text-xs text-[#6b6b6b]">Date : {isoDate(new Date().toISOString())}</p>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-[#e5e5e5] px-8 py-8 sm:px-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Agreement documents</h2>
              <a
                href={`/api/contracts/${encodeURIComponent(token)}/document`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-[#d4d4d4] px-3 py-2 text-sm font-semibold hover:bg-[#f7f7f7]"
              >
                <Download className="h-4 w-4" />
                View PDF
              </a>
            </div>
          </div>

          {!signed ? (
            <div className="border-t border-[#e5e5e5] px-8 py-8 sm:px-10">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold" htmlFor="signer-name">
                  Full legal name
                  <input
                    id="signer-name"
                    value={signerName}
                    onChange={(event) => setSignerName(event.target.value)}
                    autoComplete="name"
                    maxLength={160}
                    className="mt-2 h-11 w-full rounded-md border border-[#d4d4d4] px-3 font-normal outline-none focus:border-[#F90202] focus:ring-2 focus:ring-[#F90202]/15"
                  />
                </label>
                <label className="block text-sm font-semibold" htmlFor="signer-position">
                  Position
                  <input
                    id="signer-position"
                    value={signerPosition}
                    onChange={(event) => setSignerPosition(event.target.value)}
                    autoComplete="organization-title"
                    maxLength={160}
                    className="mt-2 h-11 w-full rounded-md border border-[#d4d4d4] px-3 font-normal outline-none focus:border-[#F90202] focus:ring-2 focus:ring-[#F90202]/15"
                  />
                </label>
              </div>
              <label className="mt-5 flex items-start gap-3 text-sm leading-6 text-[#333]">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  className="mt-1 h-4 w-4 accent-[#F90202]"
                />
                <span>{CONTRACT_SIGNATURE_CONSENT}</span>
              </label>
              {error ? <p className="mt-4 text-sm font-semibold text-[#F90202]">{error}</p> : null}
              <button
                type="button"
                disabled={submitting}
                onClick={submit}
                className="mt-6 h-12 w-full rounded-md bg-[#010101] px-5 font-bold text-white hover:bg-[#222] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Recording secure signature…" : "Agree and sign"}
              </button>
            </div>
          ) : null}
        </section>
        <p className="mt-5 text-center text-xs leading-5 text-[#6b6b6b]">
          Do not forward this private signing link. Signature evidence includes the document
          snapshot, timestamp, IP address, and browser details.
        </p>
      </div>
    </main>
  )
}
