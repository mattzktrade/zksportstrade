export const HELP_TOPIC_IDS = [
  "start",
  "pages",
  "rules",
  "sales",
  "inventory",
  "portal",
  "after-sale",
  "questions",
] as const

export type HelpTopicId = (typeof HELP_TOPIC_IDS)[number]

export type HelpCard = {
  title: string
  body: string
  href?: string
}

export type HelpBlock =
  | { type: "p"; text: string }
  | { type: "steps"; title?: string; items: string[] }
  | { type: "bullets"; title?: string; items: string[] }
  | { type: "cards"; title?: string; items: HelpCard[] }
  | { type: "doDont"; do: string[]; dont: string[] }
  | { type: "callout"; tone: "tip" | "warn" | "info"; title: string; text: string }
  | { type: "roles"; items: Array<{ role: string; items: string[] }> }
  | { type: "qa"; items: Array<{ q: string; a: string }> }

export type HelpTopic = {
  id: HelpTopicId
  nav: string
  title: string
  summary: string
  keywords: string[]
  blocks: HelpBlock[]
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "start",
    nav: "Getting started",
    title: "Getting started",
    summary: "A short first-day guide. You do not need to learn every screen.",
    keywords: ["start", "onboarding", "login", "dashboard", "first day", "team", "how to", "begin", "search", "lead", "leads"],
    blocks: [
      {
        type: "p",
        text: "This is ZK’s office system. Use it for clients, stock, deals, invoices, and delivering tickets. The trade portal and website are still there — this admin area is for the ZK team.",
      },
      {
        type: "callout",
        tone: "info",
        title: "You can ignore most of it at first",
        text: "Open Dashboard, then use the pages for your job. If you are unsure, stop and ask — do not guess with stock, invoices, or cancellations.",
      },
      {
        type: "steps",
        title: "Your first ten minutes",
        items: [
          "Log in with the email and password you were given. You should land on Dashboard.",
          "Look at the coloured cards at the top. They are jobs waiting: new portal users, forms to sign, overdue invoices, and similar.",
          "Check “My tasks” if you have any. Those are deals assigned to you.",
          "Use the search bar at the top to jump to an order, client, contact, deal, or event. Click the result to open it.",
          "Use the left menu to move around. On a phone, open it with the menu button at the top left.",
          "Come back to Help whenever you need. Search at the top of this page for words like deal, hold, or invoice.",
        ],
      },
      {
        type: "cards",
        title: "The usual offline sale",
        items: [
          {
            title: "1. Find or add the client",
            body: "Sales → Accounts. Use the Leads tab for new people to contact. Search first so you do not create a second copy of the same company.",
            href: "/admin/leads",
          },
          {
            title: "2. Create the deal",
            body: "Inventory → Sales list. Pick the product, then Create deal. Add quantity and price.",
            href: "/admin/inventory/sales-list",
          },
          {
            title: "3. Prepare the booking form",
            body: "Open the deal and create the form. Sales and finance can save it and notify an admin. Only an admin can send it to the client. Stock is held for 7 days at that point, not when the form is saved.",
            href: "/admin/deals",
          },
          {
            title: "4. Both sides sign",
            body: "The client signs first. Then an admin or finance countersigns. After that the invoice is created in Xero automatically.",
          },
          {
            title: "5. Hand over",
            body: "Finance watches payment. Operations collects guests, suppliers, and delivery.",
            href: "/admin/operations",
          },
        ],
      },
      {
        type: "roles",
        items: [
          {
            role: "If you sell",
            items: [
              "Live in Accounts (Leads tab for new prospects), Sales list, and Deals.",
              "Create deals and holds. Prepare booking forms, then notify an admin to send them.",
              "Do not approve random portal users or change website visibility unless you mean to.",
            ],
          },
          {
            role: "If you fulfil",
            items: [
              "Live in Operations once a deal is signed.",
              "Request guests, assign the supplier, mark tickets ready, then delivered.",
              "Do not cancel paid orders from here.",
            ],
          },
          {
            role: "If you do finance",
            items: [
              "Live in Finance. Check awaiting payment and overdue.",
              "You can also create deals and accounts, manage stock, purchase orders, and suppliers, and run Operations.",
              "You can be a deal owner, and you can assign owners on deals and accounts.",
              "Invoices are created in Xero after both signatures (or after a portal/website booking).",
              "You can prepare and countersign booking forms; an admin must send them to the client.",
              "Settings, team logins, and integrations stay with an admin.",
              "Do not void invoices unless you intend to cancel the order and return the stock.",
            ],
          },
          {
            role: "If you look after the system",
            items: [
              "Settings is for team logins and Xero / website connections.",
              "Manage inventory, purchase orders, and what is live on the portal or website.",
              "CRM Imports is only for spreadsheet loads you have been asked to run.",
            ],
          },
        ],
      },
      {
        type: "callout",
        tone: "tip",
        title: "Salesforce is gone",
        text: "Day-to-day selling, stock, and fulfilment now happen here. You do not need Salesforce for new work. Historical deals from the old system are already in Accounts and Deals.",
      },
    ],
  },
  {
    id: "pages",
    nav: "What each page does",
    title: "What each page does",
    summary: "One-line explanations of the left menu, so you know where to click.",
    keywords: ["menu", "navigation", "pages", "what does", "where", "dashboard", "marketing"],
    blocks: [
      {
        type: "p",
        text: "If a name is greyed out, it is not built yet. Marketing is like that — skip it.",
      },
      {
        type: "cards",
        title: "Home",
        items: [
          {
            title: "Dashboard",
            body: "Your starting point. Team queues plus your own next actions. Click a card to open the real page.",
            href: "/admin",
          },
        ],
      },
      {
        type: "cards",
        title: "Portal — trade partners who log in",
        items: [
          {
            title: "Pending users",
            body: "People who registered for the trade portal and are waiting for approval. Only approve people you know.",
            href: "/admin/pending-users",
          },
          {
            title: "Paddock requests",
            body: "Bookings that need ZK approval (for example Paddock Club). Approve or reject here. Approving creates the booking.",
            href: "/admin/booking-requests",
          },
          {
            title: "Holds",
            body: "Temporary stock hold for an approved trade-portal agent. Different from a Sales list hold (see Stock).",
            href: "/admin/inventory",
          },
          {
            title: "Agents",
            body: "Approved portal logins — the people who can browse and book online. Not the same list as Sales → Accounts.",
            href: "/admin/agents",
          },
          {
            title: "Place order",
            body: "Book as if an approved agent checked out themselves. Creates a real order and invoice. Do not use this for a new offline client.",
            href: "/admin/place-order",
          },
        ],
      },
      {
        type: "cards",
        title: "Inventory — products and stock",
        items: [
          {
            title: "Sales list",
            body: "What we can sell. Open a product to create a deal, place a hold, or make a brochure.",
            href: "/admin/inventory/sales-list",
          },
          {
            title: "Negative stock list",
            body: "Sold (or sourced) places we have not bought yet. These must be purchased or they stay a problem.",
            href: "/admin/inventory/negative-stock",
          },
          {
            title: "Manage inventory",
            body: "Edit products, add stock, and control whether something is live on the portal or website.",
            href: "/admin/catalog",
          },
          {
            title: "Events",
            body: "Races and other events. Create the event first, then add products under it.",
            href: "/admin/catalog/events",
          },
          {
            title: "Purchase orders",
            body: "Stock we bought from suppliers. This is how available quantity goes up.",
            href: "/admin/purchase-orders",
          },
          {
            title: "Suppliers",
            body: "Who we buy from. Used on purchase orders and on sourced (brokered) deals.",
            href: "/admin/suppliers",
          },
        ],
      },
      {
        type: "cards",
        title: "Sales — clients and pipeline",
        items: [
          {
            title: "Accounts",
            body: "Companies and people. The Leads tab is who to contact next. Accounts and Contacts are the full directory.",
            href: "/admin/leads",
          },
          {
            title: "Deals",
            body: "Every sale in progress or won. Offline deals, portal bookings, and website orders all show up here. Ready to send is forms waiting for an admin to email the client.",
            href: "/admin/deals",
          },
          {
            title: "Sales tracker",
            body: "Revenue and profit by source (portal, offline, website, referral).",
            href: "/admin/sales-tracker",
          },
          {
            title: "CRM imports",
            body: "Spreadsheet loads from the old system. Leave this unless you have been asked to import a file.",
            href: "/admin/imports",
          },
        ],
      },
      {
        type: "cards",
        title: "After a sale",
        items: [
          {
            title: "Operations",
            body: "Confirmed work: guests, which supplier is fulfilling, and ticket delivery.",
            href: "/admin/operations",
          },
          {
            title: "Finance",
            body: "Invoices and payment. Overdue sits here so it is hard to miss. Ready to send is booking forms waiting for an admin to email the client.",
            href: "/admin/finance",
          },
        ],
      },
      {
        type: "cards",
        title: "Admin",
        items: [
          {
            title: "Help",
            body: "This guide.",
            href: "/admin/help",
          },
          {
            title: "Settings",
            body: "Team logins and connections to Xero and the website. Most people never need this.",
            href: "/admin/settings",
          },
        ],
      },
    ],
  },
  {
    id: "rules",
    nav: "Don’t mess this up",
    title: "Simple rules",
    summary: "A short list of habits that keep stock, clients, and invoices clean.",
    keywords: ["rules", "mistakes", "don't", "caution", "duplicate", "cancel", "delete", "website"],
    blocks: [
      {
        type: "p",
        text: "The system will block some dangerous actions. These rules catch the ones it cannot.",
      },
      {
        type: "doDont",
        do: [
          "Search for a company or contact before creating a new one.",
          "Double-check product, quantity, and price before saving a booking form.",
          "Use Deals for phone / WhatsApp / email sales.",
          "Ask before ticking Live on website — that publishes to zk-sports.com.",
          "Stop and ask if stock numbers look wrong, rather than typing a fix.",
        ],
        dont: [
          "Do not use Place order for a client who is not an approved portal agent.",
          "Do not delete a product that has already been sold. Hide it instead.",
          "Do not cancel a signed deal or void a Xero invoice unless finance agrees.",
          "Do not run CRM Imports “to see what happens”.",
          "Do not create a second deal for the same booking if one already exists.",
        ],
      },
      {
        type: "callout",
        tone: "warn",
        title: "After both signatures, the places are sold",
        text: "Even if the invoice is still unpaid, signed stock is taken from what we own. Changing quantity or product after that is a real stock move. If the form is still unsigned, you can void it and the 7-day hold is released.",
      },
      {
        type: "bullets",
        title: "Two different holds",
        items: [
          "Sales list → Place hold: for any client in Accounts. Lasts 7 days. Use this for offline holds.",
          "Portal → Holds: only for an approved trade-portal agent. Use this when an agent asks you to hold while they confirm with their client.",
        ],
      },
      {
        type: "bullets",
        title: "Sourced stock (we do not own it yet)",
        items: [
          "You can still create the deal. Mark the line as brokered and enter the supplier, buy price, and quote time.",
          "The supplier quote must be from the last 24 hours before you hold stock or an admin sends the booking form.",
          "It will appear on Negative stock list until we buy it.",
        ],
      },
    ],
  },
  {
    id: "sales",
    nav: "Selling",
    title: "Selling",
    summary: "Accounts, leads, deals, booking forms, and the pipeline.",
    keywords: ["deal", "deals", "account", "contact", "lead", "leads", "booking form", "sign", "pipeline", "enquiry", "price", "ready to send", "brochure", "pdf", "marketing"],
    blocks: [
      {
        type: "p",
        text: "A deal is the sale record. An order is created after both people have signed (offline) or after checkout (portal / website). You work from the deal either way.",
      },
      {
        type: "bullets",
        title: "Leads, accounts, and deals",
        items: [
          "Sales → Accounts is the directory. The Leads tab is the work queue for prospects who have not booked yet.",
          "New accounts and bulk uploads start as New. Move them to Reach out, Talking, or Later (keep for marketing).",
          "When they sign a booking or place an order, they become a Client and leave the Leads tab. Deals is still the booking pipeline.",
          "A new person at a company that already buys from us is just a contact — not a new lead.",
        ],
      },
      {
        type: "cards",
        title: "Start from the right place",
        items: [
          {
            title: "New offline client",
            body: "Accounts first (or create the company while you make the deal). Then Sales list → Create deal.",
            href: "/admin/leads",
          },
          {
            title: "They need time to decide",
            body: "Sales list → Place hold. Stock is held for 7 days, then it comes back unless you extend it.",
            href: "/admin/inventory/sales-list",
          },
          {
            title: "Approved agent wants you to book for them",
            body: "Portal → Place order. This is a real portal booking, not an offline deal.",
            href: "/admin/place-order",
          },
        ],
      },
      {
        type: "steps",
        title: "Create an offline deal",
        items: [
          "Open Sales list and click the product.",
          "Choose Create deal. Search for the company or a person — companies that start with what you typed appear first, and you can pick a contact in the same list. Only create a new account if it is not there.",
          "Add the contact, quantity, and sale price. You can add more than one product, including from different events.",
          "Optional: tick Reserve stock for 7 days if you need to lock places before the form goes out.",
          "Save, then open the deal from Sales → Deals to prepare the booking form.",
        ],
      },
      {
        type: "steps",
        title: "Send a product brochure",
        items: [
          "Open Sales list and click the product the client is interested in.",
          "If it already has a brochure, download that PDF and send it.",
          "If not, click Create brochure. It builds a ZK-branded PDF from the product photos, description, and inclusions.",
          "Send that file to the client. Portal clients cannot create brochures — only the ZK team can.",
          "If you change the photos or copy later, use Recreate brochure so the PDF stays current.",
        ],
      },
      {
        type: "steps",
        title: "Booking form",
        items: [
          "The deal needs a company, a contact with an email, and at least one product.",
          "Create or edit the form, then save it. The deal moves to Ready to send. Stock is not held yet.",
          "Sales and finance can notify Ollie, Michel, and Matt that it is ready. Only an admin can send it to the client — that send holds stock for 7 days.",
          "The client signs first. Then an admin or finance countersigns.",
          "When both have signed, the order is created and the Xero invoice is sent. You do not raise the invoice by hand.",
          "If they have not signed after 7 days, the form expires and held stock is released. You can void a form earlier if the deal is off.",
        ],
      },
      {
        type: "bullets",
        title: "Pipeline columns (the simplified view)",
        items: [
          "Enquiry — just created, or we are still sourcing.",
          "Price sent — quote is with the client.",
          "Ready to send — form is saved, waiting for an admin to email the client.",
          "Booking form — form sent, waiting for the client or for ZK to sign.",
          "Awaiting payment — signed (or invoiced), money not in yet.",
          "Won — paid.",
          "Lost — closed lost or cancelled.",
        ],
      },
      {
        type: "callout",
        tone: "tip",
        title: "Editing a deal",
        text: "You can fix company, contact, products, and prices while the deal is still open. After a booking form is sent, void the form before changing the commercial details. After an order exists, do not delete the deal.",
      },
      {
        type: "qa",
        items: [
          {
            q: "What is the difference between Accounts and Agents?",
            a: "Accounts is everyone we sell to (companies and people). Agents is only people with an approved trade-portal login.",
          },
          {
            q: "What is the Leads tab?",
            a: "It is the list of companies and people who have not booked yet. Work New and Reach out first. Later is for people to keep for marketing. A signed booking or order marks them as a client automatically.",
          },
          {
            q: "A portal or website booking appeared as a deal. Did I do something wrong?",
            a: "No. Every confirmed sale gets a deal so the team works from one list. The invoice is not created twice.",
          },
        ],
      },
    ],
  },
  {
    id: "inventory",
    nav: "Stock",
    title: "Stock",
    summary: "What we can sell, what we have bought, and what we still need to buy.",
    keywords: [
      "stock",
      "inventory",
      "available",
      "bought",
      "sold",
      "hold",
      "purchase",
      "supplier",
      "negative",
      "product",
      "event",
    ],
    blocks: [
      {
        type: "p",
        text: "One product can be bought from several suppliers. The customer still sees one package. Available is roughly: bought, minus sold, minus holds.",
      },
      {
        type: "cards",
        title: "The numbers you will see",
        items: [
          { title: "Bought", body: "Places we have recorded as purchased from suppliers." },
          { title: "Available", body: "Places we can still sell on the portal, website, or a new deal." },
          { title: "Reserved / Held", body: "Temporary. A hold or an unsigned booking form. Comes back if it expires." },
          { title: "Committed / Sold", body: "Signed or booked. These places are no longer for sale." },
        ],
      },
      {
        type: "steps",
        title: "Add stock we have bought",
        items: [
          "Open Manage inventory, click the product, then Add stock — or create a purchase order.",
          "Enter supplier, quantity, and unit cost. This is what profit reporting uses, so the cost matters.",
          "Available should go up. If it does not, refresh and check you added it to the right product and year.",
        ],
      },
      {
        type: "steps",
        title: "Put a product on sale",
        items: [
          "Create the Event if it does not exist (include the year, for example 2026).",
          "Create the product under that event with name, price, and description.",
          "Add purchased stock so Available is not zero.",
          "Tick Live on agent portal if trade partners should see it.",
          "Tick Live on website only if it should appear on zk-sports.com. Ask first if you are unsure.",
        ],
      },
      {
        type: "callout",
        tone: "warn",
        title: "Negative stock is a to-do, not a selling figure",
        text: "If we sold places we have not bought, they show on Negative stock list. They do not appear as available on the portal or website. Buy the stock (purchase order) and the shortage should clear.",
      },
      {
        type: "qa",
        items: [
          {
            q: "Can I sell Friday-only or two-day from a three-day allocation?",
            a: "Yes, where we have set the product up that way. Those options share the same physical stock. You do not create a second pile of tickets.",
          },
          {
            q: "I reduced a purchase and it would not save.",
            a: "You cannot take purchased quantity below what is already sold or held. Release or reassign those places first.",
          },
        ],
      },
    ],
  },
  {
    id: "portal",
    nav: "Trade portal",
    title: "Trade portal",
    summary: "Approvals, agent bookings, and portal holds.",
    keywords: ["agent", "portal", "pending", "paddock", "place order", "approve", "user", "registration"],
    blocks: [
      {
        type: "p",
        text: "The trade portal is what approved partners see. They browse packages, check out, and get a Xero invoice. Checkout terms count as the booking form — they do not sign a separate ZK form.",
      },
      {
        type: "steps",
        title: "Approve a new portal user",
        items: [
          "Open Portal → Pending users.",
          "Only approve people you recognise as a real trade partner.",
          "Once approved, they appear under Agents and can log in.",
        ],
      },
      {
        type: "bullets",
        title: "Paddock requests",
        items: [
          "Some packages cannot be booked instantly. The agent submits a request instead.",
          "You approve or reject it. Approving creates the booking and emails the agent.",
          "If more than one supplier can cover the party, pick the one you want before you approve.",
        ],
      },
      {
        type: "callout",
        tone: "warn",
        title: "Place order is a real booking",
        text: "Portal → Place order books as that agent. Stock comes off and an invoice is created, same as if they checked out. Use Deals if the client is not booking through the portal.",
      },
      {
        type: "qa",
        items: [
          {
            q: "An agent asked me to hold stock.",
            a: "Use Portal → Holds and pick that agent. For someone who is not a portal user, use Sales list → Place hold instead.",
          },
        ],
      },
    ],
  },
  {
    id: "after-sale",
    nav: "After the sale",
    title: "After the sale",
    summary: "Guests, suppliers, delivery, invoices, and payment.",
    keywords: ["operations", "finance", "invoice", "xero", "payment", "overdue", "guests", "delivery", "tickets"],
    blocks: [
      {
        type: "p",
        text: "Once a deal is signed (or a portal / website booking is confirmed), Operations and Finance take over. Sales can still open the deal to see what happened.",
      },
      {
        type: "cards",
        title: "Operations",
        items: [
          {
            title: "Awaiting guests",
            body: "Send the guest request (you can preview the email), then enter names when they come back.",
            href: "/admin/operations",
          },
          {
            title: "Supplier",
            body: "The system prefers one supplier for the whole party when leftover stock allows. Change it only if you need to.",
          },
          {
            title: "Delivery",
            body: "Not ready → Ready → Delivered. Mark delivered when tickets or proof have actually gone.",
          },
        ],
      },
      {
        type: "cards",
        title: "Finance",
        items: [
          {
            title: "Awaiting payment",
            body: "Invoice exists, money not in. Reminders go out automatically.",
            href: "/admin/finance",
          },
          {
            title: "Overdue",
            body: "Still unpaid past the due date. Chase from here. Do not ignore this list.",
          },
          {
            title: "Paid",
            body: "Usually updates on its own when Xero receives payment. You can mark paid only if you know the money is in.",
          },
        ],
      },
      {
        type: "callout",
        tone: "warn",
        title: "Cancelling after an invoice exists",
        text: "This voids the Xero invoice and puts stock back. Only finance or an admin should do it, and only with a reason. If the event is close, ask before you touch it.",
      },
      {
        type: "qa",
        items: [
          {
            q: "The invoice did not appear.",
            a: "Open the deal and check the finance panel. If signing only just finished, wait a minute and refresh. If it still fails, an admin can retry from the deal. Do not create a second invoice in Xero by hand.",
          },
          {
            q: "This sale was billed on the old system.",
            a: "Imported won deals may have no portal order and no Xero invoice here. That is expected. Do not try to invoice them again.",
          },
        ],
      },
    ],
  },
  {
    id: "questions",
    nav: "Common questions",
    title: "Common questions",
    summary: "Short answers to the things people usually ask.",
    keywords: ["faq", "help", "why", "how", "password", "login", "error", "stock wrong", "brochure"],
    blocks: [
      {
        type: "qa",
        items: [
          {
            q: "I cannot see a page that is in this guide.",
            a: "Your login has a role: Sales, Finance, or Admin. Finance cannot change Settings or integrations. Sales cannot either. If you need access, ask an admin.",
          },
          {
            q: "Where do I change my password?",
            a: "Ask an admin. They can set a new password in Settings → Team. Do not share logins.",
          },
          {
            q: "The client has not signed.",
            a: "If the form is still in Ready to send, an admin still needs to email it. If it has already gone out, ask an admin to resend it. After 7 days the form expires and held stock comes back. You can void it sooner if the deal is dead.",
          },
          {
            q: "How do I make a brochure for a product?",
            a: "Sales list → click the product → Create brochure. It uses the photos and copy already on the product. Only the ZK team can do this, not portal clients. If a brochure is already attached, download it, or recreate it after you change the listing.",
          },
          {
            q: "Available stock looks too low / too high.",
            a: "Check Sales list for holds, then Deals for signed sales, then Purchase orders for what we actually bought. Do not type a new total over the top. If it still looks wrong, ask before changing anything.",
          },
          {
            q: "I created the same company twice.",
            a: "Stop using the duplicate. Open the original Account and work from there. Ask an admin if you need the extra record cleaned up — do not keep selling on both.",
          },
          {
            q: "Can I change price after the form is sent?",
            a: "Void the unsigned form first, edit the deal, save a new form, then ask an admin to send it. Do not edit a signed document.",
          },
          {
            q: "I prepared a booking form but cannot send it.",
            a: "Only an admin can send it to the client. Use Notify admins to send so Ollie, Michel, and Matt get an email. The deal stays in Ready to send on the dashboard until they send it.",
          },
          {
            q: "What currency are we in?",
            a: "Deals and invoices are in USD. Xero bills the agent company. Abu Dhabi uses the existing 5% tax-inclusive setup; other events are 0% VAT.",
          },
          {
            q: "Something in Settings or Integrations looks disconnected.",
            a: "Leave it. Ask Matt or an admin. Reconnecting Xero or the website in the wrong way can stop invoices or listings.",
          },
        ],
      },
      {
        type: "callout",
        tone: "info",
        title: "Still stuck?",
        text: "Ask in the team chat before you click anything irreversible. For a login issue, email matt@zk-sports.com.",
      },
    ],
  },
]

export const DEFAULT_HELP_TOPIC: HelpTopicId = "start"

export function isHelpTopicId(value: string): value is HelpTopicId {
  return (HELP_TOPIC_IDS as readonly string[]).includes(value)
}

function blockSearchText(block: HelpBlock): string {
  switch (block.type) {
    case "p":
      return block.text
    case "steps":
    case "bullets":
      return [block.title, ...block.items].filter(Boolean).join(" ")
    case "cards":
      return [
        block.title,
        ...block.items.flatMap((item) => [item.title, item.body]),
      ]
        .filter(Boolean)
        .join(" ")
    case "doDont":
      return [...block.do, ...block.dont].join(" ")
    case "callout":
      return `${block.title} ${block.text}`
    case "roles":
      return block.items.flatMap((item) => [item.role, ...item.items]).join(" ")
    case "qa":
      return block.items.flatMap((item) => [item.q, item.a]).join(" ")
  }
}

export function topicSearchText(topic: HelpTopic): string {
  return [
    topic.nav,
    topic.title,
    topic.summary,
    ...topic.keywords,
    ...topic.blocks.map(blockSearchText),
  ]
    .join(" ")
    .toLowerCase()
}

export type HelpQuestionHit = {
  topicId: HelpTopicId
  topicTitle: string
  q: string
  a: string
}

export function searchHelp(query: string): {
  topics: HelpTopic[]
  questions: HelpQuestionHit[]
} {
  const needle = query.trim().toLowerCase()
  if (!needle) return { topics: HELP_TOPICS, questions: [] }

  const topics = HELP_TOPICS.filter((topic) => topicSearchText(topic).includes(needle))
  const questions: HelpQuestionHit[] = []
  for (const topic of HELP_TOPICS) {
    for (const block of topic.blocks) {
      if (block.type !== "qa") continue
      for (const item of block.items) {
        if (`${item.q} ${item.a}`.toLowerCase().includes(needle)) {
          questions.push({
            topicId: topic.id,
            topicTitle: topic.title,
            q: item.q,
            a: item.a,
          })
        }
      }
    }
  }
  return { topics, questions }
}
