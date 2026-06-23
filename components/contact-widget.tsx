"use client"

import { useState } from "react"
import { Mail, MessageCircle, X } from "lucide-react"
import { cn } from "@/lib/utils"

const WHATSAPP_NUMBER = "+44 7426 610346"
const WHATSAPP_LINK = "https://wa.me/447426610346"
const SUPPORT_EMAIL = "matt@zk-sports.com"

export function ContactWidget() {
  const [open, setOpen] = useState(false)

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open ? (
        <div className="w-[calc(100vw-2rem)] max-w-xs rounded-2xl border border-border bg-card p-4 shadow-xl">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Can't see what you're looking for?</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Contact us and we'll be able to help.</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Close contact options"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2">
            <a
              href={WHATSAPP_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-xl bg-muted/60 p-3 text-sm text-foreground transition hover:bg-muted"
            >
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <MessageCircle className="h-4 w-4" />
              </span>
              <span>
                <span className="block font-medium">WhatsApp</span>
                <span className="block text-xs text-muted-foreground">{WHATSAPP_NUMBER}</span>
              </span>
            </a>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="flex items-center gap-3 rounded-xl bg-muted/60 p-3 text-sm text-foreground transition hover:bg-muted"
            >
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <Mail className="h-4 w-4" />
              </span>
              <span>
                <span className="block font-medium">Email</span>
                <span className="block text-xs text-muted-foreground">{SUPPORT_EMAIL}</span>
              </span>
            </a>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition hover:bg-primary/90",
          open && "bg-foreground hover:bg-foreground/90",
        )}
        aria-expanded={open}
        aria-label="Open contact options"
      >
        <MessageCircle className="h-5 w-5" />
        <span>Contact us</span>
      </button>
    </div>
  )
}
