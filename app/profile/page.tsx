"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/portal-layout"
import { currentAgent } from "@/lib/data"
import {
  User,
  Mail,
  Phone,
  MapPin,
  Edit3,
  Save,
  X,
  Lock,
} from "lucide-react"
import { cn } from "@/lib/utils"

export default function ProfilePage() {
  const [isEditing, setIsEditing] = useState(false)
  const [activeTab, setActiveTab] = useState<"profile" | "security">("profile")

  const [formData, setFormData] = useState({
    name: currentAgent.name,
    email: currentAgent.email,
    phone: "+44 7700 900123",
    billingAddress: "123 High Street, London, SW1A 1AA, United Kingdom",
  })

  return (
    <PortalLayout>
      <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-0">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Profile Settings</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">Manage your account information and security</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-xl w-full sm:w-fit overflow-x-auto">
          {[
            { id: "profile", label: "Profile", icon: User },
            { id: "security", label: "Security", icon: Lock },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={cn(
                "flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap",
                activeTab === tab.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground",
              )}
            >
              <tab.icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "profile" && (
          <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0 mb-4 sm:mb-6">
              <div>
                <h2 className="text-lg sm:text-xl font-semibold text-foreground">Account Information</h2>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">Update your personal details and billing address</p>
              </div>
              <button
                onClick={() => setIsEditing(!isEditing)}
                className={cn(
                  "flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-sm sm:text-base font-semibold transition-colors",
                  isEditing ? "bg-muted text-foreground" : "bg-foreground text-background hover:bg-foreground/90",
                )}
              >
                {isEditing ? (
                  <>
                    <X className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    Cancel
                  </>
                ) : (
                  <>
                    <Edit3 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    Edit Profile
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  Full Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  disabled={!isEditing}
                  className={cn(
                    "w-full px-4 py-3 rounded-xl text-sm transition-all",
                    isEditing
                      ? "bg-muted/50 border border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
                      : "bg-transparent border border-border",
                  )}
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  Email Address
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  disabled={!isEditing}
                  className={cn(
                    "w-full px-4 py-3 rounded-xl text-sm transition-all",
                    isEditing
                      ? "bg-muted/50 border border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
                      : "bg-transparent border border-border",
                  )}
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  disabled={!isEditing}
                  className={cn(
                    "w-full px-4 py-3 rounded-xl text-sm transition-all",
                    isEditing
                      ? "bg-muted/50 border border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
                      : "bg-transparent border border-border",
                  )}
                />
              </div>

              <div className="md:col-span-2">
                <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  Billing Address
                </label>
                <textarea
                  value={formData.billingAddress}
                  onChange={(e) => setFormData({ ...formData, billingAddress: e.target.value })}
                  disabled={!isEditing}
                  rows={3}
                  className={cn(
                    "w-full px-4 py-3 rounded-xl text-sm transition-all resize-none",
                    isEditing
                      ? "bg-muted/50 border border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
                      : "bg-transparent border border-border",
                  )}
                />
              </div>
            </div>

            {isEditing && (
              <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t border-border">
                <button
                  onClick={() => setIsEditing(false)}
                  className="w-full sm:w-auto px-4 sm:px-5 py-2 sm:py-2.5 border border-border rounded-xl text-sm sm:text-base font-semibold hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="flex items-center justify-center gap-2 w-full sm:w-auto px-4 sm:px-5 py-2 sm:py-2.5 bg-primary text-white rounded-xl text-sm sm:text-base font-semibold hover:bg-primary/90 transition-colors"
                >
                  <Save className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  Save Changes
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === "security" && (
          <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 space-y-4 sm:space-y-6">
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-foreground mb-1">Password</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">Update your password to keep your account secure</p>
            </div>

            <div className="space-y-3 sm:space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Current Password</label>
                <input
                  type="password"
                  className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Enter current password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">New Password</label>
                <input
                  type="password"
                  className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Enter new password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Confirm New Password</label>
                <input
                  type="password"
                  className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Confirm new password"
                />
              </div>
              <button className="w-full sm:w-auto px-4 sm:px-5 py-2 sm:py-2.5 bg-foreground text-background rounded-xl text-sm sm:text-base font-semibold hover:bg-foreground/90 transition-colors">
                Update Password
              </button>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  )
}
