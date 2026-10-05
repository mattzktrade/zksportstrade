"use client"

import { useState } from "react"
import Link from "next/link"
import { Plus } from "lucide-react"
import {
  AdminDesktopTable,
  AdminMobileList,
  AdminPageHeader,
  AdminPanel,
  StatusPill,
} from "@/components/admin/admin-page-kit"
import { contractLinkExpired, contractStatusLabel } from "@/lib/contracts/content"
import type { BookingFormRegisterItem, InclusionContractListItem } from "@/lib/contracts/queries"

const BOOKING_STATUS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Opened",
  awaiting_zk_signature: "Client signed",
  zk_signed: "Completing",
  completed: "Completed",
  declined: "Declined",
  expired: "Expired",
  voided: "Voided",
  failed: "Failed",
}

function when(value: string | null): string {
  if (!value) return "—"
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function contractTone(status: string, expiresAt: string | null): "green" | "amber" | "blue" | "gray" | "red" {
  if (contractLinkExpired(status, expiresAt)) return "amber"
  if (status === "signed") return "green"
  if (status === "sent" || status === "viewed") return "blue"
  if (status === "declined") return "red"
  return "gray"
}

export function ContractsClient({
  contracts,
  bookingForms,
  unavailable,
  canManage,
}: {
  contracts: InclusionContractListItem[]
  bookingForms: BookingFormRegisterItem[]
  unavailable: boolean
  canManage: boolean
}) {
  const [tab, setTab] = useState<"contracts" | "booking-forms">("contracts")
  const [filter, setFilter] = useState<"all" | "draft" | "waiting" | "signed">("all")
  const [query, setQuery] = useState("")

  const visibleContracts = contracts.filter((row) => {
    if (filter === "draft" && row.status !== "draft") return false
    if (filter === "signed" && row.status !== "signed") return false
    if (filter === "waiting" && row.status !== "sent" && row.status !== "viewed") return false
    const haystack = [row.title, row.companyName, row.clientName, row.clientEmail, row.eventName, row.documentRef, row.dealReference]
      .join(" ")
      .toLowerCase()
    return haystack.includes(query.trim().toLowerCase())
  })

  const visibleForms = bookingForms.filter((row) => {
    const haystack = [row.documentRef, row.clientName, row.clientEmail, row.dealReference, row.status].join(" ").toLowerCase()
    return haystack.includes(query.trim().toLowerCase())
  })

  return (
    <div className="mx-auto max-w-[1540px] space-y-3 p-3 sm:p-5 lg:p-7">
      <AdminPageHeader
        title="Contracts"
        action={
          canManage ? (
            <Link
              href="/admin/contracts/new"
              className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-[10px] font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" /> New contract
            </Link>
          ) : null
        }
      />

      {unavailable ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          The contracts database is not ready yet. Apply the latest migration, then refresh this page.
        </div>
      ) : null}

      <AdminPanel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#eceef1] px-3 py-3">
          <div className="flex flex-wrap gap-1">
            <TabButton active={tab === "contracts"} onClick={() => setTab("contracts")}>
              Contracts
            </TabButton>
            <TabButton active={tab === "booking-forms"} onClick={() => setTab("booking-forms")}>
              Booking forms
            </TabButton>
          </div>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tab === "contracts" ? "Search contracts…" : "Search booking forms…"}
            className="h-8 min-w-0 flex-1 rounded-md border border-[#e5e7eb] px-3 text-[10px] outline-none placeholder:text-[#a0a3a9] focus:border-primary/40 sm:max-w-[280px]"
          />
          {tab === "contracts" ? (
            <div className="flex flex-wrap gap-1 sm:ml-auto">
              {(
                [
                  ["all", "All"],
                  ["draft", "Drafts"],
                  ["waiting", "Waiting"],
                  ["signed", "Signed"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={`h-8 rounded-md px-3 text-[10px] font-medium ${
                    filter === id
                      ? "border border-primary bg-red-50 text-primary"
                      : "border border-[#e5e7eb] bg-white text-[#5f636b] hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {tab === "contracts" ? (
          <>
            <AdminDesktopTable>
              <table className="w-full text-left text-sm">
                <thead className="text-[10px] text-[#80848d]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Contract</th>
                    <th className="px-4 py-3 font-medium">Client</th>
                    <th className="px-4 py-3 font-medium">Event</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleContracts.map((row) => (
                    <tr key={row.id} className="border-t border-[#f0f1f3]">
                      <td className="px-4 py-3">
                        <Link href={`/admin/contracts/${row.id}`} className="font-medium hover:underline">
                          {row.title}
                        </Link>
                        <div className="text-xs text-[#80848d]">{row.documentRef}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{row.companyName || "—"}</div>
                        <div className="text-xs text-[#80848d]">{row.clientName || row.clientEmail || "No recipient yet"}</div>
                      </td>
                      <td className="max-w-[240px] px-4 py-3 text-[#5f636b]">{row.eventName || "—"}</td>
                      <td className="px-4 py-3">
                        <StatusPill tone={contractTone(row.status, row.expiresAt)}>
                          {contractStatusLabel(row.status, row.expiresAt)}
                        </StatusPill>
                      </td>
                      <td className="px-4 py-3 text-[#5f636b]">{when(row.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminDesktopTable>
            <AdminMobileList>
              {visibleContracts.map((row) => (
                <Link key={row.id} href={`/admin/contracts/${row.id}`} className="block px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{row.title}</p>
                      <p className="mt-1 text-xs text-[#80848d]">{row.companyName || "No company"} · {row.documentRef}</p>
                    </div>
                    <StatusPill tone={contractTone(row.status, row.expiresAt)}>
                      {contractStatusLabel(row.status, row.expiresAt)}
                    </StatusPill>
                  </div>
                </Link>
              ))}
            </AdminMobileList>
            {visibleContracts.length === 0 ? (
              <Empty
                title={contracts.length === 0 ? "No contracts yet" : "Nothing matches"}
                body={contracts.length === 0 ? "" : "Try a different search or filter."}
                action={contracts.length === 0 && canManage ? { href: "/admin/contracts/new", label: "New contract" } : null}
              />
            ) : null}
          </>
        ) : (
          <>
            <AdminDesktopTable>
              <table className="w-full text-left text-sm">
                <thead className="text-[10px] text-[#80848d]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Booking form</th>
                    <th className="px-4 py-3 font-medium">Client</th>
                    <th className="px-4 py-3 font-medium">Deal</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleForms.map((row) => (
                    <tr key={row.id} className="border-t border-[#f0f1f3]">
                      <td className="px-4 py-3 font-medium">{row.documentRef}</td>
                      <td className="px-4 py-3">
                        <div>{row.clientName || "—"}</div>
                        <div className="text-xs text-[#80848d]">{row.clientEmail}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/admin/deals/${row.dealId}`} className="font-medium text-primary hover:underline">
                          {row.dealReference}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill tone={row.status === "completed" ? "green" : row.status === "declined" || row.status === "failed" ? "red" : "blue"}>
                          {BOOKING_STATUS[row.status] ?? row.status}
                        </StatusPill>
                      </td>
                      <td className="px-4 py-3 text-[#5f636b]">{when(row.sentAt ?? row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminDesktopTable>
            <AdminMobileList>
              {visibleForms.map((row) => (
                <Link key={row.id} href={`/admin/deals/${row.dealId}`} className="block px-4 py-3">
                  <p className="text-sm font-medium">{row.documentRef}</p>
                  <p className="mt-1 text-xs text-[#80848d]">
                    {row.clientName || row.clientEmail} · {row.dealReference} · {BOOKING_STATUS[row.status] ?? row.status}
                  </p>
                </Link>
              ))}
            </AdminMobileList>
            {visibleForms.length === 0 ? (
              <Empty title="No booking forms yet" body="" action={null} />
            ) : null}
          </>
        )}
      </AdminPanel>
    </div>
  )
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 rounded-md px-3 text-[10px] font-medium ${
        active
          ? "border border-primary bg-red-50 text-primary"
          : "border border-[#e5e7eb] bg-white text-[#5f636b] hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  )
}

function Empty({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action: { href: string; label: string } | null
}) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-semibold">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-md text-sm text-[#80848d]">{body}</p> : null}
      {action ? (
        <Link
          href={action.href}
          className="mt-4 inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-[10px] font-semibold text-white"
        >
          <Plus className="h-3.5 w-3.5" /> {action.label}
        </Link>
      ) : null}
    </div>
  )
}
