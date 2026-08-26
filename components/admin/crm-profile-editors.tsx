"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { X } from "lucide-react"
import { AccountKindPills } from "@/components/admin/account-kind-pills"
import { CompanySupplierSelect } from "@/components/admin/company-supplier-select"
import { SearchableSelect } from "@/components/admin/searchable-select"
import {
  deleteCrmAccount,
  deleteCrmContact,
  listCrmMergeAccountOptions,
  listCrmMergeContactOptions,
  mergeCrmAccounts,
  mergeCrmContacts,
  updateCrmAccountDetails,
  updateCrmAccountInterests,
  updateSupplierDetails,
  updateSupplierEventCoverage,
  upsertCrmContact,
  type CrmMergeAccountOption,
  type CrmMergeContactOption,
} from "@/app/(admin)/admin/clients/profile-actions"
import { adminRaceLabel } from "@/lib/admin/race-label"
import type { AdminRaceOption } from "@/lib/admin/queries"
import type { AccountKind } from "@/lib/crm/account-kinds"
import { ACCOUNT_SOURCE_LABELS, type AccountSource, type StaffOption } from "@/lib/crm/lead-types"
import type { CrmProfileContact } from "@/lib/crm/profiles"
import { adminAccountPath, adminContactPath } from "@/lib/crm/profile-links"

const fieldClass =
  "mt-1 h-8 w-full rounded-md border border-[#e4e6ea] bg-white px-2 text-[10px] outline-none focus:border-primary/40"
const areaClass =
  "mt-1 min-h-[64px] w-full rounded-md border border-[#e4e6ea] bg-white px-2 py-1.5 text-[10px] outline-none focus:border-primary/40"
const labelClass = "block text-[8px] font-medium uppercase tracking-wide text-[#93979f]"

function EditToggle({
  editing,
  pending,
  onEdit,
  onCancel,
  onSave,
}: {
  editing: boolean
  pending: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
}) {
  if (!editing) {
    return (
      <button type="button" onClick={onEdit} className="text-[9px] font-medium text-primary hover:underline">
        Edit
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={onSave}
        className="h-7 rounded-md bg-primary px-2.5 text-[9px] font-semibold text-white disabled:opacity-50"
      >
        Save
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={onCancel}
        className="h-7 rounded-md border border-[#e4e6ea] px-2.5 text-[9px] font-medium text-[#555961] disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  )
}

export function EventMultiSelect({
  races,
  selectedIds,
  onChange,
  placeholder = "Search events to add…",
  inputClassName,
}: {
  races: AdminRaceOption[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  placeholder?: string
  inputClassName?: string
}) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const byId = useMemo(() => new Map(races.map((race) => [race.id, race])), [races])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return races
      .filter((race) => !selected.has(race.id) && (!q || adminRaceLabel(race).toLowerCase().includes(q)))
      .slice(0, 8)
  }, [query, races, selected])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {selectedIds.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(selectedIds.filter((item) => item !== id))}
            className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-red-50 px-2 py-1 text-[8px] text-primary"
          >
            {byId.get(id) ? adminRaceLabel(byId.get(id)!) : id}
            <X className="h-3 w-3" />
          </button>
        ))}
        {selectedIds.length === 0 ? <span className="text-[9px] text-slate-400">None selected yet.</span> : null}
      </div>
      <div className="relative">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120)
          }}
          placeholder={placeholder}
          className={inputClassName ?? fieldClass}
        />
        {open && matches.length > 0 ? (
          <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-white p-1 shadow-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {matches.map((race) => (
              <button
                key={race.id}
                type="button"
                onClick={() => {
                  onChange([...selectedIds, race.id])
                  setQuery("")
                }}
                className="block w-full rounded px-2 py-1.5 text-left text-[10px] hover:bg-slate-50"
              >
                {adminRaceLabel(race)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function CompanyDetailsEditor({
  account,
  staffOptions,
}: {
  account: {
    id: string
    name: string
    accountTypes: AccountKind[]
    email: string | null
    phone: string | null
    notes: string | null
    active: boolean
    ownerProfileId: string | null
    source: AccountSource
    billing: {
      line1: string | null
      line2: string | null
      city: string | null
      postcode: string | null
      country: string | null
    }
  }
  staffOptions: StaffOption[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(account.name)
  const [accountTypes, setAccountTypes] = useState<AccountKind[]>(account.accountTypes)
  const [email, setEmail] = useState(account.email ?? "")
  const [phone, setPhone] = useState(account.phone ?? "")
  const [ownerProfileId, setOwnerProfileId] = useState(account.ownerProfileId ?? "")
  const [source, setSource] = useState<AccountSource>(account.source)
  const [notes, setNotes] = useState(account.notes ?? "")
  const [active, setActive] = useState(account.active)
  const [line1, setLine1] = useState(account.billing.line1 ?? "")
  const [line2, setLine2] = useState(account.billing.line2 ?? "")
  const [city, setCity] = useState(account.billing.city ?? "")
  const [postcode, setPostcode] = useState(account.billing.postcode ?? "")
  const [country, setCountry] = useState(account.billing.country ?? "")

  function reset() {
    setName(account.name)
    setAccountTypes(account.accountTypes)
    setEmail(account.email ?? "")
    setPhone(account.phone ?? "")
    setOwnerProfileId(account.ownerProfileId ?? "")
    setSource(account.source)
    setNotes(account.notes ?? "")
    setActive(account.active)
    setLine1(account.billing.line1 ?? "")
    setLine2(account.billing.line2 ?? "")
    setCity(account.billing.city ?? "")
    setPostcode(account.billing.postcode ?? "")
    setCountry(account.billing.country ?? "")
    setEditing(false)
  }

  function save() {
    start(async () => {
      const res = await updateCrmAccountDetails({
        accountId: account.id,
        name,
        accountTypes,
        email,
        phone,
        notes,
        ownerProfileId,
        source,
        active,
        billing: { line1, line2, city, postcode, country },
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(res.message)
      setEditing(false)
      router.refresh()
    })
  }

  return (
    <>
      <div className="flex justify-end px-4 pt-3">
        <EditToggle
          editing={editing}
          pending={pending}
          onEdit={() => setEditing(true)}
          onCancel={reset}
          onSave={save}
        />
      </div>
      {editing ? (
        <div className="grid gap-2 px-4 pb-4">
          <label className={labelClass}>
            {accountTypes.includes("direct_client") ? "Name" : "Company name"}
            <input value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
            <span className="mt-1 block text-[8px] font-normal normal-case tracking-normal text-[#9a9ea5]">
              If this is a direct client / end user, put their name here instead of a company.
            </span>
          </label>
          <div>
            <p className={labelClass}>Type</p>
            <div className="mt-1">
              <AccountKindPills compact value={accountTypes} onChange={setAccountTypes} />
            </div>
            <p className="mt-1 text-[8px] text-[#9a9ea5]">Select every role this account plays.</p>
          </div>
          <label className={labelClass}>
            Owner
            <select value={ownerProfileId} onChange={(e) => setOwnerProfileId(e.target.value)} className={fieldClass}>
              <option value="">Unassigned</option>
              {staffOptions.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Source
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as AccountSource)}
              className={fieldClass}
            >
              {Object.entries(ACCOUNT_SOURCE_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} />
          </label>
          <label className={labelClass}>
            Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldClass} />
          </label>
          <label className={labelClass}>
            Address line 1
            <input value={line1} onChange={(e) => setLine1(e.target.value)} className={fieldClass} />
          </label>
          <label className={labelClass}>
            Address line 2
            <input value={line2} onChange={(e) => setLine2(e.target.value)} className={fieldClass} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={labelClass}>
              City
              <input value={city} onChange={(e) => setCity(e.target.value)} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Postcode (optional)
              <input value={postcode} onChange={(e) => setPostcode(e.target.value)} className={fieldClass} />
            </label>
          </div>
          <label className={labelClass}>
            Country
            <input value={country} onChange={(e) => setCountry(e.target.value)} className={fieldClass} />
          </label>
          <label className={labelClass}>
            Internal notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={areaClass} />
          </label>
          <label className="flex items-center gap-2 text-[10px] text-[#555961]">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
        </div>
      ) : null}
    </>
  )
}

export function CompanyContactsEditor({
  accountId,
  contacts,
  currentContactId,
}: {
  accountId: string
  contacts: CrmProfileContact[]
  currentContactId?: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div>
      <div className="flex justify-end px-4 pt-3">
        <button
          type="button"
          onClick={() => {
            setAdding(true)
            setEditingId(null)
          }}
          className="text-[9px] font-medium text-primary hover:underline"
        >
          Add contact
        </button>
      </div>
      {adding ? (
        <ContactFields
          accountId={accountId}
          pending={pending}
          start={start}
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            router.refresh()
          }}
        />
      ) : null}
      <div className="divide-y divide-[#f0f1f3]">
        {contacts.map((contact) =>
          editingId === contact.id ? (
            <ContactFields
              key={contact.id}
              accountId={accountId}
              contact={contact}
              pending={pending}
              start={start}
              onCancel={() => setEditingId(null)}
              onSaved={() => {
                setEditingId(null)
                router.refresh()
              }}
            />
          ) : (
            <div key={contact.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <Link href={adminContactPath(accountId, contact.id)} className="min-w-0 hover:text-primary">
                <p className="truncate text-[10px] font-semibold">
                  {contact.fullName}
                  {contact.isPrimary ? <span className="ml-1 text-[8px] font-medium text-blue-600">Primary</span> : null}
                </p>
                <p className="truncate text-[8px] text-slate-400">
                  {[contact.jobTitle, contact.email, contact.phone].filter(Boolean).join(" · ") || "No contact details"}
                </p>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false)
                    setEditingId(contact.id)
                  }}
                  className="text-[9px] font-medium text-primary hover:underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Delete ${contact.fullName}? Deals stay on this company but will no longer be linked to this person.`,
                      )
                    ) {
                      return
                    }
                    start(async () => {
                      const res = await deleteCrmContact({ contactId: contact.id, accountId })
                      if (!res.ok) {
                        toast.error(res.message)
                        return
                      }
                      toast.success(res.message)
                      if (currentContactId === contact.id) {
                        router.push(adminAccountPath(accountId))
                      }
                      router.refresh()
                    })
                  }}
                  className="text-[9px] font-medium text-red-600 hover:underline disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ),
        )}
        {contacts.length === 0 && !adding ? (
          <p className="p-4 text-[9px] text-slate-400">No contacts recorded.</p>
        ) : null}
      </div>
    </div>
  )
}

function ContactFields({
  accountId,
  contact,
  pending,
  start,
  onCancel,
  onSaved,
}: {
  accountId: string
  contact?: CrmProfileContact
  pending: boolean
  start: (fn: () => Promise<void>) => void
  onCancel: () => void
  onSaved: () => void
}) {
  const [fullName, setFullName] = useState(contact?.fullName ?? "")
  const [email, setEmail] = useState(contact?.email ?? "")
  const [phone, setPhone] = useState(contact?.phone ?? "")
  const [jobTitle, setJobTitle] = useState(contact?.jobTitle ?? "")
  const [notes, setNotes] = useState(contact?.notes ?? "")
  const [isPrimary, setIsPrimary] = useState(contact?.isPrimary ?? false)
  const [active, setActive] = useState(contact?.active ?? true)

  function save() {
    start(async () => {
      const res = await upsertCrmContact({
        accountId,
        contactId: contact?.id,
        fullName,
        email,
        phone,
        jobTitle,
        notes,
        isPrimary,
        active,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(res.message)
      onSaved()
    })
  }

  return (
    <div className="grid gap-2 bg-[#fafbfc] px-4 py-3">
      <label className={labelClass}>
        Full name
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={fieldClass} />
      </label>
      <label className={labelClass}>
        Job title
        <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className={fieldClass} />
      </label>
      <label className={labelClass}>
        Email
        <input value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} />
      </label>
      <label className={labelClass}>
        Phone
        <input value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldClass} />
      </label>
      <label className={labelClass}>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={areaClass} />
      </label>
      <label className="flex items-center gap-2 text-[10px] text-[#555961]">
        <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
        Primary contact
      </label>
      <label className="flex items-center gap-2 text-[10px] text-[#555961]">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="h-7 rounded-md bg-primary px-2.5 text-[9px] font-semibold text-white disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="h-7 rounded-md border border-[#e4e6ea] px-2.5 text-[9px] font-medium disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export function CompanyInterestsEditor({
  accountId,
  raceIds,
  races,
}: {
  accountId: string
  raceIds: string[]
  races: AdminRaceOption[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const [selectedIds, setSelectedIds] = useState(raceIds)

  function save() {
    start(async () => {
      const res = await updateCrmAccountInterests({ accountId, raceIds: selectedIds })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(res.message)
      setEditing(false)
      router.refresh()
    })
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] font-semibold text-[#555961]">Saved event interests</p>
        <EditToggle
          editing={editing}
          pending={pending}
          onEdit={() => {
            setSelectedIds(raceIds)
            setEditing(true)
          }}
          onCancel={() => {
            setSelectedIds(raceIds)
            setEditing(false)
          }}
          onSave={save}
        />
      </div>
      {editing ? (
        <EventMultiSelect races={races} selectedIds={selectedIds} onChange={setSelectedIds} />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {raceIds.map((id) => {
            const race = races.find((item) => item.id === id)
            return (
              <span key={id} className="rounded-md border bg-[#fafbfc] px-2 py-1.5 text-[8px] text-[#656970]">
                {race ? adminRaceLabel(race) : id}
              </span>
            )
          })}
          {raceIds.length === 0 ? (
            <span className="text-[9px] text-slate-400">No saved event interests yet.</span>
          ) : null}
        </div>
      )}
    </div>
  )
}

export function SupplierDetailsEditor({
  supplier,
}: {
  supplier: {
    id: string
    name: string
    code: string | null
    contactName: string | null
    contactEmail: string | null
    contactPhone: string | null
    notes: string | null
    active: boolean
  }
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(supplier.name)
  const [code, setCode] = useState(supplier.code ?? "")
  const [contactName, setContactName] = useState(supplier.contactName ?? "")
  const [contactEmail, setContactEmail] = useState(supplier.contactEmail ?? "")
  const [contactPhone, setContactPhone] = useState(supplier.contactPhone ?? "")
  const [notes, setNotes] = useState(supplier.notes ?? "")
  const [active, setActive] = useState(supplier.active)

  function reset() {
    setName(supplier.name)
    setCode(supplier.code ?? "")
    setContactName(supplier.contactName ?? "")
    setContactEmail(supplier.contactEmail ?? "")
    setContactPhone(supplier.contactPhone ?? "")
    setNotes(supplier.notes ?? "")
    setActive(supplier.active)
    setEditing(false)
  }

  function save() {
    start(async () => {
      const res = await updateSupplierDetails({
        supplierId: supplier.id,
        name,
        code,
        contactName,
        contactEmail,
        contactPhone,
        notes,
        active,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(res.message)
      setEditing(false)
      router.refresh()
    })
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex justify-end">
        <EditToggle editing={editing} pending={pending} onEdit={() => setEditing(true)} onCancel={reset} onSave={save} />
      </div>
      {editing ? (
        <div className="grid gap-2">
          <label className={labelClass}>
            Supplier name
            <input value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
          </label>
          <label className={labelClass}>
            Code
            <input value={code} onChange={(e) => setCode(e.target.value)} className={fieldClass} />
          </label>
          <label className={labelClass}>
            Main contact
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={fieldClass} />
          </label>
          <label className={labelClass}>
            Email
            <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={fieldClass} />
          </label>
          <label className={labelClass}>
            Phone
            <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={fieldClass} />
          </label>
          <label className={labelClass}>
            Internal notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={areaClass} />
          </label>
          <label className="flex items-center gap-2 text-[10px] text-[#555961]">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
        </div>
      ) : null}
    </div>
  )
}

export function SupplierCoverageEditor({
  supplierId,
  raceIds,
  races,
}: {
  supplierId: string
  raceIds: string[]
  races: AdminRaceOption[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const [selectedIds, setSelectedIds] = useState(raceIds)

  function save() {
    start(async () => {
      const res = await updateSupplierEventCoverage({ supplierId, raceIds: selectedIds })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(res.message)
      setEditing(false)
      router.refresh()
    })
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] font-semibold text-[#555961]">Events they can supply</p>
        <EditToggle
          editing={editing}
          pending={pending}
          onEdit={() => {
            setSelectedIds(raceIds)
            setEditing(true)
          }}
          onCancel={() => {
            setSelectedIds(raceIds)
            setEditing(false)
          }}
          onSave={save}
        />
      </div>
      {editing ? (
        <EventMultiSelect
          races={races}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
          placeholder="Search events they can provide…"
        />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {raceIds.map((id) => {
            const race = races.find((item) => item.id === id)
            return (
              <span key={id} className="rounded-md border bg-[#fafbfc] px-2 py-1.5 text-[8px] text-[#656970]">
                {race ? adminRaceLabel(race) : id}
              </span>
            )
          })}
          {raceIds.length === 0 ? (
            <span className="text-[9px] text-slate-400">No coverage saved yet. Add the events this supplier can provide.</span>
          ) : null}
        </div>
      )}
    </div>
  )
}

export function ContactDetailsEditor({
  accountId,
  contact,
}: {
  accountId: string
  contact: CrmProfileContact
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)

  return (
    <div>
      <div className="flex justify-end px-4 pt-3">
        {!editing ? (
          <button type="button" onClick={() => setEditing(true)} className="text-[9px] font-medium text-primary hover:underline">
            Edit
          </button>
        ) : null}
      </div>
      {editing ? (
        <ContactFields
          accountId={accountId}
          contact={contact}
          pending={pending}
          start={start}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            router.refresh()
          }}
        />
      ) : null}
    </div>
  )
}

export function CompanyMergeDeletePanel({
  accountId,
  accountName,
}: {
  accountId: string
  accountName: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [targetId, setTargetId] = useState("")
  const [companies, setCompanies] = useState<CrmMergeAccountOption[]>([])

  useEffect(() => {
    let cancelled = false
    void listCrmMergeAccountOptions().then((rows) => {
      if (!cancelled) setCompanies(rows)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const target = companies.find((company) => company.id === targetId)

  return (
    <div className="space-y-3 border-t border-[#eceef1] px-4 py-3">
      <p className="text-[8px] font-medium uppercase tracking-wide text-[#93979f]">Merge or delete</p>
      <div className="space-y-1.5">
        <CompanySupplierSelect
          companies={companies}
          value={targetId}
          onChange={setTargetId}
          excludeIds={[accountId]}
          disabled={pending}
          className="h-8 py-0 text-[10px]"
        />
        <button
          type="button"
          disabled={pending || !targetId}
          onClick={() => {
            if (!target) return
            if (
              !window.confirm(
                `Merge ${accountName} into ${target.name}? Contacts, deals, leads, and orders will move to ${target.name}. ${accountName} will be deleted.`,
              )
            ) {
              return
            }
            start(async () => {
              const res = await mergeCrmAccounts({ sourceAccountId: accountId, targetAccountId: targetId })
              if (!res.ok) {
                toast.error(res.message)
                return
              }
              toast.success(res.message)
              router.push(adminAccountPath(targetId))
              router.refresh()
            })
          }}
          className="h-7 rounded-md border border-[#e4e6ea] px-2.5 text-[9px] font-medium text-[#555961] disabled:opacity-50"
        >
          Merge into selected company
        </button>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              `Delete ${accountName}? Contacts will be removed. Deals and orders stay but will no longer be linked to a company. Merge instead if you want to keep this history.`,
            )
          ) {
            return
          }
          start(async () => {
            const res = await deleteCrmAccount({ accountId })
            if (!res.ok) {
              toast.error(res.message)
              return
            }
            toast.success(res.message)
            router.push("/admin/leads")
            router.refresh()
          })
        }}
        className="text-[9px] font-medium text-red-600 hover:underline disabled:opacity-50"
      >
        Delete this company
      </button>
    </div>
  )
}

export function ContactMergeDeletePanel({
  accountId,
  contact,
}: {
  accountId: string
  contact: CrmProfileContact
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [targetId, setTargetId] = useState("")
  const [contacts, setContacts] = useState<CrmMergeContactOption[]>([])

  useEffect(() => {
    let cancelled = false
    void listCrmMergeContactOptions().then((rows) => {
      if (!cancelled) setContacts(rows)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const options = useMemo(
    () =>
      contacts
        .filter((row) => row.id !== contact.id)
        .map((row) => ({
          value: row.id,
          label: [row.fullName, row.accountName, row.email].filter(Boolean).join(" · "),
        })),
    [contact.id, contacts],
  )
  const target = contacts.find((row) => row.id === targetId)

  return (
    <div className="space-y-3 border-t border-[#eceef1] px-4 py-3">
      <p className="text-[8px] font-medium uppercase tracking-wide text-[#93979f]">Merge or delete</p>
      <div className="space-y-1.5">
        <SearchableSelect
          value={targetId}
          onChange={setTargetId}
          options={options}
          placeholder="Search contacts to merge into…"
          emptyLabel="No matching contacts"
          className={fieldClass}
        />
        <button
          type="button"
          disabled={pending || !targetId}
          onClick={() => {
            if (!target) return
            if (
              !window.confirm(
                `Merge ${contact.fullName} into ${target.fullName} (${target.accountName})? Deals, leads, and orders will move across. ${contact.fullName} will be deleted.`,
              )
            ) {
              return
            }
            start(async () => {
              const res = await mergeCrmContacts({
                sourceContactId: contact.id,
                targetContactId: targetId,
              })
              if (!res.ok) {
                toast.error(res.message)
                return
              }
              toast.success(res.message)
              if (res.accountId && res.contactId) {
                router.push(adminContactPath(res.accountId, res.contactId))
              } else {
                router.push(adminAccountPath(accountId))
              }
              router.refresh()
            })
          }}
          className="h-7 rounded-md border border-[#e4e6ea] px-2.5 text-[9px] font-medium text-[#555961] disabled:opacity-50"
        >
          Merge into selected contact
        </button>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              `Delete ${contact.fullName}? Deals stay on this company but will no longer be linked to this person.`,
            )
          ) {
            return
          }
          start(async () => {
            const res = await deleteCrmContact({ contactId: contact.id, accountId })
            if (!res.ok) {
              toast.error(res.message)
              return
            }
            toast.success(res.message)
            router.push(adminAccountPath(accountId))
            router.refresh()
          })
        }}
        className="text-[9px] font-medium text-red-600 hover:underline disabled:opacity-50"
      >
        Delete this contact
      </button>
    </div>
  )
}

