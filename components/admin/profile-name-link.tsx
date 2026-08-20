"use client"

import Link from "next/link"
import { adminAccountPath, adminContactPath, adminSupplierPath } from "@/lib/crm/profile-links"
import { cn } from "@/lib/utils"

function stopRowClick(event: React.MouseEvent) {
  event.stopPropagation()
}

export function AccountNameLink({
  accountId,
  name,
  className,
}: {
  accountId?: string | null
  name?: string | null
  className?: string
}) {
  if (!name) return <span className={className}>—</span>
  if (!accountId) return <span className={className}>{name}</span>
  return (
    <Link
      href={adminAccountPath(accountId)}
      onClick={stopRowClick}
      className={cn("hover:text-primary hover:underline", className)}
    >
      {name}
    </Link>
  )
}

export function ContactNameLink({
  accountId,
  contactId,
  name,
  className,
}: {
  accountId?: string | null
  contactId?: string | null
  name?: string | null
  className?: string
}) {
  if (!name) return <span className={className}>—</span>
  if (!accountId || !contactId) return <span className={className}>{name}</span>
  return (
    <Link
      href={adminContactPath(accountId, contactId)}
      onClick={stopRowClick}
      className={cn("hover:text-primary hover:underline", className)}
    >
      {name}
    </Link>
  )
}

export function SupplierNameLink({
  supplierId,
  name,
  className,
}: {
  supplierId?: string | null
  name?: string | null
  className?: string
}) {
  if (!name) return <span className={className}>—</span>
  if (!supplierId) return <span className={className}>{name}</span>
  return (
    <Link
      href={adminSupplierPath(supplierId)}
      onClick={stopRowClick}
      className={cn("hover:text-primary hover:underline", className)}
    >
      {name}
    </Link>
  )
}
