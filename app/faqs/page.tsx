"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/portal-layout"
import { ChevronDown, Search, MessageCircle, Mail } from "lucide-react"
import { cn } from "@/lib/utils"

const faqs = [
  {
    category: "Booking Process",
    questions: [
      {
        q: "How do I make a booking for my client?",
        a: "Simply browse our packages, select the one you want, specify the number of guests, and proceed to checkout. You can choose to pay by invoice or card. Once confirmed, you'll receive a booking confirmation email.",
      },
      {
        q: "Can I modify a booking after it's confirmed?",
        a: "Yes, you can modify bookings up to 30 days before the event. Contact our support team for any changes to guest numbers, dates, or special requirements.",
      },
      {
        q: "What is the cancellation policy?",
        a: "Free cancellation is available up to 30 days before the event. Cancellations made 15-30 days before receive a 50% refund. No refunds are available for cancellations made less than 15 days before the event.",
      },
    ],
  },
  {
    category: "Payments & Commission",
    questions: [
      {
        q: "How does the commission structure work?",
        a: "Your commission rate is displayed on your dashboard. Commission is automatically calculated and shown in your booking summary. Payment is processed monthly for all completed bookings.",
      },
      {
        q: "When will I receive my commission?",
        a: "Commissions are paid out on the 15th of each month for all bookings where the event has taken place in the previous month. Payments are made via bank transfer.",
      },
      {
        q: "What payment methods are available?",
        a: "We accept invoice payments (Net 30) and card payments. For corporate clients, invoice payments are typically preferred. All payments are processed securely.",
      },
    ],
  },
  {
    category: "Packages & Experiences",
    questions: [
      {
        q: "What's included in the Paddock Club packages?",
        a: "Paddock Club packages include pit lane walks, paddock access, gourmet dining, open bar, driver appearances, and the best views of the track. Specific inclusions vary by circuit.",
      },
      {
        q: "Are transfers included in the packages?",
        a: "Standard packages do not include transfers. However, we can arrange premium transfer services for an additional fee. Contact us for a quote.",
      },
      {
        q: "Can I request special dietary requirements?",
        a: "Yes, all dietary requirements can be accommodated. Please specify these during the booking process or contact us at least 7 days before the event.",
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
    <PortalLayout>
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Frequently Asked Questions</h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-2">
            Find answers to common questions about bookings, payments, and our F1 hospitality packages
          </p>

          {/* Search */}
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

        {/* FAQ Categories */}
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
            <p className="text-sm sm:text-base text-muted-foreground">Try a different search term or contact our support team</p>
          </div>
        )}

        {/* Contact Support */}
        <div className="bg-card border border-border rounded-2xl p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
          <div className="text-center mb-4 sm:mb-6">
            <h2 className="text-lg sm:text-xl font-bold text-foreground">Still have questions?</h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">Our team is here to help</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 max-w-xl mx-auto">
            <a
              href="https://wa.me/441234567890"
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-2 sm:gap-3 p-4 sm:p-5 bg-muted/50 rounded-xl hover:bg-muted transition-colors"
            >
              <div className="p-2 sm:p-3 bg-primary/10 rounded-xl">
                <MessageCircle className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-sm sm:text-base font-semibold text-foreground">WhatsApp Us</p>
                <p className="text-xs sm:text-sm text-muted-foreground">+44 123 456 789</p>
              </div>
            </a>

            <a
              href="mailto:trade@zksports.com"
              className="flex flex-col items-center gap-2 sm:gap-3 p-4 sm:p-5 bg-muted/50 rounded-xl hover:bg-muted transition-colors"
            >
              <div className="p-2 sm:p-3 bg-primary/10 rounded-xl">
                <Mail className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-sm sm:text-base font-semibold text-foreground">Email</p>
                <p className="text-xs sm:text-sm text-muted-foreground">trade@zksports.com</p>
              </div>
            </a>
          </div>
        </div>
      </div>
    </PortalLayout>
  )
}
