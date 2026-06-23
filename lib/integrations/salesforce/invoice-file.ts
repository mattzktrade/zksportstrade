import { salesforceQuery, salesforceRequest } from "@/lib/integrations/salesforce/client"
import { isSalesforceConfigured } from "@/lib/integrations/salesforce/config"
import { getSalesforceConnectionStatus } from "@/lib/integrations/salesforce/settings-store"

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function invoiceFileTitle(orderReference: string, xeroInvoiceNumber: string | null): string {
  const inv = xeroInvoiceNumber?.trim()
  return inv ? `Invoice ${inv} (${orderReference})` : `Invoice ${orderReference}`
}

async function opportunityAlreadyHasInvoiceFile(
  opportunityId: string,
  title: string,
): Promise<boolean> {
  const escTitle = escapeSoqlString(title)
  const rows = await salesforceQuery<{ ContentDocument?: { Title?: string } }>(
    `SELECT ContentDocument.Title FROM ContentDocumentLink WHERE LinkedEntityId = '${escapeSoqlString(opportunityId)}' AND ContentDocument.Title = '${escTitle}' LIMIT 1`,
  )
  return rows.length > 0
}

/**
 * Upload Xero invoice PDF to the Salesforce Opportunity Files related list.
 * Idempotent — skips if a file with the same title is already linked.
 */
export async function attachInvoicePdfToOpportunity(input: {
  opportunityId: string
  orderReference: string
  xeroInvoiceNumber: string | null
  pdf: ArrayBuffer
}): Promise<void> {
  if (!isSalesforceConfigured()) return
  const sf = await getSalesforceConnectionStatus()
  if (!sf.connected) return

  const title = invoiceFileTitle(input.orderReference, input.xeroInvoiceNumber)
  if (await opportunityAlreadyHasInvoiceFile(input.opportunityId, title)) return

  const pathOnClient = `${title.replace(/[^\w ().-]+/g, "-")}.pdf`
  const versionData = Buffer.from(input.pdf).toString("base64")

  await salesforceRequest<{ id: string }>("POST", "/sobjects/ContentVersion", {
    body: {
      Title: title,
      PathOnClient: pathOnClient,
      VersionData: versionData,
      FirstPublishLocationId: input.opportunityId,
    },
  })
}
