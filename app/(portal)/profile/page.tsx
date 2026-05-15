"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { usePortalUser } from "@/components/portal-user-provider"
import { createClient } from "@/lib/supabase/client"
import { checkoutDefaultsFromProfile } from "@/lib/types/checkout-addresses"
import type { CheckoutAddressFields } from "@/lib/types/checkout-addresses"
import { User, Mail, Building2, Phone, Edit3, Save, X, Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

export default function ProfilePage() {
  const router = useRouter()
  const portalUser = usePortalUser()
  const [isEditing, setIsEditing] = useState(false)
  const [activeTab, setActiveTab] = useState<"profile" | "security">("profile")
  const [saving, setSaving] = useState(false)

  const [fullName, setFullName] = useState(portalUser.full_name)
  const [companyName, setCompanyName] = useState(portalUser.company_name)
  const [mobile, setMobile] = useState(portalUser.mobile ?? "")
  const [addresses, setAddresses] = useState<CheckoutAddressFields>(() => checkoutDefaultsFromProfile(portalUser))

  useEffect(() => {
    if (!isEditing) {
      setFullName(portalUser.full_name)
      setCompanyName(portalUser.company_name)
      setMobile(portalUser.mobile ?? "")
      setAddresses(checkoutDefaultsFromProfile(portalUser))
    }
  }, [
    portalUser.full_name,
    portalUser.company_name,
    portalUser.mobile,
    portalUser.shipping_address_line1,
    portalUser.shipping_address_line2,
    portalUser.shipping_city,
    portalUser.shipping_postcode,
    portalUser.shipping_country,
    portalUser.billing_address_line1,
    portalUser.billing_address_line2,
    portalUser.billing_city,
    portalUser.billing_postcode,
    portalUser.billing_country,
    isEditing,
  ])

  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  async function saveProfile() {
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        company_name: companyName.trim(),
        mobile: mobile.trim(),
        shipping_address_line1: addresses.shippingAddressLine1.trim(),
        shipping_address_line2: addresses.shippingAddressLine2.trim(),
        shipping_city: addresses.shippingCity.trim(),
        shipping_postcode: addresses.shippingPostcode.trim(),
        shipping_country: addresses.shippingCountry.trim(),
        billing_address_line1: addresses.billingAddressLine1.trim(),
        billing_address_line2: addresses.billingAddressLine2.trim(),
        billing_city: addresses.billingCity.trim(),
        billing_postcode: addresses.billingPostcode.trim(),
        billing_country: addresses.billingCountry.trim(),
      })
      .eq("id", portalUser.id)
    setSaving(false)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success("Profile updated")
    setIsEditing(false)
    router.refresh()
  }

  async function updatePassword() {
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters")
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match")
      return
    }
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSaving(false)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success("Password updated")
    setNewPassword("")
    setConfirmPassword("")
    router.refresh()
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-0">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Profile</h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">Your trade portal contact details</p>
        </div>
      </div>

      <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-xl w-full sm:w-fit overflow-x-auto">
        {[
          { id: "profile" as const, label: "Profile", icon: User },
          { id: "security" as const, label: "Security", icon: Lock },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
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

      {activeTab === "profile" && (
        <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 space-y-4 sm:space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0 mb-4 sm:mb-6">
            <div>
              <h2 className="text-lg sm:text-xl font-semibold text-foreground">Account</h2>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                Name, company, mobile number, and saved checkout addresses
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (isEditing) {
                  setFullName(portalUser.full_name)
                  setCompanyName(portalUser.company_name)
                  setMobile(portalUser.mobile ?? "")
                  setAddresses(checkoutDefaultsFromProfile(portalUser))
                }
                setIsEditing(!isEditing)
              }}
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
                  Edit
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
                <User className="h-4 w-4 text-muted-foreground" />
                Full name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
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
                <Building2 className="h-4 w-4 text-muted-foreground" />
                Company
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
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
                Mobile
              </label>
              <input
                type="tel"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                disabled={!isEditing}
                autoComplete="tel"
                placeholder={isEditing ? "e.g. +44 7426 610346" : "Not set"}
                className={cn(
                  "w-full px-4 py-3 rounded-xl text-sm transition-all",
                  isEditing
                    ? "bg-muted/50 border border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
                    : "bg-transparent border border-border",
                )}
              />
              <p className="text-xs text-muted-foreground mt-1">
                For urgent booking or payment matters. Include country code where possible.
              </p>
            </div>

            <div className="md:col-span-2">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                Sign-in email
              </label>
              <input
                type="email"
                value={portalUser.email}
                disabled
                className="w-full px-4 py-3 rounded-xl text-sm bg-muted/30 border border-border text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground mt-1">To change email, contact ZK Sports & Entertainment.</p>
            </div>
          </div>

          <div className="border-t border-border pt-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Default shipping address</h3>
              <p className="text-xs text-muted-foreground mt-1">Pre-filled on checkout; you can change per order.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-2">Address line 1</label>
                <input
                  type="text"
                  value={addresses.shippingAddressLine1}
                  onChange={(e) => setAddresses({ ...addresses, shippingAddressLine1: e.target.value })}
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
                <label className="block text-sm font-medium text-foreground mb-2">Address line 2</label>
                <input
                  type="text"
                  value={addresses.shippingAddressLine2}
                  onChange={(e) => setAddresses({ ...addresses, shippingAddressLine2: e.target.value })}
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
                <label className="block text-sm font-medium text-foreground mb-2">City</label>
                <input
                  type="text"
                  value={addresses.shippingCity}
                  onChange={(e) => setAddresses({ ...addresses, shippingCity: e.target.value })}
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
                <label className="block text-sm font-medium text-foreground mb-2">Postcode / ZIP</label>
                <input
                  type="text"
                  value={addresses.shippingPostcode}
                  onChange={(e) => setAddresses({ ...addresses, shippingPostcode: e.target.value })}
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
                <label className="block text-sm font-medium text-foreground mb-2">Country</label>
                <input
                  type="text"
                  value={addresses.shippingCountry}
                  onChange={(e) => setAddresses({ ...addresses, shippingCountry: e.target.value })}
                  disabled={!isEditing}
                  className={cn(
                    "w-full px-4 py-3 rounded-xl text-sm transition-all",
                    isEditing
                      ? "bg-muted/50 border border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
                      : "bg-transparent border border-border",
                  )}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-6 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Default billing address</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-2">Address line 1</label>
                <input
                  type="text"
                  value={addresses.billingAddressLine1}
                  onChange={(e) => setAddresses({ ...addresses, billingAddressLine1: e.target.value })}
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
                <label className="block text-sm font-medium text-foreground mb-2">Address line 2</label>
                <input
                  type="text"
                  value={addresses.billingAddressLine2}
                  onChange={(e) => setAddresses({ ...addresses, billingAddressLine2: e.target.value })}
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
                <label className="block text-sm font-medium text-foreground mb-2">City</label>
                <input
                  type="text"
                  value={addresses.billingCity}
                  onChange={(e) => setAddresses({ ...addresses, billingCity: e.target.value })}
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
                <label className="block text-sm font-medium text-foreground mb-2">Postcode / ZIP</label>
                <input
                  type="text"
                  value={addresses.billingPostcode}
                  onChange={(e) => setAddresses({ ...addresses, billingPostcode: e.target.value })}
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
                <label className="block text-sm font-medium text-foreground mb-2">Country</label>
                <input
                  type="text"
                  value={addresses.billingCountry}
                  onChange={(e) => setAddresses({ ...addresses, billingCountry: e.target.value })}
                  disabled={!isEditing}
                  className={cn(
                    "w-full px-4 py-3 rounded-xl text-sm transition-all",
                    isEditing
                      ? "bg-muted/50 border border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
                      : "bg-transparent border border-border",
                  )}
                />
              </div>
            </div>
          </div>

          {isEditing && (
            <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setFullName(portalUser.full_name)
                  setCompanyName(portalUser.company_name)
                  setMobile(portalUser.mobile ?? "")
                  setAddresses(checkoutDefaultsFromProfile(portalUser))
                  setIsEditing(false)
                }}
                className="w-full sm:w-auto px-4 sm:px-5 py-2 sm:py-2.5 border border-border rounded-xl text-sm sm:text-base font-semibold hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveProfile()}
                className="flex items-center justify-center gap-2 w-full sm:w-auto px-4 sm:px-5 py-2 sm:py-2.5 bg-primary text-white rounded-xl text-sm sm:text-base font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                Save
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === "security" && (
        <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 space-y-4 sm:space-y-6">
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-foreground mb-1">Password</h3>
            <p className="text-xs sm:text-sm text-muted-foreground">Set a new password for this email login.</p>
          </div>

          <div className="space-y-3 sm:space-y-4 max-w-md">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="Repeat password"
                autoComplete="new-password"
              />
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => void updatePassword()}
              className="w-full sm:w-auto px-4 sm:px-5 py-2 sm:py-2.5 bg-foreground text-background rounded-xl text-sm sm:text-base font-semibold hover:bg-foreground/90 transition-colors disabled:opacity-50"
            >
              Update password
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
