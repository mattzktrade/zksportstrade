import type React from "react"
import type { Metadata } from "next"
import { Inter, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import { LOGO_ICON } from "@/lib/branding"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "ZK Sports & Entertainment | Trade Portal",
  description:
    "Exclusive F1 hospitality packages for trade partners. Book premium motorsport experiences for your clients.",
  generator: "v0.app",
  icons: {
    icon: [{ url: LOGO_ICON.src, type: "image/png", sizes: "32x32" }],
    apple: [{ url: LOGO_ICON.src, type: "image/png" }],
    shortcut: LOGO_ICON.src,
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${geistMono.variable} font-sans antialiased`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
