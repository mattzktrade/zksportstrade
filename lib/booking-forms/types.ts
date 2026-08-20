export type BookingFormStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "awaiting_zk_signature"
  | "zk_signed"
  | "completed"
  | "declined"
  | "expired"
  | "voided"
  | "failed"

export type BookingFormLineSnapshot = {
  dealLineItemId?: string
  packageId: string
  eventName: string
  packageName: string
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
  currency: string
  taxRate?: number
  taxAmountIncluded?: number
}

export type BookingFormSnapshot = {
  schemaVersion: 1
  template: {
    key: string
    version: number
    legalContentVersion: string
  }
  documentRef: string
  createdAt: string
  deal: {
    id: string
    title: string
  }
  seller: {
    legalName: string
    addressLines: string[]
    trn: string
  }
  billTo: {
    accountId: string
    accountName: string
    contactId: string
    contactName: string
    contactEmail: string
    addressLines: string[]
  }
  lines: BookingFormLineSnapshot[]
  currency: string
  subtotal: number
  taxRate: number
  taxAmountIncluded: number
  taxDescription?: string
  total: number
  paymentTerms: string
  paymentMethod: string
  bankDetails: Array<{
    currency: string
    recipient: string
    bank: string
    iban: string
    swift: string
  }>
  acknowledgement: string
  terms: Array<{
    heading: string
    paragraphs: string[]
  }>
}

export type BookingFormSignatureEvidence = {
  signerRole: "client" | "zk_admin"
  signerName: string
  signerEmail: string
  signaturePath: string
  signedAt: string
  ipAddress: string | null
  location: string | null
  userAgent: string | null
  evidenceHash: string
}

export type BookingFormAdminRow = {
  id: string
  deal_id: string
  document_ref: string
  revision: number
  status: BookingFormStatus
  client_name: string
  client_email: string
  sent_at: string | null
  first_viewed_at: string | null
  client_signed_at: string | null
  zk_signed_at: string | null
  completed_at: string | null
  client_token_expires_at: string
  reminder_count: number
  last_reminder_at: string | null
  last_error: string | null
  unsigned_pdf_path: string | null
  final_pdf_path: string | null
  created_at: string
}

export type BookingFormEventRow = {
  id: string
  booking_form_id: string
  event_type: string
  actor_email: string | null
  metadata: Record<string, unknown>
  created_at: string
}

