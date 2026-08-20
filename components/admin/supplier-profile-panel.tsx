import Link from "next/link"
import {
  Boxes,
  CircleDollarSign,
  Mail,
  PackageCheck,
  Phone,
  ShoppingCart,
  TrendingUp,
} from "lucide-react"
import {
  AdminPanel,
  AdminStatCard,
  SectionTitle,
  StatusPill,
} from "@/components/admin/admin-page-kit"
import { adminDealPath } from "@/lib/admin/deal-link"
import { adminPackagePath } from "@/lib/admin/package-link"
import { purchaseOrderAdminHref } from "@/lib/admin/purchase-order-link"
import type { SupplierProfile } from "@/lib/admin/supplier-profile"
import { DEAL_STAGE_LABELS, type DealStage } from "@/lib/crm/deal-types"
import { adminAccountPath } from "@/lib/crm/profile-links"
import { SupplierCoverageEditor, SupplierDetailsEditor } from "@/components/admin/crm-profile-editors"
import type { AdminRaceOption } from "@/lib/admin/queries"

const WON_STAGES = new Set<DealStage>(["paid_confirmed", "in_fulfilment", "fulfilled"])
const LOST_STAGES = new Set<DealStage>(["closed_lost", "cancelled"])

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
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

export function SupplierProfilePanel({
  profile,
  hideIdentity = false,
  races = [],
}: {
  profile: SupplierProfile
  hideIdentity?: boolean
  races?: AdminRaceOption[]
}) {
  const { supplier, purchaseOrders, products, deals } = profile
  const purchasedEvents = [...new Set(products.map((product) => product.eventName))]
  const spendLabel =
    profile.spendByCurrency.length === 0
      ? money(0, "USD")
      : profile.spendByCurrency.length === 1
        ? money(profile.spendByCurrency[0].value, profile.spendByCurrency[0].currency)
        : "Mixed"

  return (
    <div className="space-y-3">
      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <AdminStatCard icon={ShoppingCart} value={purchaseOrders.length} label="Purchase orders" tone="blue" />
        <AdminStatCard icon={PackageCheck} value={profile.unitsPurchased} label="Units we buy from them" tone="green" />
        <AdminStatCard icon={Boxes} value={profile.unitsRemaining} label="Units on stock layers" tone="purple" />
        <AdminStatCard icon={TrendingUp} value={profile.unitsAvailable} label="Available after commitments" tone="amber" />
        <AdminStatCard icon={CircleDollarSign} value={spendLabel} label="Tracked purchasing" tone="red" />
      </section>

      <div className="grid gap-3 xl:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.8fr)]">
        <div className="space-y-3">
          {hideIdentity ? (
            <AdminPanel>
              <SectionTitle title="Supplier details" />
              <div className="space-y-3 p-4">
                <dl className="grid grid-cols-[95px_1fr] gap-y-2 text-[9px]">
                  <dt className="text-[#93979f]">Main contact</dt>
                  <dd className="font-medium">{supplier.contactName || "Not set"}</dd>
                  <dt className="text-[#93979f]">Email</dt>
                  <dd>{supplier.contactEmail || "Not set"}</dd>
                  <dt className="text-[#93979f]">Phone</dt>
                  <dd>{supplier.contactPhone || "Not set"}</dd>
                </dl>
                {supplier.notes ? (
                  <p className="whitespace-pre-wrap text-[9px] text-[#62666e]">{supplier.notes}</p>
                ) : null}
              </div>
              <SupplierDetailsEditor supplier={supplier} />
            </AdminPanel>
          ) : (
            <AdminPanel>
              <SectionTitle title="Supplier details" />
              <div className="space-y-4 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                    {(supplier.code || supplier.name).slice(0, 3).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold">{supplier.name}</p>
                    <p className="text-[9px] text-slate-400">{supplier.code || "Structured supplier"}</p>
                  </div>
                </div>
                <dl className="grid grid-cols-[95px_1fr] gap-y-2 border-y border-[#eceef1] py-3 text-[9px]">
                  <dt className="text-[#93979f]">Main contact</dt>
                  <dd className="font-medium">{supplier.contactName || "Not set"}</dd>
                  <dt className="text-[#93979f]">Email</dt>
                  <dd>
                    {supplier.contactEmail ? (
                      <a href={`mailto:${supplier.contactEmail}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                        <Mail className="h-3 w-3" />
                        {supplier.contactEmail}
                      </a>
                    ) : (
                      "Not set"
                    )}
                  </dd>
                  <dt className="text-[#93979f]">Phone</dt>
                  <dd>
                    {supplier.contactPhone ? (
                      <a href={`tel:${supplier.contactPhone}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                        <Phone className="h-3 w-3" />
                        {supplier.contactPhone}
                      </a>
                    ) : (
                      "Not set"
                    )}
                  </dd>
                  <dt className="text-[#93979f]">Supplier since</dt>
                  <dd>{date(supplier.createdAt)}</dd>
                  <dt className="text-[#93979f]">Events covered</dt>
                  <dd>{profile.coverageRaceIds.length || purchasedEvents.length}</dd>
                  <dt className="text-[#93979f]">Products supplied</dt>
                  <dd>{products.length}</dd>
                </dl>
                {supplier.notes ? (
                  <div className="rounded-md bg-[#fafbfc] p-3">
                    <p className="text-[8px] uppercase tracking-wide text-[#9a9ea5]">Internal notes</p>
                    <p className="mt-1 whitespace-pre-wrap text-[9px] text-[#62666e]">{supplier.notes}</p>
                  </div>
                ) : null}
                <SupplierDetailsEditor supplier={supplier} />
              </div>
            </AdminPanel>
          )}

          <AdminPanel>
            <SectionTitle title="What they can supply" />
            <SupplierCoverageEditor
              supplierId={supplier.id}
              raceIds={profile.coverageRaceIds}
              races={races}
            />
            {purchasedEvents.length > 0 ? (
              <div className="border-t border-[#eceef1] p-4">
                <p className="mb-2 text-[9px] font-semibold text-[#555961]">From purchase history</p>
                <div className="flex flex-wrap gap-1.5">
                  {purchasedEvents.map((event) => (
                    <span key={event} className="rounded-md border bg-[#fafbfc] px-2 py-1.5 text-[8px] text-[#656970]">
                      {event}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </AdminPanel>

          <AdminPanel>
            <SectionTitle title="Spend by currency" />
            <div className="divide-y divide-[#f0f1f3]">
              {profile.spendByCurrency.map((entry) => (
                <div key={entry.currency} className="flex items-center justify-between px-4 py-3 text-[9px]">
                  <span className="text-slate-500">{entry.currency}</span>
                  <span className="font-semibold">{money(entry.value, entry.currency)}</span>
                </div>
              ))}
              {profile.spendByCurrency.length === 0 ? (
                <p className="p-4 text-[9px] text-slate-400">No purchasing value recorded.</p>
              ) : null}
            </div>
          </AdminPanel>
        </div>

        <div className="space-y-3">
          <AdminPanel>
            <SectionTitle title={`Stock & supply history (${products.length})`} />
            <div className="border-b border-[#eceef1] bg-[#fafbfc] px-4 py-2 text-[8px] text-[#8e9299]">
              Available subtracts stock already committed to open deals. Coverage is inferred from purchases and deal history.
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-[#92969e]">
                  <tr>
                    <th className="px-4 py-2 font-medium">Product</th>
                    <th className="px-4 py-2 font-medium">Event</th>
                    <th className="px-4 py-2 text-right font-medium">Bought</th>
                    <th className="px-4 py-2 text-right font-medium">Remaining</th>
                    <th className="px-4 py-2 text-right font-medium">Committed</th>
                    <th className="px-4 py-2 text-right font-medium">Available</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f1f3] text-[9px]">
                  {products.map((product) => (
                    <tr key={product.packageId} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link href={adminPackagePath(product.packageId)} className="font-semibold text-primary hover:underline">
                          {product.packageName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{product.eventName}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{product.unitsPurchased}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{product.unitsRemaining}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{product.unitsCommitted}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-600">
                        {product.unitsAvailable}
                      </td>
                    </tr>
                  ))}
                  {products.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-[9px] text-slate-400">
                        No stock or product history linked to this supplier.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </AdminPanel>

          <AdminPanel>
            <SectionTitle title={`Purchase orders (${purchaseOrders.length})`} href="/admin/purchase-orders" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left">
                <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-[#92969e]">
                  <tr>
                    <th className="px-4 py-2 font-medium">PO #</th>
                    <th className="px-4 py-2 font-medium">Issued</th>
                    <th className="px-4 py-2 font-medium">Products</th>
                    <th className="px-4 py-2 text-right font-medium">Bought</th>
                    <th className="px-4 py-2 text-right font-medium">Remaining</th>
                    <th className="px-4 py-2 text-right font-medium">Docs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f1f3] text-[9px]">
                  {purchaseOrders.map((po) => (
                    <tr key={po.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link href={purchaseOrderAdminHref(po.id)} className="font-semibold text-primary hover:underline">
                          {po.poNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{date(po.issuedAt)}</td>
                      <td className="max-w-[280px] px-4 py-3">
                        <p className="truncate">{po.products.join(", ") || "Not linked"}</p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{po.unitsPurchased}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{po.unitsRemaining}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{po.documentCount}</td>
                    </tr>
                  ))}
                  {purchaseOrders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-[9px] text-slate-400">
                        No purchase orders linked to this supplier.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </AdminPanel>

          <AdminPanel>
            <SectionTitle title={`Related deals (${deals.length})`} href="/admin/deals" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-[#92969e]">
                  <tr>
                    <th className="px-4 py-2 font-medium">Deal</th>
                    <th className="px-4 py-2 font-medium">Client</th>
                    <th className="px-4 py-2 font-medium">Product / Event</th>
                    <th className="px-4 py-2 text-right font-medium">Qty</th>
                    <th className="px-4 py-2 font-medium">Supply</th>
                    <th className="px-4 py-2 font-medium">Stage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f1f3] text-[9px]">
                  {deals.map((deal, index) => (
                    <tr key={`${deal.id}-${deal.packageId}-${index}`} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link href={adminDealPath(deal.id)} className="font-semibold text-primary hover:underline">
                          {deal.reference}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {deal.accountId && deal.accountName ? (
                          <Link href={adminAccountPath(deal.accountId)} className="hover:text-primary hover:underline">
                            {deal.accountName}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Link href={adminPackagePath(deal.packageId)} className="font-medium hover:text-primary hover:underline">
                          {deal.packageName}
                        </Link>
                        <p className="text-[8px] text-slate-400">{deal.eventName}</p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{deal.quantity}</td>
                      <td className="px-4 py-3 capitalize">{deal.sourcingMode}</td>
                      <td className="px-4 py-3">
                        <StatusPill tone={stageTone(deal.stage)}>{DEAL_STAGE_LABELS[deal.stage]}</StatusPill>
                      </td>
                    </tr>
                  ))}
                  {deals.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-[9px] text-slate-400">
                        No deal lines assigned to this supplier.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </AdminPanel>
        </div>
      </div>
    </div>
  )
}
