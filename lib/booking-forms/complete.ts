import { createAdminClient } from "@/lib/supabase/admin"
import { generateBookingFormPdf } from "@/lib/booking-forms/pdf"
import { uploadBookingDocument } from "@/lib/booking-forms/storage"
import { storedSignatureToPdf, type StoredBookingSignature } from "@/lib/booking-forms/signed-document"
import { snapshotClientCcEmails } from "@/lib/booking-forms/cc-emails"
import type { BookingFormSnapshot } from "@/lib/booking-forms/types"
import { sendCompletedBookingFormEmail } from "@/lib/email/send-booking-form"
import { ensureNativeDealOrderAndInvoice } from "@/lib/crm/deal-order-automation"
import { revalidateNativeBookingFormPages } from "@/lib/booking-forms/revalidate"
import { markDealSignedAfterZkCountersign } from "@/lib/booking-forms/advance-deal"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected booking-form error."
}

export async function completeZkSignedBookingForm(input: {
  bookingFormId: string
  adminEmail: string
  actorProfileId?: string | null
}): Promise<void> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")

  const { data: form, error: formError } = await admin
    .from("booking_forms")
    .select("id, deal_id, document_ref, status, snapshot_data")
    .eq("id", input.bookingFormId)
    .maybeSingle()
  if (formError || !form) throw new Error(formError?.message ?? "Booking form not found.")

  const status = String(form.status)
  if (status !== "zk_signed" && status !== "completed") {
    throw new Error("The ZK signature must be recorded before the agreement can be completed.")
  }

  const snapshot = form.snapshot_data as BookingFormSnapshot
  let finalPdf: Uint8Array | null = null
  let justFinalized = false

  if (status === "zk_signed") {
    const { data: signatures, error: signaturesError } = await admin
      .from("booking_form_signatures")
      .select(
        "signer_role, signer_name, signer_email, signature_path, signed_at, ip_address, location, user_agent, evidence_hash",
      )
      .eq("booking_form_id", form.id)
    if (signaturesError || !signatures) {
      throw new Error(signaturesError?.message ?? "Could not load signature evidence.")
    }
    const byRole = new Map(signatures.map((row) => [String(row.signer_role), row as StoredBookingSignature]))
    const clientRow = byRole.get("client")
    const adminRow = byRole.get("zk_admin")
    if (!clientRow || !adminRow) throw new Error("Both signatures are required.")

    const [clientSignature, adminSignature] = await Promise.all([
      storedSignatureToPdf(clientRow),
      storedSignatureToPdf(adminRow),
    ])
    finalPdf = await generateBookingFormPdf(snapshot, {
      client: clientSignature,
      zkAdmin: adminSignature,
    })
    const finalPath = `forms/${form.document_ref}/completed.pdf`
    await uploadBookingDocument(finalPath, finalPdf, "application/pdf", true)
    const now = new Date().toISOString()
    const { data: finalized, error: formUpdateError } = await admin
      .from("booking_forms")
      .update({
        status: "completed",
        final_pdf_path: finalPath,
        completed_at: now,
        updated_at: now,
      })
      .eq("id", form.id)
      .eq("status", "zk_signed")
      .select("id")
      .maybeSingle()
    if (formUpdateError) throw new Error(formUpdateError.message)
    if (finalized) {
      justFinalized = true
      const { error: eventError } = await admin.from("booking_form_events").insert({
        booking_form_id: form.id,
        event_type: "completed",
        actor_profile_id: input.actorProfileId ?? null,
        metadata: { final_pdf_path: finalPath },
      })
      if (eventError) throw new Error(eventError.message)
    }
  }

  await markDealSignedAfterZkCountersign(admin, String(form.deal_id))

  let invoiceWarning: string | null = null
  try {
    const orderResult = await ensureNativeDealOrderAndInvoice(String(form.deal_id))
    invoiceWarning = orderResult.warning ?? null
  } catch (automationError) {
    invoiceWarning = errorMessage(automationError)
    await admin
      .from("deals")
      .update({
        next_action: "Retry native order and Xero invoice creation",
        next_action_due_at: new Date().toISOString(),
      })
      .eq("id", form.deal_id)
  }

  let emailFailed: string | null = null
  if (justFinalized && finalPdf) {
    const email = await sendCompletedBookingFormEmail({
      clientEmail: snapshot.billTo.contactEmail,
      clientName: snapshot.billTo.contactName,
      adminEmail: input.adminEmail,
      documentRef: snapshot.documentRef,
      eventName: snapshot.deal.title,
      pdf: finalPdf,
      ccEmails: snapshotClientCcEmails(snapshot),
    })
    if (!email.ok) {
      emailFailed = email.error ?? email.skipped ?? "Completion email failed."
    }
  }

  const lastError = invoiceWarning
    ? `Order/invoice automation needs attention: ${invoiceWarning}`
    : emailFailed
  await admin.from("booking_forms").update({ last_error: lastError }).eq("id", form.id)
  revalidateNativeBookingFormPages(String(form.deal_id))
}
