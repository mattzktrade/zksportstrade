import { Download } from "lucide-react"
import { cn } from "@/lib/utils"

type Props = {
  orderId: string
  className?: string
  label?: string
  variant?: "button" | "link"
}

export function InvoicePdfDownloadLink({
  orderId,
  className,
  label = "Download invoice PDF",
  variant = "link",
}: Props) {
  const href = `/api/invoices/${orderId}/pdf`

  if (variant === "button") {
    return (
      <a
        href={href}
        download
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold",
          "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
          className,
        )}
      >
        <Download className="h-3.5 w-3.5" />
        {label}
      </a>
    )
  }

  return (
    <a
      href={href}
      download
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline",
        className,
      )}
    >
      <Download className="h-3.5 w-3.5" />
      {label}
    </a>
  )
}
