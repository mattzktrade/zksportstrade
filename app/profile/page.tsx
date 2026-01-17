"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/portal-layout"
import { currentAgent } from "@/lib/data"
import {
  User,
  Building,
  Mail,
  Phone,
  Globe,
  MapPin,
  Award,
  TrendingUp,
  Calendar,
  Edit3,
  Save,
  X,
  Lock,
  Bell,
  Shield,
} from "lucide-react"
import { cn } from "@/lib/utils"

export default function ProfilePage() {
  const [isEditing, setIsEditing] = useState(false)
  const [activeTab, setActiveTab] = useState<"profile" | "security" | "notifications">("profile")

  const [formData, setFormData] = useState({
    name: currentAgent.name,
    email: currentAgent.email,
    company: currentAgent.company,
    phone: "+44 7700 900123",
    website: "www.premiumtravel.co.uk",
    address: "123 High Street, London, SW1A 1AA",
    bio: "Specialist in luxury sports experiences with over 10 years in the travel industry. Focused on providing exceptional F1 hospitality packages to corporate clients.",
  })

  return (
    <PortalLayout>
      <div className="p-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Profile Settings</h1>
            <p className="text-muted-foreground mt-1">Manage your account information and preferences</p>
          </div>
        </div>

        {/* Profile Hero */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="h-32 bg-gradient-to-r from-primary to-primary/70" />
          <div className="px-8 pb-8">
            <div className="flex flex-col md:flex-row md:items-end gap-6 -mt-12">
              <div className="relative">
                <div className="h-24 w-24 rounded-2xl bg-background border-4 border-background shadow-lg flex items-center justify-center">
                  <span className="text-3xl font-bold text-primary">
                    {currentAgent.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </span>
                </div>
                <div className="absolute -bottom-1 -right-1 h-6 w-6 bg-emerald-500 rounded-full border-2 border-background" />
              </div>

              <div className="flex-1">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">{currentAgent.name}</h2>
                    <p className="text-muted-foreground">{currentAgent.company}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="px-4 py-2 bg-primary/10 rounded-xl">
                      <div className="flex items-center gap-2">
                        <Award className="h-5 w-5 text-primary" />
                        <span className="font-semibold text-primary">{currentAgent.tier}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => setIsEditing(!isEditing)}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl font-semibold transition-colors",
                        isEditing ? "bg-muted text-foreground" : "bg-foreground text-background hover:bg-foreground/90",
                      )}
                    >
                      {isEditing ? (
                        <>
                          <X className="h-4 w-4" />
                          Cancel
                        </>
                      ) : (
                        <>
                          <Edit3 className="h-4 w-4" />
                          Edit Profile
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
              <div className="p-4 bg-muted/50 rounded-xl">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <span className="text-sm text-muted-foreground">Total Bookings</span>
                </div>
                <p className="text-2xl font-bold text-foreground">{currentAgent.totalBookings}</p>
              </div>
              <div className="p-4 bg-muted/50 rounded-xl">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm text-muted-foreground">Total Revenue</span>
                </div>
                <p className="text-2xl font-bold text-foreground">${(currentAgent.totalRevenue / 1000).toFixed(0)}K</p>
              </div>
              <div className="p-4 bg-muted/50 rounded-xl">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm text-muted-foreground">Commission Rate</span>
                </div>
                <p className="text-2xl font-bold text-primary">{currentAgent.commission}%</p>
              </div>
              <div className="p-4 bg-muted/50 rounded-xl">
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Member Since</span>
                </div>
                <p className="text-2xl font-bold text-foreground">2022</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-xl w-fit">
          {[
            { id: "profile", label: "Profile", icon: User },
            { id: "security", label: "Security", icon: Lock },
            { id: "notifications", label: "Notifications", icon: Bell },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
                activeTab === tab.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground",
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "profile" && (
          <div className="bg-card rounded-2xl border border-border p-6 space-y-6">
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
                      ? "bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
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
                      ? "bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      : "bg-transparent border border-border",
                  )}
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
                  <Building className="h-4 w-4 text-muted-foreground" />
                  Company Name
                </label>
                <input
                  type="text"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  disabled={!isEditing}
                  className={cn(
                    "w-full px-4 py-3 rounded-xl text-sm transition-all",
                    isEditing
                      ? "bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
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
                      ? "bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      : "bg-transparent border border-border",
                  )}
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  Website
                </label>
                <input
                  type="text"
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                  disabled={!isEditing}
                  className={cn(
                    "w-full px-4 py-3 rounded-xl text-sm transition-all",
                    isEditing
                      ? "bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      : "bg-transparent border border-border",
                  )}
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  Business Address
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  disabled={!isEditing}
                  className={cn(
                    "w-full px-4 py-3 rounded-xl text-sm transition-all",
                    isEditing
                      ? "bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      : "bg-transparent border border-border",
                  )}
                />
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">Bio</label>
              <textarea
                value={formData.bio}
                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                disabled={!isEditing}
                rows={4}
                className={cn(
                  "w-full px-4 py-3 rounded-xl text-sm transition-all resize-none",
                  isEditing
                    ? "bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    : "bg-transparent border border-border",
                )}
              />
            </div>

            {isEditing && (
              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-5 py-2.5 border border-border rounded-xl font-semibold hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-semibold hover:bg-primary/90 transition-colors"
                >
                  <Save className="h-4 w-4" />
                  Save Changes
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === "security" && (
          <div className="bg-card rounded-2xl border border-border p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-1">Password</h3>
              <p className="text-sm text-muted-foreground">Update your password to keep your account secure</p>
            </div>

            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Current Password</label>
                <input
                  type="password"
                  className="w-full px-4 py-3 bg-muted/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Enter current password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">New Password</label>
                <input
                  type="password"
                  className="w-full px-4 py-3 bg-muted/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Enter new password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Confirm New Password</label>
                <input
                  type="password"
                  className="w-full px-4 py-3 bg-muted/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Confirm new password"
                />
              </div>
              <button className="px-5 py-2.5 bg-foreground text-background rounded-xl font-semibold hover:bg-foreground/90 transition-colors">
                Update Password
              </button>
            </div>

            <div className="pt-6 border-t border-border">
              <h3 className="text-lg font-semibold text-foreground mb-1">Two-Factor Authentication</h3>
              <p className="text-sm text-muted-foreground mb-4">Add an extra layer of security to your account</p>
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">Two-Factor Authentication</p>
                    <p className="text-sm text-muted-foreground">Currently disabled</p>
                  </div>
                </div>
                <button className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors">
                  Enable
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "notifications" && (
          <div className="bg-card rounded-2xl border border-border p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-1">Notification Preferences</h3>
              <p className="text-sm text-muted-foreground">Choose how you'd like to be notified</p>
            </div>

            <div className="space-y-4">
              {[
                {
                  title: "Booking Confirmations",
                  description: "Receive notifications when bookings are confirmed",
                  enabled: true,
                },
                {
                  title: "Payment Updates",
                  description: "Get notified about payment status changes",
                  enabled: true,
                },
                { title: "New Packages", description: "Be the first to know about new F1 packages", enabled: false },
                {
                  title: "Availability Alerts",
                  description: "Get notified when popular packages have limited availability",
                  enabled: true,
                },
                { title: "Marketing Emails", description: "Receive promotional offers and updates", enabled: false },
              ].map((item) => (
                <div key={item.title} className="flex items-center justify-between p-4 bg-muted/50 rounded-xl">
                  <div>
                    <p className="font-medium text-foreground">{item.title}</p>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  </div>
                  <button
                    className={cn(
                      "relative w-12 h-6 rounded-full transition-colors",
                      item.enabled ? "bg-primary" : "bg-muted-foreground/30",
                    )}
                  >
                    <div
                      className={cn(
                        "absolute top-1 w-4 h-4 bg-white rounded-full transition-transform",
                        item.enabled ? "translate-x-7" : "translate-x-1",
                      )}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  )
}
