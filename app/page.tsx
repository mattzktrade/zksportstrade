import { PortalLayout } from "@/components/portal-layout"
import { RacesGrid } from "@/components/dashboard/races-grid"

export default function DashboardPage() {
  return (
    <PortalLayout>
      <div className="p-6 lg:p-8">
        {/* Races Grid with featured hero */}
        <RacesGrid />
      </div>
    </PortalLayout>
  )
}
