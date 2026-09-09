import { MARKETING_LEAD_WEBHOOK_PATH, MARKETING_LEAD_PRODUCTION_URL } from "./config"

export const MARKETING_LEAD_EXAMPLE_PAYLOAD = {
  leadId: "meta-leadgen-id",
  createdAt: "2026-09-09T09:00:00Z",
  campaign: {
    name: "Monaco GP 2026",
    id: "120000000000000000",
    adsetName: "UK lookalike",
    formName: "Monaco hospitality",
  },
  contact: {
    fullName: "Jane Smith",
    email: "jane@example.com",
    phone: "+447900000000",
  },
  interest: {
    package: "Monaco GP Hospitality",
    quantity: 4,
    event: "Monaco GP",
  },
  answers: [
    { question: "When do you need tickets?", answer: "Race weekend" },
  ],
  consent: {
    marketingOptIn: true,
    privacyPolicyUrl: "https://zk-sports.com/privacy",
  },
} as const

export const MARKETING_LEAD_AGENCY_QUESTIONS: Array<{ heading: string; items: string[] }> = [
  {
    heading: "Ownership and access",
    items: [
      "Who owns the Meta Business Manager, Page, ad account, and Instant Forms? Can you keep owning them and only push leads to us?",
      "How many Pages / ad accounts / forms are live, and do new campaigns get new forms?",
      "Are leads Instant Forms only, or also landing-page forms?",
    ],
  },
  {
    heading: "Current spreadsheet pipeline",
    items: [
      "What writes the sheet today (native Meta → Google Sheets, Zapier, Make, HubSpot, something else)?",
      "Typical delay from form submit to a new sheet row?",
      "Can that same automation POST JSON to a HTTPS webhook we host, with a shared secret header, instead of (or as well as) the sheet?",
      "Can you include Meta’s Lead ID on every row / payload so we can de-dupe?",
    ],
  },
  {
    heading: "Form fields",
    items: [
      "Exact questions on each live Instant Form (screenshot or CSV of field keys).",
      "Which fields are always present vs campaign-specific?",
      "How is package / event interest captured (dropdown of our product names, free text, event only)?",
      "How is ticket quantity captured (number, dropdown, not asked)?",
      "Name: one field or first + last? Phone: country code? Email always required?",
      "Any extra questions (budget, dates, company, country, how they heard of us)?",
      "Please send 5–10 anonymised real rows from the current sheet plus the column headers.",
    ],
  },
  {
    heading: "Delivery contract",
    items: [
      "Can you POST within about one minute of Meta accepting the lead?",
      "Can you retry on HTTP 5xx and treat HTTP 200 with { \"duplicate\": true } as success?",
      "Who on your side owns the Zap if it breaks? How do we get alerted?",
      "Will you keep the spreadsheet as a backup, or switch fully to the webhook?",
    ],
  },
  {
    heading: "Quality and duplicates",
    items: [
      "Do test / preview leads from Meta’s Testing Tool get into the same sheet? How are they flagged?",
      "Same person, two campaigns: two rows or one? We create one CRM person (match email) and a new enquiry per lead id.",
      "Any existing suppression / unsubscribe list we must honour?",
    ],
  },
  {
    heading: "Legal / consent",
    items: [
      "Instant Form privacy policy URL and custom disclaimer text?",
      "Is there a separate marketing-email opt-in question, or only Meta’s lead-ads consent?",
      "Any geo we must not store or must process under a DPA (UK/EU vs rest of world)?",
      "Are you the data controller for the ads, and will you remain so if we only receive the webhook?",
    ],
  },
  {
    heading: "Catalog matching (optional)",
    items: [
      "Can form package options be locked to a list we supply (our product names), instead of free text?",
      "If yes, send the current option list so we can map it to catalog IDs.",
    ],
  },
  {
    heading: "Go-live",
    items: [
      "Earliest date you can point a staging Zap at our URL?",
      "Need a backfill of the existing spreadsheet into Enquiries, or live-from-now only?",
    ],
  },
]

export function marketingLeadCurlExample(secretPlaceholder = "YOUR_WEBHOOK_SECRET"): string {
  const body = JSON.stringify(MARKETING_LEAD_EXAMPLE_PAYLOAD, null, 2)
  return [
    `curl -X POST ${MARKETING_LEAD_PRODUCTION_URL} ^`,
    `  -H "Content-Type: application/json" ^`,
    `  -H "x-webhook-secret: ${secretPlaceholder}" ^`,
    `  -d @lead.json`,
    "",
    `Path: POST ${MARKETING_LEAD_WEBHOOK_PATH}`,
    "Auth: x-webhook-secret, x-marketing-webhook-secret, Authorization: Bearer, or HMAC x-webhook-signature",
  ].join("\n")
}
