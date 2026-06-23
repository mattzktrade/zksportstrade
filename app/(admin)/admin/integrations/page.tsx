import Link from "next/link"
import { getSalesforceConnectionStatus } from "@/lib/integrations/salesforce/settings-store"
import { getXeroConnectionStatus } from "@/lib/integrations/xero/settings-store"
import { isWixConfigured } from "@/lib/integrations/wix/config"

export default async function IntegrationsHubPage() {
  const sf = await getSalesforceConnectionStatus()
  const xero = await getXeroConnectionStatus()
  const wix = isWixConfigured()

  const cards = [
    {
      href: "/admin/integrations/salesforce",
      title: "Salesforce",
      description: "Products, opportunities, guest contacts",
      status: sf.connected ? "Connected" : "Not connected",
    },
    {
      href: "/admin/integrations/xero",
      title: "Xero",
      description: "Trade-portal invoices on order placed",
      status: xero.connected ? `Connected (${xero.tenantName})` : "Not connected",
    },
    {
      href: "/admin/integrations/wix",
      title: "Wix",
      description: "Website stock, price, paid orders",
      status: wix ? "API keys configured" : "Not configured",
    },
  ]

  return (
    <div className="p-6 lg:p-8 max-w-[1200px] space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-primary">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold text-foreground mt-2">Integrations</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-xl border border-border bg-card p-5 shadow-sm hover:border-primary/50 transition-colors min-h-[140px] flex flex-col"
          >
            <p className="font-semibold text-foreground">{card.title}</p>
            <p className="text-xs text-muted-foreground mt-1 flex-1">{card.description}</p>
            <p className="text-sm mt-4 text-foreground/80">{card.status}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
