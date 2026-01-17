"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/portal-layout"
import { ChevronDown, Search, MessageSquare, Phone, Mail } from "lucide-react"
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
      <div className="p-8 space-y-8">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold text-foreground">Frequently Asked Questions</h1>
          <p className="text-muted-foreground mt-2">
            Find answers to common questions about bookings, payments, and our F1 hospitality packages
          </p>

          {/* Search */}
          <div className="relative mt-6">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search for answers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-card border border-border rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>
        </div>

        {/* FAQ Categories */}
        <div className="space-y-8 max-w-3xl mx-auto">
          {filteredFaqs.map((category) => (
            <div key={category.category}>
              <h2 className="text-lg font-semibold text-foreground mb-4">{category.category}</h2>
              <div className="space-y-3">
                {category.questions.map((faq, idx) => {
                  const id = `${category.category}-${idx}`
                  const isOpen = openItems.includes(id)

                  return (
                    <div key={id} className="bg-card border border-border rounded-2xl overflow-hidden">
                      <button
                        onClick={() => toggleItem(id)}
                        className="flex items-center justify-between w-full p-5 text-left"
                      >
                        <span className="font-medium text-foreground pr-4">{faq.q}</span>
                        <ChevronDown
                          className={cn(
                            "h-5 w-5 text-muted-foreground flex-shrink-0 transition-transform",
                            isOpen && "rotate-180",
                          )}
                        />
                      </button>
                      {isOpen && (
                        <div className="px-5 pb-5 pt-0">
                          <p className="text-muted-foreground leading-relaxed">{faq.a}</p>
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
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <Search className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No results found</h3>
            <p className="text-muted-foreground">Try a different search term or contact our support team</p>
          </div>
        )}

        {/* Contact Support */}
        <div className="bg-card border border-border rounded-2xl p-8 max-w-3xl mx-auto">
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold text-foreground">Still have questions?</h2>
            <p className="text-muted-foreground mt-1">Our support team is here to help</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <a
              href="#"
              className="flex flex-col items-center gap-3 p-5 bg-muted/50 rounded-xl hover:bg-muted transition-colors"
            >
              <div className="p-3 bg-primary/10 rounded-xl">
                <MessageSquare className="h-6 w-6 text-primary" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-foreground">Live Chat</p>
                <p className="text-sm text-muted-foreground">Chat with us now</p>
              </div>
            </a>

            <a
              href="tel:+441234567890"
              className="flex flex-col items-center gap-3 p-5 bg-muted/50 rounded-xl hover:bg-muted transition-colors"
            >
              <div className="p-3 bg-primary/10 rounded-xl">
                <Phone className="h-6 w-6 text-primary" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-foreground">Call Us</p>
                <p className="text-sm text-muted-foreground">+44 123 456 789</p>
              </div>
            </a>

            <a
              href="mailto:trade@zksports.com"
              className="flex flex-col items-center gap-3 p-5 bg-muted/50 rounded-xl hover:bg-muted transition-colors"
            >
              <div className="p-3 bg-primary/10 rounded-xl">
                <Mail className="h-6 w-6 text-primary" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-foreground">Email</p>
                <p className="text-sm text-muted-foreground">trade@zksports.com</p>
              </div>
            </a>
          </div>
        </div>
      </div>
    </PortalLayout>
  )
}
