"use client"

import { useState } from "react"
import { ChevronDown, Search, MessageCircle, Mail } from "lucide-react"
import { cn } from "@/lib/utils"

const WHATSAPP_NUMBER = "+44 7426 610346"
const WHATSAPP_LINK = "https://wa.me/447426610346"
const SUPPORT_EMAIL = "matt@zk-sports.com"

const faqs = [
  {
    category: "Getting started",
    questions: [
      {
        q: "Who is this portal for?",
        a: "The portal is for approved travel, concierge, and corporate hospitality agents booking F1 and related experiences for your own clients. Prices shown are trade rates — not retail. Your end client remains your customer unless we agree something different in writing.",
      },
      {
        q: "Can I update my profile or saved addresses?",
        a: "Yes. Open your profile from the menu (top right on mobile, or the sidebar on desktop). You can update your name, company, default shipping and billing addresses, and change your password. Saved addresses are pre-filled at checkout to speed up future bookings.",
      },
    ],
  },
  {
    category: "Browsing & booking",
    questions: [
      {
        q: "How do I make a booking?",
        a: "From the dashboard or All Packages, choose a race, then open a package. Select guest numbers and proceed to checkout. Enter your client’s details, any dietary or special requirements, and shipping/billing addresses. Accept the terms and submit. You will receive a booking confirmation email with your order reference, and the booking appears under My Bookings.",
      },
      {
        q: "Why can’t I book some packages online?",
        a: "Packages may be enquiry-only, sold out, or priced on request. In those cases the portal will not let you complete checkout — contact us and we will quote or hold stock for you where possible.",
      },
      {
        q: "How do I request a hold?",
        a: "In some circumstances we may be able to hold a package for you while you confirm with your client — contact us and we will see what we can do. When we place a hold on your behalf, seats are reserved for a limited period. You will see the active hold at checkout with an expiry date and time. Complete checkout before it expires to secure those seats; the booking uses your hold first against available inventory.",
      },
      {
        q: "What prices do I see?",
        a: "All prices in the portal are your trade rates in the currency shown on the package. The total at checkout is guests × trade price. We do not display retail pricing or commission splits here.",
      },
      {
        q: "Can I change or cancel a booking?",
        a: "You cannot change or cancel a booking yourself in the portal. Most bookings are non-cancellable and non-refundable once confirmed, in line with supplier and venue terms. Amendments or cancellations are only considered in exceptional circumstances and are never guaranteed — but contact us as soon as possible and we will try to accommodate where we can.",
      },
    ],
  },
  {
    category: "My bookings",
    questions: [
      {
        q: "Where do I see my bookings?",
        a: "Use My Bookings in the sidebar. You can search by reference, package, or client name, filter by payment status, and click a row to expand full details including reference, client, guest count, and amount.",
      },
      {
        q: "What does the payment status on a booking mean?",
        a: "Each booking shows a payment status: Awaiting invoice (booking received, invoice not yet issued), Awaiting payment (invoice sent, payment outstanding), or Paid. Use the payment filter on My Bookings. Status is updated by our team as your invoice progresses in Xero.",
      },
    ],
  },
  {
    category: "Payment",
    questions: [
      {
        q: "How does payment work?",
        a: "We do not take card payments through this portal. After you book, our finance team will contact you with payment terms — typically payment is due within seven calendar days unless we agree otherwise. Your official invoice will come from Xero separately.",
      },
      {
        q: "Where can I see payment status?",
        a: "Open My Bookings and use the payment status filter. Each row shows Awaiting invoice, Awaiting payment, or Paid for that booking reference.",
      },
      {
        q: "How do I know when payment has been received?",
        a: "When we record your payment, the booking will show as Paid. If you have paid but the portal still shows outstanding, contact us with your booking reference and payment details and we will update it.",
      },
    ],
  },
  {
    category: "Packages & on the day",
    questions: [
      {
        q: "What is included in a package?",
        a: "Inclusions vary by circuit and tier (Paddock Club, Champions Club, Legend, Hero, etc.). Open the package page for the description, gallery, and listed inclusions. If you need something confirmed before selling, ask us.",
      },
      {
        q: "Do you have imagery, PDFs, or videos I can share with my client?",
        a: "For some races we have created white-label brochures and videos you can send to your clients. Availability varies by event — check the package page for a downloadable brochure where provided, or contact us and we will share whatever marketing assets we have for that race.",
      },
      {
        q: "Can I request dietary requirements or accessibility needs?",
        a: "Yes. Enter dietary requirements and special requests at checkout. For changes after booking, contact us with as much notice as possible so we can pass them to the venue.",
      },
      {
        q: "Are transfers or hotels included?",
        a: "Standard packages usually cover hospitality at the circuit only. Transfers, accommodation, and extras can often be arranged for an additional fee — contact us for a quote.",
      },
      {
        q: "When will my client receive tickets or entry details?",
        a: "Delivery timing depends on the event and supplier. We will communicate ticket or accreditation details closer to the race via the contact details on the booking. If you have not heard from us within the timeframe we quoted, get in touch.",
      },
    ],
  },
]

export default function FAQsPage() {
  const [search, setSearch] = useState("")
  const [openItems, setOpenItems] = useState<string[]>([])

  const toggleItem = (id: string) => {
    setOpenItems((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]))
  }

  const filteredFaqs = faqs
    .map((category) => ({
      ...category,
      questions: category.questions.filter(
        (q) => q.q.toLowerCase().includes(search.toLowerCase()) || q.a.toLowerCase().includes(search.toLowerCase()),
      ),
    }))
    .filter((category) => category.questions.length > 0)

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8">
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Frequently Asked Questions</h1>
        <p className="text-sm sm:text-base text-muted-foreground mt-2">
          Practical answers for trade partners using the ZK Sports booking portal
        </p>

        <div className="relative mt-4 sm:mt-6">
          <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search for answers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 sm:pl-12 pr-4 py-3 sm:py-4 bg-card border border-border rounded-2xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>
      </div>

      <div className="space-y-6 sm:space-y-8 max-w-3xl mx-auto">
        {filteredFaqs.map((category) => (
          <div key={category.category}>
            <h2 className="text-base sm:text-lg font-semibold text-foreground mb-3 sm:mb-4">{category.category}</h2>
            <div className="space-y-2 sm:space-y-3">
              {category.questions.map((faq, idx) => {
                const id = `${category.category}-${idx}`
                const isOpen = openItems.includes(id)

                return (
                  <div key={id} className="bg-card border border-border rounded-2xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleItem(id)}
                      className="flex items-center justify-between w-full p-3 sm:p-4 lg:p-5 text-left"
                    >
                      <span className="text-sm sm:text-base font-medium text-foreground pr-3 sm:pr-4">{faq.q}</span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground flex-shrink-0 transition-transform",
                          isOpen && "rotate-180",
                        )}
                      />
                    </button>
                    {isOpen && (
                      <div className="px-3 sm:px-4 lg:px-5 pb-3 sm:pb-4 lg:pb-5 pt-0">
                        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {filteredFaqs.length === 0 && (
        <div className="text-center py-8 sm:py-12">
          <div className="w-12 h-12 sm:w-16 sm:h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground" />
          </div>
          <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2">No results found</h3>
          <p className="text-sm sm:text-base text-muted-foreground">
            Try a different search term or contact us using the details below
          </p>
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
        <div className="text-center mb-4 sm:mb-6">
          <h2 className="text-lg sm:text-xl font-bold text-foreground">Still have questions?</h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">Reach out and we will get back to you as soon as we can</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 max-w-xl mx-auto">
          <a
            href={WHATSAPP_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-2 sm:gap-3 p-4 sm:p-5 bg-muted/50 rounded-xl hover:bg-muted transition-colors"
          >
            <div className="p-2 sm:p-3 bg-primary/10 rounded-xl">
              <MessageCircle className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-sm sm:text-base font-semibold text-foreground">WhatsApp</p>
              <p className="text-xs sm:text-sm text-muted-foreground">{WHATSAPP_NUMBER}</p>
            </div>
          </a>

          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="flex flex-col items-center gap-2 sm:gap-3 p-4 sm:p-5 bg-muted/50 rounded-xl hover:bg-muted transition-colors"
          >
            <div className="p-2 sm:p-3 bg-primary/10 rounded-xl">
              <Mail className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-sm sm:text-base font-semibold text-foreground">Email</p>
              <p className="text-xs sm:text-sm text-muted-foreground break-all">{SUPPORT_EMAIL}</p>
            </div>
          </a>
        </div>
      </div>
    </div>
  )
}
