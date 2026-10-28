"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Building2,
  Plus,
  Search,
  Upload,
  UserRoundPlus,
  UserRoundCheck,
  UsersRound,
  X,
} from "lucide-react"
import { toast } from "sonner"
import {
  assignAccountOwner,
  bulkSetAccountEventInterest,
  createCrmAccount,
} from "@/app/(admin)/admin/clients/profile-actions"
import { AccountBulkUploadModal } from "@/app/(admin)/admin/leads/bulk-upload-modal"
import { AccountKindPills } from "@/components/admin/account-kind-pills"
import { EventMultiSelect } from "@/components/admin/crm-profile-editors"
import {
  AdminPageHeader,
  AdminPanel,
  AdminStatCard,
  AdminStats,
  AdminDesktopTable,
  AdminMobileList,
  StatusPill,
} from "@/components/admin/admin-page-kit"
import type { AdminRaceOption } from "@/lib/admin/queries"
import { accountKindLabels, type AccountKind } from "@/lib/crm/account-kinds"
import {
  ACCOUNT_LIFECYCLE_LABELS,
  lifecycleTone,
} from "@/lib/crm/account-lifecycle"
import { adminAccountPath, adminContactPath } from "@/lib/crm/profile-links"
import {
  ACCOUNT_SOURCE_LABELS,
  type AccountSource,
  type ClientDirectoryRow,
  type StaffOption,
} from "@/lib/crm/lead-types"
import { fetchClientDirectoryPage } from "@/app/(admin)/admin/leads/actions"
import { writeLeadsClientCache } from "@/lib/admin/leads-client-cache"
import { cn } from "@/lib/utils"
import { usePersistedAdminFilters } from "@/lib/admin/use-persisted-admin-filters"
import { isModifiedClick, openInNewTab, pageSearchProps } from "@/lib/browser/laptop-qol"

type View = "accounts" | "contacts"

type DraftContact = {
  id: number
  fullName: string
  email: string
  phone: string
}

let nextContactId = 1
function emptyContact(): DraftContact {
  nextContactId += 1
  return { id: nextContactId, fullName: "", email: "", phone: "" }
}

function money(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

function dateTime(value: string | null): string {
  if (!value) return "—"
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function sourceTone(source: AccountSource): "green" | "amber" | "red" | "blue" | "purple" | "gray" {
  if (source === "website") return "blue"
  if (source === "referral") return "green"
  if (source === "marketing") return "purple"
  if (source === "manual") return "amber"
  return "gray"
}

function matchesQuery(client: ClientDirectoryRow, query: string): boolean {
  if (!query) return true
  const haystack = [
    client.name,
    client.email,
    client.phone,
    client.owner_name,
    ACCOUNT_SOURCE_LABELS[client.source],
    accountKindLabels(client.account_types),
    ...client.contacts.flatMap((contact) => [contact.full_name, contact.email, contact.phone]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  return haystack.includes(query)
}

function raceOptionLabel(race: AdminRaceOption): string {
  return `${race.name} ${race.season}`
}

function SelectBox({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-3.5 w-3.5 cursor-pointer accent-primary"
    />
  )
}

export function LeadsClient({
  clients: initialClients,
  staffOptions: initialStaffOptions,
  races: initialRaces,
  currentProfileId,
}: {
  clients: ClientDirectoryRow[]
  staffOptions: StaffOption[]
  races: AdminRaceOption[]
  currentProfileId: string
}) {
  const [clients, setClients] = useState(initialClients)
  const [staffOptions, setStaffOptions] = useState(initialStaffOptions)
  const [races, setRaces] = useState(initialRaces)
  const refreshPromise = useRef<Promise<{
    clients: ClientDirectoryRow[]
    staffOptions: StaffOption[]
    races: AdminRaceOption[]
  }> | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const [listState, setListState] = usePersistedAdminFilters("zk-admin-leads-filters-v3", {
    view: "accounts" as View,
    query: "",
    ownerFilter: "all",
    sourceFilter: "",
    eventFilter: "",
  })
  const { query, ownerFilter, sourceFilter, eventFilter } = listState
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkRaceId, setBulkRaceId] = useState("")
  const view: View = listState.view === "contacts" ? "contacts" : "accounts"
  const [showCreate, setShowCreate] = useState(false)
  const [showBulkUpload, setShowBulkUpload] = useState(false)
  const [companyName, setCompanyName] = useState("")
  const [accountTypes, setAccountTypes] = useState<AccountKind[]>([])
  const [source, setSource] = useState<AccountSource>("manual")
  const [ownerId, setOwnerId] = useState(currentProfileId)
  const [line1, setLine1] = useState("")
  const [line2, setLine2] = useState("")
  const [city, setCity] = useState("")
  const [postcode, setPostcode] = useState("")
  const [country, setCountry] = useState("")
  const [contacts, setContacts] = useState<DraftContact[]>([emptyContact()])
  const [raceIds, setRaceIds] = useState<string[]>([])
  const [notes, setNotes] = useState("")

  function requestFreshPage() {
    if (refreshPromise.current) return refreshPromise.current
    const request = fetchClientDirectoryPage().then((result) => {
      if (!result.ok) throw new Error(result.message)
      return {
        clients: result.clients,
        staffOptions: result.staffOptions,
        races: result.races,
      }
    })
    refreshPromise.current = request
    void request.then(
      () => {
        if (refreshPromise.current === request) refreshPromise.current = null
      },
      () => {
        if (refreshPromise.current === request) refreshPromise.current = null
      },
    )
    return request
  }

  function applyDirectory(page: {
    clients: ClientDirectoryRow[]
    staffOptions: StaffOption[]
    races: AdminRaceOption[]
  }) {
    setClients(page.clients)
    setStaffOptions(page.staffOptions)
    setRaces(page.races)
    writeLeadsClientCache(page.clients, page.staffOptions, page.races)
  }

  const q = query.trim().toLowerCase()
  const unassignedCount = clients.filter((client) => !client.owner_profile_id).length
  const myCount = clients.filter((client) => client.owner_profile_id === currentProfileId).length
  const contactCount = clients.reduce((sum, client) => sum + client.contacts.length, 0)

  const filteredClients = useMemo(() => {
    return clients.filter((client) => {
      if (ownerFilter === "mine" && client.owner_profile_id !== currentProfileId) return false
      if (ownerFilter === "unassigned" && client.owner_profile_id) return false
      if (ownerFilter !== "all" && ownerFilter !== "mine" && ownerFilter !== "unassigned") {
        if (client.owner_profile_id !== ownerFilter) return false
      }
      if (sourceFilter && client.source !== sourceFilter) return false
      if (
        eventFilter &&
        !client.interest_race_ids.includes(eventFilter) &&
        !client.enquiry_race_ids.includes(eventFilter)
      ) {
        return false
      }
      return matchesQuery(client, q)
    })
  }, [clients, currentProfileId, eventFilter, ownerFilter, q, sourceFilter])

  const contactRows = useMemo(() => {
    return filteredClients.flatMap((client) =>
      client.contacts.map((contact) => ({ client, contact })),
    )
  }, [filteredClients])

  const raceLabel = useMemo(
    () => new Map(races.map((race) => [race.id, `${race.short_name || race.name} ’${String(race.season).slice(-2)}`])),
    [races],
  )
  const selectedVisible = filteredClients.filter((client) => selectedIds.has(client.id))
  const allVisibleSelected = filteredClients.length > 0 && selectedVisible.length === filteredClients.length

  function toggleSelected(accountId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(accountId)
      else next.delete(accountId)
      return next
    })
  }

  function toggleAllVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const client of filteredClients) {
        if (checked) next.add(client.id)
        else next.delete(client.id)
      }
      return next
    })
  }

  function applyBulkInterest(interested: boolean) {
    const raceId = bulkRaceId || eventFilter
    if (!raceId) {
      toast.error("Choose an event first.")
      return
    }
    const accountIds = selectedVisible.map((client) => client.id)
    startTransition(async () => {
      const result = await bulkSetAccountEventInterest({ accountIds, raceId, interested })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      const targets = new Set(accountIds)
      setClients((current) =>
        current.map((client) => {
          if (!targets.has(client.id)) return client
          const ids = client.interest_race_ids.filter((id) => id !== raceId)
          return { ...client, interest_race_ids: interested ? [...ids, raceId] : ids }
        }),
      )
      setSelectedIds(new Set())
      try {
        applyDirectory(await requestFreshPage())
      } catch {
        /* optimistic interest change stays */
      }
    })
  }

  function eventChips(client: ClientDirectoryRow) {
    const ids = [...new Set([...client.interest_race_ids, ...client.enquiry_race_ids])].filter((id) =>
      raceLabel.has(id),
    )
    if (ids.length === 0) return <span className="text-slate-300">—</span>
    return (
      <div className="flex max-w-[200px] flex-wrap gap-1">
        {ids.slice(0, 3).map((id) => (
          <span
            key={id}
            title={client.interest_race_ids.includes(id) ? "Marked as interested" : "Has an enquiry or deal"}
            className={cn(
              "rounded px-1.5 py-0.5 text-[8px]",
              id === eventFilter ? "bg-primary/10 text-primary" : "bg-slate-100 text-slate-600",
            )}
          >
            {raceLabel.get(id)}
          </span>
        ))}
        {ids.length > 3 ? <span className="text-[8px] text-slate-400">+{ids.length - 3}</span> : null}
      </div>
    )
  }

  function updateContact(id: number, patch: Partial<DraftContact>) {
    setContacts((current) => current.map((contact) => (contact.id === id ? { ...contact, ...patch } : contact)))
  }

  function resetCreate() {
    setCompanyName("")
    setAccountTypes([])
    setSource("manual")
    setOwnerId(currentProfileId)
    setLine1("")
    setLine2("")
    setCity("")
    setPostcode("")
    setCountry("")
    setContacts([emptyContact()])
    setRaceIds([])
    setNotes("")
    setShowCreate(false)
  }

  function submitAccount() {
    startTransition(async () => {
      const result = await createCrmAccount({
        name: companyName,
        accountTypes,
        source,
        ownerProfileId: ownerId || null,
        billing: { line1, line2, city, postcode, country },
        contacts,
        raceIds,
        notes,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      resetCreate()
      if (result.accountId) {
        router.push(adminAccountPath(result.accountId))
        return
      }
      try {
        applyDirectory(await requestFreshPage())
      } catch {
        /* keep current list */
      }
    })
  }

  function changeOwner(accountId: string, nextOwnerId: string) {
    startTransition(async () => {
      const result = await assignAccountOwner({
        accountId,
        ownerProfileId: nextOwnerId || null,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      const owner = staffOptions.find((item) => item.id === nextOwnerId)
      setClients((current) =>
        current.map((client) =>
          client.id === accountId
            ? {
                ...client,
                owner_profile_id: nextOwnerId || null,
                owner_name: nextOwnerId ? owner?.name ?? client.owner_name : null,
              }
            : client,
        ),
      )
      try {
        applyDirectory(await requestFreshPage())
      } catch {
        /* optimistic owner change stays */
      }
    })
  }

  return (
    <div className="space-y-3">
      <AdminPageHeader
        title="Accounts"
        description="Companies and people in one directory. A signed booking or order marks them as a client."
      />

      <AdminStats className="sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard icon={Building2} value={clients.length} label="Accounts" tone="blue" />
        <AdminStatCard icon={UsersRound} value={contactCount} label="Contacts" tone="purple" />
        <AdminStatCard icon={UserRoundPlus} value={unassignedCount} label="Unassigned" tone="amber" />
        <AdminStatCard icon={UserRoundCheck} value={myCount} label="My accounts" tone="green" />
      </AdminStats>

      <AdminPanel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#eceef1] px-4 pt-3">
          {(["accounts", "contacts"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setListState((current) => ({ ...current, view: item }))}
              className={cn(
                "border-b-2 px-3 pb-3 text-[10px] font-semibold capitalize",
                view === item ? "border-primary text-primary" : "border-transparent text-slate-500",
              )}
            >
              {item === "accounts" ? "Accounts" : "Contacts"}
            </button>
          ))}
          <div className="mb-3 flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => setShowBulkUpload(true)}
              className="flex h-9 items-center justify-center gap-1.5 rounded-md border px-4 text-[9px] font-semibold"
            >
              <Upload className="h-3.5 w-3.5" /> Bulk upload
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-[9px] font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" /> New account
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-[#eceef1] p-3">
          <select
            value={ownerFilter}
            onChange={(e) => setListState((current) => ({ ...current, ownerFilter: e.target.value }))}
            className="h-9 rounded-md border bg-white px-3 text-[9px]"
          >
            <option value="all">All owners</option>
            <option value="mine">Mine</option>
            <option value="unassigned">Unassigned</option>
            {staffOptions.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => setListState((current) => ({ ...current, sourceFilter: e.target.value }))}
            className="h-9 rounded-md border bg-white px-3 text-[9px]"
          >
            <option value="">All sources</option>
            {Object.entries(ACCOUNT_SOURCE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={eventFilter}
            onChange={(e) => setListState((current) => ({ ...current, eventFilter: e.target.value }))}
            className={cn(
              "h-9 max-w-[220px] rounded-md border bg-white px-3 text-[9px]",
              eventFilter && "border-primary/50 text-primary",
            )}
            title="Accounts marked as interested, or with an enquiry or deal for this event"
          >
            <option value="">All event interests</option>
            {races.map((race) => (
              <option key={race.id} value={race.id}>
                Interested in {raceOptionLabel(race)}
              </option>
            ))}
          </select>
          <div className="relative w-full min-w-0 sm:ml-auto sm:min-w-[240px] sm:max-w-sm sm:flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              {...pageSearchProps}
              value={query}
              onChange={(e) => setListState((current) => ({ ...current, query: e.target.value }))}
              placeholder="Search companies, contacts, email..."
              className="h-9 w-full rounded-md border pl-9 pr-3 text-[9px] outline-none focus:border-primary/50"
            />
          </div>
        </div>

        {selectedVisible.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-[#eceef1] bg-primary/5 px-4 py-2.5">
            <span className="text-[9px] font-semibold text-primary">
              {selectedVisible.length} account{selectedVisible.length === 1 ? "" : "s"} selected
            </span>
            <select
              value={bulkRaceId || eventFilter}
              onChange={(e) => setBulkRaceId(e.target.value)}
              className="h-8 max-w-[240px] rounded-md border bg-white px-2 text-[9px]"
            >
              <option value="">Choose event…</option>
              {races.map((race) => (
                <option key={race.id} value={race.id}>
                  {raceOptionLabel(race)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending}
              onClick={() => applyBulkInterest(true)}
              className="h-8 rounded-md bg-primary px-3 text-[9px] font-semibold text-white disabled:opacity-50"
            >
              Mark interested
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => applyBulkInterest(false)}
              className="h-8 rounded-md border bg-white px-3 text-[9px] font-semibold disabled:opacity-50"
            >
              Remove interest
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-[9px] text-slate-500 hover:text-primary"
            >
              Clear selection
            </button>
          </div>
        ) : null}

        {view === "accounts" ? (
          <>
          <AdminDesktopTable>
            <table className="w-full min-w-[1200px] text-left">
              <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-[#92969e]">
                <tr>
                  <th className="w-8 py-2 pl-4">
                    <SelectBox
                      label="Select all accounts in this view"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                    />
                  </th>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Primary contact</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Events</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2 font-medium">Deals</th>
                  <th className="px-4 py-2 font-medium">Lifetime value</th>
                  <th className="px-4 py-2 font-medium">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y text-[9px]">
                {filteredClients.map((client) => {
                  const primary = client.contacts.find((contact) => contact.is_primary) ?? client.contacts[0]
                  return (
                    <tr
                      key={client.id}
                      className={cn("hover:bg-slate-50", selectedIds.has(client.id) && "bg-primary/5")}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("a,button,input,select,textarea,label")) return
                        if (!isModifiedClick(event)) return
                        openInNewTab(adminAccountPath(client.id))
                      }}
                    >
                      <td className="py-3 pl-4">
                        <SelectBox
                          label={`Select ${client.name}`}
                          checked={selectedIds.has(client.id)}
                          onChange={(checked) => toggleSelected(client.id, checked)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link href={adminAccountPath(client.id)} className="font-semibold text-primary hover:underline">
                          {client.name}
                        </Link>
                        <p className="text-[8px] text-slate-400">{accountKindLabels(client.account_types)}</p>
                      </td>
                      <td className="px-4 py-3">
                        {primary ? (
                          <Link
                            href={adminContactPath(client.id, primary.id)}
                            className="hover:text-primary hover:underline"
                          >
                            {primary.full_name}
                          </Link>
                        ) : (
                          "—"
                        )}
                        <p className="text-[8px] text-slate-400">
                          {primary?.email || client.email || "No email"}
                          {` · ${client.contacts.length} contact${client.contacts.length === 1 ? "" : "s"}`}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusPill tone={lifecycleTone(client.lifecycle)}>
                            {ACCOUNT_LIFECYCLE_LABELS[client.lifecycle]}
                          </StatusPill>
                          <StatusPill tone={sourceTone(client.source)}>
                            {ACCOUNT_SOURCE_LABELS[client.source]}
                          </StatusPill>
                        </div>
                      </td>
                      <td className="px-4 py-3">{eventChips(client)}</td>
                      <td className="px-4 py-3">
                        <select
                          value={client.owner_profile_id ?? ""}
                          disabled={pending}
                          onChange={(e) => changeOwner(client.id, e.target.value)}
                          className="h-8 max-w-[180px] rounded-md border bg-white px-2 text-[9px] disabled:opacity-50"
                        >
                          <option value="">Unassigned</option>
                          {staffOptions.map((owner) => (
                            <option key={owner.id} value={owner.id}>
                              {owner.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">{client.deal_count}</td>
                      <td className="px-4 py-3 font-semibold">{money(client.lifetime_spend)}</td>
                      <td className="px-4 py-3">{dateTime(client.last_activity_at)}</td>
                    </tr>
                  )
                })}
                {filteredClients.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-14 text-center text-[10px] text-slate-400">
                      No accounts match this view.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </AdminDesktopTable>
          <AdminMobileList>
            {filteredClients.map((client) => {
              const primary = client.contacts.find((contact) => contact.is_primary) ?? client.contacts[0]
              return (
                <div key={client.id} className="space-y-2 px-4 py-3">
                  <Link href={adminAccountPath(client.id)} className="font-semibold text-primary">
                    {client.name}
                  </Link>
                  <p className="text-[8px] text-slate-400">{accountKindLabels(client.account_types)}</p>
                  {primary ? (
                    <p className="text-[10px] text-slate-600">
                      {primary.full_name}
                      {primary.email ? ` · ${primary.email}` : ""}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={lifecycleTone(client.lifecycle)}>
                      {ACCOUNT_LIFECYCLE_LABELS[client.lifecycle]}
                    </StatusPill>
                    <StatusPill tone={sourceTone(client.source)}>
                      {ACCOUNT_SOURCE_LABELS[client.source]}
                    </StatusPill>
                    <span className="text-[8px] text-slate-500">{client.deal_count} deals · {money(client.lifetime_spend)}</span>
                  </div>
                </div>
              )
            })}
            {filteredClients.length === 0 ? (
              <p className="px-4 py-14 text-center text-[10px] text-slate-400">No accounts match this view.</p>
            ) : null}
          </AdminMobileList>
          </>
        ) : (
          <>
          <AdminDesktopTable>
            <table className="w-full min-w-[1140px] text-left">
              <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-[#92969e]">
                <tr>
                  <th className="w-8 py-2 pl-4">
                    <SelectBox
                      label="Select all contacts in this view"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                    />
                  </th>
                  <th className="px-4 py-2 font-medium">Contact</th>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Details</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Events</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                </tr>
              </thead>
              <tbody className="divide-y text-[9px]">
                {contactRows.map(({ client, contact }) => (
                  <tr
                    key={contact.id}
                    className={cn("hover:bg-slate-50", selectedIds.has(client.id) && "bg-primary/5")}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("a,button,input,select,textarea,label")) return
                      if (!isModifiedClick(event)) return
                      openInNewTab(adminContactPath(client.id, contact.id))
                    }}
                  >
                    <td className="py-3 pl-4">
                      <SelectBox
                        label={`Select ${contact.full_name}`}
                        checked={selectedIds.has(client.id)}
                        onChange={(checked) => toggleSelected(client.id, checked)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={adminContactPath(client.id, contact.id)}
                        className="font-semibold text-primary hover:underline"
                      >
                        {contact.full_name}
                      </Link>
                      <p className="text-[8px] text-slate-400">
                        {contact.job_title || (contact.is_primary ? "Primary contact" : "Contact")}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={adminAccountPath(client.id)} className="hover:text-primary hover:underline">
                        {client.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <p>{contact.email || client.email || "—"}</p>
                      <p className="text-[8px] text-slate-400">{contact.phone || client.phone || "—"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={sourceTone(client.source)}>
                        {ACCOUNT_SOURCE_LABELS[client.source]}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3">{eventChips(client)}</td>
                    <td className="px-4 py-3">
                      <select
                        value={client.owner_profile_id ?? ""}
                        disabled={pending}
                        onChange={(e) => changeOwner(client.id, e.target.value)}
                        className="h-8 max-w-[180px] rounded-md border bg-white px-2 text-[9px] disabled:opacity-50"
                      >
                        <option value="">Unassigned</option>
                        {staffOptions.map((owner) => (
                          <option key={owner.id} value={owner.id}>
                            {owner.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
                {contactRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-14 text-center text-[10px] text-slate-400">
                      No contacts match this view.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </AdminDesktopTable>
          <AdminMobileList>
            {contactRows.map(({ client, contact }) => (
              <Link
                key={contact.id}
                href={adminContactPath(client.id, contact.id)}
                className="block space-y-1 px-4 py-3"
              >
                <p className="font-semibold text-primary">{contact.full_name}</p>
                <p className="text-[10px] text-slate-600">{client.name}</p>
                <p className="text-[8px] text-slate-400">{contact.email || "No email"}</p>
              </Link>
            ))}
            {contactRows.length === 0 ? (
              <p className="px-4 py-14 text-center text-[10px] text-slate-400">No contacts match this view.</p>
            ) : null}
          </AdminMobileList>
          </>
        )}
      </AdminPanel>

      {showBulkUpload ? (
        <AccountBulkUploadModal
          staffOptions={staffOptions}
          onClose={() => setShowBulkUpload(false)}
          onImported={() => {
            setShowBulkUpload(false)
            void requestFreshPage()
              .then(applyDirectory)
              .catch(() => undefined)
          }}
        />
      ) : null}

      {showCreate ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          data-escape-close=""
          onClick={resetCreate}
        >
          <div
            className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between px-6 pt-6">
              <div>
                <h2 className="text-lg font-semibold">New account</h2>
                <p className="text-sm text-slate-500">
                  Add the company, tick every type that applies, then add the people you speak to.
                </p>
              </div>
              <button type="button" onClick={resetCreate}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-5">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">
                  {accountTypes.includes("direct_client") ? "Name" : "Company name"}
                </span>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder={accountTypes.includes("direct_client") ? "e.g. Jane Smith" : "e.g. Apex Travel"}
                  className="h-11 w-full rounded-md border px-3"
                />
                <span className="mt-1.5 block text-xs text-slate-500">
                  If this is a direct client / end user, put their name here instead of a company.
                </span>
              </label>

              <div>
                <p className="mb-1 text-sm font-medium">Type</p>
                <p className="mb-2 text-xs text-slate-500">
                  Select all that apply — a ticket agent can also be a supplier.
                </p>
                <AccountKindPills value={accountTypes} onChange={setAccountTypes} />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Source</span>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value as AccountSource)}
                    className="h-11 w-full rounded-md border bg-white px-3"
                  >
                    {Object.entries(ACCOUNT_SOURCE_LABELS).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Owner</span>
                  <select
                    value={ownerId}
                    onChange={(e) => setOwnerId(e.target.value)}
                    className="h-11 w-full rounded-md border bg-white px-3"
                  >
                    {staffOptions.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">Address</p>
                <div className="grid gap-3">
                  <input
                    value={line1}
                    onChange={(e) => setLine1(e.target.value)}
                    placeholder="Address line 1"
                    className="h-11 w-full rounded-md border px-3 text-sm"
                  />
                  <input
                    value={line2}
                    onChange={(e) => setLine2(e.target.value)}
                    placeholder="Address line 2 (optional)"
                    className="h-11 w-full rounded-md border px-3 text-sm"
                  />
                  <div className="grid gap-3 md:grid-cols-3">
                    <input
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="City"
                      className="h-11 w-full rounded-md border px-3 text-sm"
                    />
                    <input
                      value={postcode}
                      onChange={(e) => setPostcode(e.target.value)}
                      placeholder="Postcode (optional)"
                      className="h-11 w-full rounded-md border px-3 text-sm"
                    />
                    <input
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      placeholder="Country"
                      className="h-11 w-full rounded-md border px-3 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Contacts</p>
                    <p className="text-xs text-slate-500">The first named person is the primary contact.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setContacts((current) => [...current, emptyContact()])}
                    className="flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium text-primary"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add contact
                  </button>
                </div>
                <div className="space-y-3">
                  {contacts.map((contact, index) => (
                    <div key={contact.id} className="rounded-lg border border-[#eceef1] p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-medium text-slate-500">
                          {index === 0 ? "Primary contact" : `Contact ${index + 1}`}
                        </p>
                        {contacts.length > 1 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setContacts((current) => current.filter((item) => item.id !== contact.id))
                            }
                            className="text-xs text-slate-400 hover:text-primary"
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                      <div className="grid gap-2 md:grid-cols-3">
                        <input
                          value={contact.fullName}
                          onChange={(e) => updateContact(contact.id, { fullName: e.target.value })}
                          placeholder="Full name"
                          className="h-10 rounded-md border px-3 text-sm"
                        />
                        <input
                          type="email"
                          value={contact.email}
                          onChange={(e) => updateContact(contact.id, { email: e.target.value })}
                          placeholder="Email"
                          className="h-10 rounded-md border px-3 text-sm"
                        />
                        <input
                          value={contact.phone}
                          onChange={(e) => updateContact(contact.id, { phone: e.target.value })}
                          placeholder="Phone"
                          className="h-10 rounded-md border px-3 text-sm"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1 text-sm font-medium">Event interests</p>
                <p className="mb-2 text-xs text-slate-500">
                  Search and add any races they care about. Click a chip to remove it.
                </p>
                <EventMultiSelect
                  races={races}
                  selectedIds={raceIds}
                  onChange={setRaceIds}
                  placeholder="Search events…"
                  inputClassName="h-11 w-full rounded-md border px-3 text-sm outline-none focus:border-primary/40"
                />
              </div>

              <label className="block text-sm">
                <span className="mb-1 block font-medium">Notes</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-20 w-full rounded-md border p-3"
                />
              </label>
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-[#eceef1] px-6 py-4">
              <button type="button" onClick={resetCreate} className="h-10 rounded-md border px-4 text-sm">
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={submitAccount}
                className="h-10 rounded-md bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pending ? "Creating…" : "Create account"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
