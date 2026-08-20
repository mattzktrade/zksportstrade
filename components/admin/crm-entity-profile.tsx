import Link from "next/link"
import {
  BriefcaseBusiness,
  CalendarHeart,
  CircleDollarSign,
  Mail,
  MapPin,
  Phone,
  TrendingUp,
  UsersRound,
} from "lucide-react"
import {
  AdminPageHeader,
  AdminPanel,
  AdminStatCard,
  SectionTitle,
  StatusPill,
} from "@/components/admin/admin-page-kit"
import { adminDealPath } from "@/lib/admin/deal-link"
import { adminPackagePath } from "@/lib/admin/package-link"
import { DEAL_STAGE_LABELS, type DealStage } from "@/lib/crm/deal-types"
import { accountKindLabels, type AccountKind } from "@/lib/crm/account-kinds"
import { ACCOUNT_SOURCE_LABELS, LEAD_STATUS_LABELS, type LeadStatus, type StaffOption } from "@/lib/crm/lead-types"
import type { SupplierProfile } from "@/lib/admin/supplier-profile"
import { SupplierProfilePanel } from "@/components/admin/supplier-profile-panel"
import {
  CompanyContactsEditor,
  CompanyDetailsEditor,
  CompanyInterestsEditor,
  CompanyMergeDeletePanel,
  ContactDetailsEditor,
  ContactMergeDeletePanel,
} from "@/components/admin/crm-profile-editors"
import { adminAccountPath, adminContactPath, type CompanyProfileTab } from "@/lib/crm/profile-links"
import type { CrmEntityProfile } from "@/lib/crm/profiles"
import type { AdminRaceOption } from "@/lib/admin/queries"
import { cn } from "@/lib/utils"

const WON_STAGES = new Set<DealStage>(["paid_confirmed", "in_fulfilment", "fulfilled"])
const LOST_STAGES = new Set<DealStage>(["closed_lost", "cancelled"])

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function date(value: string | null): string {
  if (!value) return "—"
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function stageTone(stage: DealStage): "green" | "amber" | "red" | "blue" | "purple" | "gray" {
  if (WON_STAGES.has(stage)) return "green"
  if (LOST_STAGES.has(stage)) return "red"
  if (stage === "awaiting_payment" || stage === "awaiting_invoice") return "amber"
  if (stage === "draft" || stage === "sourcing") return "gray"
  return "blue"
}

function leadTone(status: LeadStatus): "green" | "amber" | "red" | "blue" | "purple" | "gray" {
  if (status === "converted") return "green"
  if (status === "unqualified" || status === "closed") return "red"
  if (status === "price_sent") return "blue"
  if (status === "contacted") return "amber"
  return "purple"
}

function formatAccountKinds(account: { accountTypes: AccountKind[]; accountType: string }): string {
  if (account.accountTypes.length > 0) return accountKindLabels(account.accountTypes)
  return account.accountType.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function CrmEntityProfileView({
  profile,
  supplier = null,
  tab = "customer",
  staffOptions = [],
  races = [],
}: {
  profile: CrmEntityProfile | null
  supplier?: SupplierProfile | null
  tab?: CompanyProfileTab
  staffOptions?: StaffOption[]
  races?: AdminRaceOption[]
}) {
  const account = profile?.account ?? null
  const selectedContact = profile?.selectedContact ?? null
  const contacts = profile?.contacts ?? []
  const leads = profile?.leads ?? []
  const deals = profile?.deals ?? []
  const orders = profile?.orders ?? []
  const dualRole = Boolean(profile && supplier)
  const activeTab: CompanyProfileTab = !profile ? "supplier" : !supplier ? "customer" : tab
  const title = selectedContact?.fullName ?? account?.name ?? supplier?.supplier.name ?? "Company"
  const subtitle = selectedContact
    ? `${selectedContact.jobTitle ? `${selectedContact.jobTitle} at ` : ""}${account?.name}`
    : dualRole
      ? "Customer and supplier · deals, stock and purchasing in one place"
      : account
        ? `${formatAccountKinds(account)} · complete client history`
        : `${supplier?.supplier.code || "Supplier"} · purchasing, stock coverage and deal history`
  const tabBase = account
    ? selectedContact
      ? adminContactPath(account.id, selectedContact.id)
      : adminAccountPath(account.id)
    : null
  const wonDeals = deals.filter((deal) => WON_STAGES.has(deal.stage))
  const lostDeals = deals.filter((deal) => LOST_STAGES.has(deal.stage))
  const openDeals = deals.filter((deal) => !WON_STAGES.has(deal.stage) && !LOST_STAGES.has(deal.stage))
  const currencies = [...new Set(wonDeals.map((deal) => deal.currency))]
  const wonValue =
    currencies.length === 1
      ? money(
          wonDeals.reduce((sum, deal) => sum + deal.totalAmount, 0),
          currencies[0],
        )
      : currencies.length > 1
        ? "Mixed"
        : money(0, "USD")
  const eventInterest = [
    ...new Set([
      ...leads.map((lead) => lead.eventName).filter((value): value is string => Boolean(value)),
      ...deals.flatMap((deal) => deal.eventNames),
    ]),
  ].sort()
  const productInterest = [
    ...new Map(
      [
        ...leads
          .filter((lead) => lead.packageName)
          .map((lead) => [lead.packageName as string, { id: null as string | null, name: lead.packageName as string }] as const),
        ...deals.flatMap((deal) =>
          deal.products.map((product) => [product.name, { id: product.id as string | null, name: product.name }] as const),
        ),
      ],
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name))
  const detailEmail = selectedContact?.email ?? account?.email
  const detailPhone = selectedContact?.phone ?? account?.phone

  return (
    <div className="mx-auto max-w-[1540px] space-y-3 p-4 lg:p-5">
      <AdminPageHeader
        title={title}
        description={subtitle}
        action={
          <div className="flex items-center gap-2">
            {selectedContact && account ? (
              <Link
                href={adminAccountPath(account.id)}
                className="h-9 rounded-md border border-[#e4e6ea] bg-white px-4 py-2 text-[10px] font-medium text-[#555961] hover:border-primary/30"
              >
                View company
              </Link>
            ) : null}
            <StatusPill
              tone={
                selectedContact
                  ? selectedContact.active
                    ? "green"
                    : "gray"
                  : (account?.active ?? supplier?.supplier.active)
                    ? "green"
                    : "gray"
              }
            >
              {(selectedContact ? selectedContact.active : (account?.active ?? supplier?.supplier.active))
                ? "Active"
                : "Inactive"}
            </StatusPill>
          </div>
        }
      />

      {dualRole && tabBase ? (
        <div className="flex gap-1 rounded-lg border border-[#eceef1] bg-white p-1">
          <Link
            href={tabBase}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-center text-[10px] font-semibold",
              activeTab === "customer" ? "bg-primary text-white" : "text-[#62666e] hover:bg-slate-50",
            )}
          >
            Customer
          </Link>
          <Link
            href={`${tabBase}?tab=supplier`}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-center text-[10px] font-semibold",
              activeTab === "supplier" ? "bg-primary text-white" : "text-[#62666e] hover:bg-slate-50",
            )}
          >
            Supplier
          </Link>
        </div>
      ) : null}

      {activeTab === "supplier" && supplier ? (
        <SupplierProfilePanel profile={supplier} hideIdentity={Boolean(account)} races={races} />
      ) : null}

      {activeTab === "customer" && profile && account ? (
        <>
      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <AdminStatCard icon={BriefcaseBusiness} value={deals.length} label="All deals" tone="blue" />
        <AdminStatCard icon={TrendingUp} value={wonDeals.length} label="Won / confirmed" tone="green" />
        <AdminStatCard icon={BriefcaseBusiness} value={openDeals.length} label="Open deals" tone="purple" />
        <AdminStatCard icon={BriefcaseBusiness} value={lostDeals.length} label="Lost / cancelled" tone="red" />
        <AdminStatCard icon={CircleDollarSign} value={wonValue} label="Confirmed deal value" tone="amber" />
      </section>

      <div className="grid gap-3 xl:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.8fr)]">
        <div className="space-y-3">
          <AdminPanel>
            <SectionTitle title={selectedContact ? "Contact details" : "Company details"} />
            {selectedContact ? (
              <ContactDetailsEditor accountId={account.id} contact={selectedContact} />
            ) : (
              <CompanyDetailsEditor account={account} staffOptions={staffOptions} />
            )}
            <div className="space-y-4 p-4 pt-0">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                  {title
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join("")
                    .toUpperCase()}
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-[#25272b]">{title}</p>
                  <p className="text-[9px] text-[#8e9299]">{selectedContact?.jobTitle || formatAccountKinds(account)}</p>
                </div>
              </div>
              <dl className="grid grid-cols-[90px_1fr] gap-y-2 border-y border-[#eceef1] py-3 text-[9px]">
                <dt className="text-[#93979f]">Company</dt>
                <dd>
                  <Link href={adminAccountPath(account.id)} className="font-medium text-primary hover:underline">
                    {account.name}
                  </Link>
                </dd>
                <dt className="text-[#93979f]">Email</dt>
                <dd>
                  {detailEmail ? (
                    <a href={`mailto:${detailEmail}`} className="inline-flex items-center gap-1 font-medium hover:text-primary">
                      <Mail className="h-3 w-3" />
                      {detailEmail}
                    </a>
                  ) : "Not set"}
                </dd>
                <dt className="text-[#93979f]">Phone</dt>
                <dd>
                  {detailPhone ? (
                    <a href={`tel:${detailPhone}`} className="inline-flex items-center gap-1 font-medium hover:text-primary">
                      <Phone className="h-3 w-3" />
                      {detailPhone}
                    </a>
                  ) : "Not set"}
                </dd>
                {!selectedContact ? (
                  <>
                    <dt className="text-[#93979f]">Address</dt>
                    <dd className="inline-flex gap-1">
                      <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                      {account.address.length ? account.address.join(", ") : "Not set"}
                    </dd>
                    <dt className="text-[#93979f]">Type</dt>
                    <dd>{formatAccountKinds(account)}</dd>
                    <dt className="text-[#93979f]">Owner</dt>
                    <dd>{account.ownerName || "Unassigned"}</dd>
                    <dt className="text-[#93979f]">Source</dt>
                    <dd>{ACCOUNT_SOURCE_LABELS[account.source]}</dd>
                  </>
                ) : null}
                <dt className="text-[#93979f]">Client since</dt>
                <dd>{date(account.createdAt)}</dd>
              </dl>
              {(selectedContact?.notes || account.notes) ? (
                <div className="rounded-md bg-[#fafbfc] p-3">
                  <p className="text-[8px] uppercase tracking-wide text-[#9a9ea5]">Internal notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-[9px] text-[#62666e]">
                    {selectedContact?.notes || account.notes}
                  </p>
                </div>
              ) : null}
            </div>
            {selectedContact ? (
              <ContactMergeDeletePanel accountId={account.id} contact={selectedContact} />
            ) : (
              <CompanyMergeDeletePanel accountId={account.id} accountName={account.name} />
            )}
          </AdminPanel>

          <AdminPanel>
            <SectionTitle title={`Contacts (${contacts.length})`} />
            <CompanyContactsEditor
              accountId={account.id}
              contacts={contacts}
              currentContactId={selectedContact?.id}
            />
          </AdminPanel>

          <AdminPanel>
            <SectionTitle title="Interests & event history" />
            <CompanyInterestsEditor
              accountId={account.id}
              raceIds={profile.interestRaceIds}
              races={races}
            />
            <div className="space-y-4 border-t border-[#eceef1] p-4">
              <div>
                <p className="mb-2 flex items-center gap-1 text-[9px] font-semibold text-[#555961]">
                  <CalendarHeart className="h-3.5 w-3.5" /> From deals & leads
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {eventInterest.map((event) => (
                    <span key={event} className="rounded-md border bg-[#fafbfc] px-2 py-1.5 text-[8px] text-[#656970]">
                      {event}
                    </span>
                  ))}
                  {eventInterest.length === 0 ? <span className="text-[9px] text-slate-400">No event history recorded.</span> : null}
                </div>
              </div>
              <div>
                <p className="mb-2 text-[9px] font-semibold text-[#555961]">Products</p>
                <div className="flex flex-wrap gap-1.5">
                  {productInterest.map((product) =>
                    product.id ? (
                      <Link key={product.name} href={adminPackagePath(product.id)} className="rounded-md border bg-[#fafbfc] px-2 py-1.5 text-[8px] text-primary hover:border-primary/30">
                        {product.name}
                      </Link>
                    ) : (
                      <span key={product.name} className="rounded-md border bg-[#fafbfc] px-2 py-1.5 text-[8px] text-[#656970]">
                        {product.name}
                      </span>
                    ),
                  )}
                  {productInterest.length === 0 ? <span className="text-[9px] text-slate-400">No product interest recorded.</span> : null}
                </div>
              </div>
            </div>
          </AdminPanel>
        </div>

        <div className="space-y-3">
          <AdminPanel>
            <SectionTitle title={`Deals (${deals.length})`} href="/admin/deals" hrefLabel="View deal pipeline" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-[#92969e]">
                  <tr>
                    <th className="px-4 py-2 font-medium">Deal</th>
                    {!selectedContact ? <th className="px-4 py-2 font-medium">Contact</th> : null}
                    <th className="px-4 py-2 font-medium">Product / Event</th>
                    <th className="px-4 py-2 font-medium">Stage</th>
                    <th className="px-4 py-2 text-right font-medium">Value</th>
                    <th className="px-4 py-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f1f3] text-[9px]">
                  {deals.map((deal) => (
                    <tr key={deal.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link href={adminDealPath(deal.id)} className="font-semibold text-primary hover:underline">
                          {deal.reference}
                        </Link>
                      </td>
                      {!selectedContact ? (
                        <td className="px-4 py-3">
                          {deal.contactId && deal.contactName ? (
                            <Link href={adminContactPath(account.id, deal.contactId)} className="hover:text-primary hover:underline">
                              {deal.contactName}
                            </Link>
                          ) : "—"}
                        </td>
                      ) : null}
                      <td className="max-w-[260px] px-4 py-3">
                        <p className="truncate font-medium">
                          {deal.products.map((product) => `${product.quantity}× ${product.name}`).join(", ") || "—"}
                        </p>
                        <p className="truncate text-[8px] text-slate-400">{deal.eventNames.join(", ") || "No event"}</p>
                      </td>
                      <td className="px-4 py-3"><StatusPill tone={stageTone(deal.stage)}>{DEAL_STAGE_LABELS[deal.stage]}</StatusPill></td>
                      <td className="px-4 py-3 text-right font-semibold">{money(deal.totalAmount, deal.currency)}</td>
                      <td className="px-4 py-3 text-slate-500">{date(deal.updatedAt)}</td>
                    </tr>
                  ))}
                  {deals.length === 0 ? (
                    <tr><td colSpan={selectedContact ? 5 : 6} className="px-4 py-12 text-center text-[9px] text-slate-400">No deals recorded yet.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </AdminPanel>

          <div className="grid gap-3 lg:grid-cols-2">
            <AdminPanel>
              <SectionTitle title={`Past enquiries (${leads.length})`} />
              <div className="divide-y divide-[#f0f1f3]">
                {leads.slice(0, 10).map((lead) => (
                  <div key={lead.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold">{lead.reference}</p>
                        <p className="mt-0.5 truncate text-[9px] text-[#62666e]">
                          {lead.packageName ? `${lead.quantity}× ${lead.packageName}` : lead.interest || "General enquiry"}
                        </p>
                        <p className="mt-0.5 text-[8px] text-slate-400">{lead.eventName || lead.source}</p>
                      </div>
                      <StatusPill tone={leadTone(lead.status)}>{LEAD_STATUS_LABELS[lead.status]}</StatusPill>
                    </div>
                  </div>
                ))}
                {leads.length === 0 ? <p className="p-4 text-[9px] text-slate-400">No leads or enquiries recorded.</p> : null}
              </div>
            </AdminPanel>

            <AdminPanel>
              <SectionTitle title={`Confirmed orders (${orders.length})`} />
              <div className="divide-y divide-[#f0f1f3]">
                {orders.slice(0, 10).map((order) => (
                  <div key={order.id} className="flex items-center justify-between gap-3 p-4">
                    <div>
                      <p className="text-[10px] font-semibold">{order.reference}</p>
                      <p className="mt-0.5 text-[8px] text-slate-400">{date(order.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-semibold">{money(order.totalAmount, order.currency)}</p>
                      <p className="mt-0.5 text-[8px] capitalize text-slate-400">{order.status}</p>
                    </div>
                  </div>
                ))}
                {orders.length === 0 ? <p className="p-4 text-[9px] text-slate-400">No confirmed orders recorded.</p> : null}
              </div>
            </AdminPanel>
          </div>

          {!selectedContact ? (
            <AdminPanel>
              <SectionTitle title="Relationship summary" />
              <div className="grid gap-3 p-4 sm:grid-cols-3">
                <div className="rounded-md bg-blue-50 p-3">
                  <UsersRound className="h-4 w-4 text-blue-600" />
                  <p className="mt-2 text-lg font-semibold">{contacts.length}</p>
                  <p className="text-[9px] text-slate-500">Known contacts</p>
                </div>
                <div className="rounded-md bg-violet-50 p-3">
                  <CalendarHeart className="h-4 w-4 text-violet-600" />
                  <p className="mt-2 text-lg font-semibold">{eventInterest.length}</p>
                  <p className="text-[9px] text-slate-500">Events of interest</p>
                </div>
                <div className="rounded-md bg-emerald-50 p-3">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  <p className="mt-2 text-lg font-semibold">{orders.length}</p>
                  <p className="text-[9px] text-slate-500">Orders placed</p>
                </div>
              </div>
            </AdminPanel>
          ) : null}
        </div>
      </div>
        </>
      ) : null}
    </div>
  )
}
