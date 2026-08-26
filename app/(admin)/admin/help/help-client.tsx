"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  BookOpen,
  BriefcaseBusiness,
  ChevronDown,
  CircleHelp,
  LayoutGrid,
  PackageSearch,
  Search,
  ShieldAlert,
  Warehouse,
  Wrench,
} from "lucide-react"
import { AdminPageHeader, AdminPanel } from "@/components/admin/admin-page-kit"
import { cn } from "@/lib/utils"
import {
  DEFAULT_HELP_TOPIC,
  HELP_TOPICS,
  isHelpTopicId,
  searchHelp,
  type HelpBlock,
  type HelpTopic,
  type HelpTopicId,
} from "@/lib/admin/help-guide"

const TOPIC_ICONS: Record<HelpTopicId, typeof BookOpen> = {
  start: BookOpen,
  pages: LayoutGrid,
  rules: ShieldAlert,
  sales: BriefcaseBusiness,
  inventory: Warehouse,
  portal: PackageSearch,
  "after-sale": Wrench,
  questions: CircleHelp,
}

function selectTopic(id: HelpTopicId) {
  if (typeof window === "undefined") return
  const url = new URL(window.location.href)
  url.hash = id
  window.history.replaceState(null, "", `${url.pathname}${url.search}#${id}`)
}

function HelpCallout({
  tone,
  title,
  text,
}: {
  tone: "tip" | "warn" | "info"
  title: string
  text: string
}) {
  const styles = {
    tip: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warn: "border-amber-200 bg-amber-50 text-amber-950",
    info: "border-[#eceef1] bg-[#fafbfc] text-[#25272b]",
  }
  return (
    <div className={cn("rounded-lg border px-4 py-3", styles[tone])}>
      <p className="text-[11px] font-semibold">{title}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-current/90">{text}</p>
    </div>
  )
}

function HelpQa({ items }: { items: Array<{ q: string; a: string }> }) {
  const [open, setOpen] = useState<string | null>(items[0]?.q ?? null)
  return (
    <div className="divide-y divide-[#f0f1f3] overflow-hidden rounded-lg border border-[#eceef1]">
      {items.map((item) => {
        const expanded = open === item.q
        return (
          <div key={item.q} className="bg-white">
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : item.q)}
              className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
            >
              <span className="text-[13px] font-medium text-[#18191c]">{item.q}</span>
              <ChevronDown
                className={cn("mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform", expanded && "rotate-180")}
              />
            </button>
            {expanded ? (
              <p className="px-4 pb-3 text-[12px] leading-relaxed text-[#5f636b]">{item.a}</p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function HelpBlocks({ blocks }: { blocks: HelpBlock[] }) {
  return (
    <div className="space-y-5">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`
        if (block.type === "p") {
          return (
            <p key={key} className="text-[13px] leading-relaxed text-[#3c4043]">
              {block.text}
            </p>
          )
        }
        if (block.type === "steps") {
          return (
            <div key={key}>
              {block.title ? (
                <h3 className="mb-3 text-[12px] font-semibold text-[#18191c]">{block.title}</h3>
              ) : null}
              <ol className="space-y-2.5">
                {block.items.map((item, step) => (
                  <li key={item} className="flex gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                      {step + 1}
                    </span>
                    <span className="text-[13px] leading-relaxed text-[#3c4043]">{item}</span>
                  </li>
                ))}
              </ol>
            </div>
          )
        }
        if (block.type === "bullets") {
          return (
            <div key={key}>
              {block.title ? (
                <h3 className="mb-2 text-[12px] font-semibold text-[#18191c]">{block.title}</h3>
              ) : null}
              <ul className="space-y-1.5">
                {block.items.map((item) => (
                  <li key={item} className="flex gap-2 text-[13px] leading-relaxed text-[#3c4043]">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        }
        if (block.type === "cards") {
          return (
            <div key={key}>
              {block.title ? (
                <h3 className="mb-3 text-[12px] font-semibold text-[#18191c]">{block.title}</h3>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                {block.items.map((item) => {
                  const inner = (
                    <>
                      <p className="text-[12px] font-semibold text-[#18191c]">{item.title}</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-[#5f636b]">{item.body}</p>
                    </>
                  )
                  const className =
                    "rounded-lg border border-[#eceef1] bg-[#fafbfc] px-3.5 py-3 text-left transition-colors hover:border-primary/30"
                  return item.href ? (
                    <Link key={item.title} href={item.href} className={className}>
                      {inner}
                    </Link>
                  ) : (
                    <div key={item.title} className={className}>
                      {inner}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        }
        if (block.type === "doDont") {
          return (
            <div key={key} className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-3">
                <p className="text-[11px] font-semibold text-emerald-800">Do this</p>
                <ul className="mt-2 space-y-2">
                  {block.do.map((item) => (
                    <li key={item} className="text-[12px] leading-relaxed text-emerald-950">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50/70 px-4 py-3">
                <p className="text-[11px] font-semibold text-red-800">Avoid this</p>
                <ul className="mt-2 space-y-2">
                  {block.dont.map((item) => (
                    <li key={item} className="text-[12px] leading-relaxed text-red-950">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )
        }
        if (block.type === "callout") {
          return <HelpCallout key={key} tone={block.tone} title={block.title} text={block.text} />
        }
        if (block.type === "roles") {
          return (
            <div key={key} className="grid gap-2 sm:grid-cols-2">
              {block.items.map((item) => (
                <div key={item.role} className="rounded-lg border border-[#eceef1] bg-white px-4 py-3">
                  <p className="text-[12px] font-semibold text-[#18191c]">{item.role}</p>
                  <ul className="mt-2 space-y-1.5">
                    {item.items.map((line) => (
                      <li key={line} className="text-[12px] leading-relaxed text-[#5f636b]">
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )
        }
        return <HelpQa key={key} items={block.items} />
      })}
    </div>
  )
}

export function HelpClient() {
  const [topicId, setTopicId] = useState<HelpTopicId>(DEFAULT_HELP_TOPIC)
  const [query, setQuery] = useState("")
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const applyHash = () => {
      const hash = window.location.hash.replace(/^#/, "")
      if (isHelpTopicId(hash)) setTopicId(hash)
    }
    applyHash()
    window.addEventListener("hashchange", applyHash)
    return () => window.removeEventListener("hashchange", applyHash)
  }, [])

  useEffect(() => {
    if (!query.trim()) return
    const { topics } = searchHelp(query)
    setTopicId((current) => {
      if (topics.some((item) => item.id === current)) return current
      return topics[0]?.id ?? current
    })
  }, [query])

  const results = useMemo(() => searchHelp(query), [query])
  const searching = query.trim().length > 0
  const navTopics = searching ? results.topics : HELP_TOPICS
  const topic: HelpTopic =
    HELP_TOPICS.find((item) => item.id === topicId) ?? HELP_TOPICS[0]

  function openTopic(id: HelpTopicId) {
    setTopicId(id)
    selectTopic(id)
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      contentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-3 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title="Help"
        description="Simple guides for using the ZK admin portal. Start here if you are new."
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search for deals, stock, invoices, holds…"
          className="h-10 w-full rounded-lg border border-[#e3e5e9] bg-white pl-10 pr-3 text-[13px] text-slate-800 outline-none placeholder:text-[#a0a3a9] focus:border-primary/40"
        />
      </div>

      {searching && results.questions.length > 0 ? (
        <AdminPanel>
          <div className="border-b border-[#eceef1] px-4 py-3">
            <p className="text-[11px] font-semibold text-[#25272b]">Matching questions</p>
          </div>
          <div className="divide-y divide-[#f0f1f3]">
            {results.questions.slice(0, 6).map((item) => (
              <button
                key={`${item.topicId}-${item.q}`}
                type="button"
                onClick={() => {
                  openTopic(item.topicId)
                  setQuery("")
                }}
                className="block w-full px-4 py-3 text-left hover:bg-slate-50"
              >
                <p className="text-[12px] font-medium text-[#18191c]">{item.q}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">{item.topicTitle}</p>
              </button>
            ))}
          </div>
        </AdminPanel>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto pb-1 lg:block lg:space-y-0.5 lg:overflow-visible lg:pb-0">
          {navTopics.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-slate-400">No matching guides.</p>
          ) : (
            navTopics.map((item) => {
              const active = item.id === topic.id
              const Icon = TOPIC_ICONS[item.id]
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openTopic(item.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] transition-colors",
                    active
                      ? "bg-white font-semibold text-[#18191c] shadow-sm ring-1 ring-[#eceef1]"
                      : "text-[#5f636b] hover:bg-white/80 hover:text-[#18191c]",
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5", active && "text-primary")} />
                  <span className="whitespace-nowrap">{item.nav}</span>
                </button>
              )
            })
          )}
        </nav>

        <AdminPanel className="min-w-0">
          <div ref={contentRef} className="scroll-mt-20 border-b border-[#eceef1] px-4 py-4 sm:px-5">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#18191c]">{topic.title}</h2>
            <p className="mt-1 text-[12px] text-[#80848d]">{topic.summary}</p>
          </div>
          <div className="px-4 py-5 sm:px-5">
            {searching && navTopics.length === 0 ? (
              <p className="text-[13px] text-slate-500">
                Nothing matched. Try “deal”, “hold”, or “invoice”.
              </p>
            ) : (
              <HelpBlocks blocks={topic.blocks} />
            )}
          </div>
        </AdminPanel>
      </div>

      <p className="px-1 pb-4 text-[11px] text-slate-400">
        This guide is for the ZK team. Trade partners have a separate FAQ inside the portal.
      </p>
    </div>
  )
}
