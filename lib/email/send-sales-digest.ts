import { Resend } from "resend"
import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { getResendApiKey, getResendFromAddress } from "@/lib/email/config"
import { adminEnquiryListPath } from "@/lib/crm/deal-pipeline"
import { DEFAULT_LEAD_TIMEZONE } from "@/lib/crm/lead-timezone"
import type { DigestItem, SalesDigest } from "@/lib/crm/sales-digest"

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

function dueText(dueAt: number, now: number): string {
  if (dueAt <= now) {
    const hours = Math.round((now - dueAt) / 3_600_000)
    if (hours < 1) return "due now"
    if (hours < 48) return `overdue ${hours} h`
    return `overdue ${Math.round(hours / 24)} days`
  }
  const time = new Date(dueAt).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DEFAULT_LEAD_TIMEZONE,
  })
  return `due ${time}`
}

const SECTIONS: ReadonlyArray<{ key: keyof SalesDigest; title: string; hint: string }> = [
  { key: "unclaimed", title: "New leads nobody has claimed", hint: "Log the first call to make it yours." },
  { key: "calls", title: "Your calls today", hint: "Log every call, answered or not, so the next one is scheduled." },
  { key: "nextSteps", title: "In conversation: next steps", hint: "Leads you're talking to with something booked for today." },
  { key: "followUps", title: "Deciding: follow-ups due", hint: "Leads with the price who need a check-in." },
]

export async function sendSalesDigest(input: {
  to: string
  firstName: string
  digest: SalesDigest
  inboxNeedsReply: number
  now: Date
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = getResendApiKey()
  const from = getResendFromAddress()
  if (!apiKey || !from) return { ok: false, error: "Email sender is not configured." }
  const origin = getServerSiteOrigin()
  const now = input.now.getTime()
  const total = SECTIONS.reduce((sum, section) => sum + input.digest[section.key].length, 0)
  const greeting = `Morning ${input.firstName || "team"}, here is your sales list for today.`

  const textLines: string[] = [greeting, ""]
  let html = `<p style="font:600 16px Arial,sans-serif;margin:0 0 4px">${escapeHtml(greeting)}</p>`
  if (input.inboxNeedsReply > 0) {
    const inbox = `${input.inboxNeedsReply} message${input.inboxNeedsReply === 1 ? "" : "s"} waiting for a reply in Sales → Inbox.`
    textLines.push(inbox, `${origin}/admin/assistant?view=needs_reply`, "")
    html += `<p style="font:14px Arial,sans-serif;margin:8px 0 0"><a href="${escapeHtml(`${origin}/admin/assistant?view=needs_reply`)}">${escapeHtml(inbox)}</a></p>`
  }

  for (const section of SECTIONS) {
    const rows: DigestItem[] = input.digest[section.key]
    if (rows.length === 0) continue
    textLines.push(`${section.title} (${rows.length})`)
    html += `<p style="font:600 14px Arial,sans-serif;margin:20px 0 2px;color:#F90202">${escapeHtml(section.title)} (${rows.length})</p>`
    html += `<p style="font:12px Arial,sans-serif;margin:0 0 8px;color:#777">${escapeHtml(section.hint)}</p>`
    for (const row of rows) {
      const link = `${origin}${adminEnquiryListPath(row.dealId)}`
      const detail = [row.task, row.interest, dueText(row.dueAt, now)].filter(Boolean).join(" · ")
      textLines.push(`- ${row.name} (${row.reference}): ${detail}${row.phone ? ` · ${row.phone}` : ""}`, `  ${link}`)
      html += `<p style="font:14px Arial,sans-serif;margin:0 0 8px"><a href="${escapeHtml(link)}" style="color:#111;font-weight:600">${escapeHtml(row.name)}</a> <span style="color:#777">${escapeHtml(row.reference)}</span><br><span style="color:#555">${escapeHtml(detail)}</span>${
        row.phone ? ` · <a href="tel:${escapeHtml(row.phone)}">${escapeHtml(row.phone)}</a>` : ""
      }</p>`
    }
    textLines.push("")
  }
  const listLink = `${origin}/admin/enquiries?view=calls`
  textLines.push(listLink)
  html += `<p style="margin:20px 0 0"><a href="${escapeHtml(listLink)}" style="display:inline-block;background:#F90202;color:#fff;font:600 14px Arial,sans-serif;padding:10px 16px;border-radius:6px;text-decoration:none">Open the call list</a></p>`

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from,
    to: [input.to],
    subject:
      total > 0
        ? `Today's sales list: ${total} to action`
        : `Today's sales list: ${input.inboxNeedsReply} waiting in Inbox`,
    html,
    text: textLines.join("\n"),
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}
