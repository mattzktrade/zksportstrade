import type React from "react"
import type { Metadata } from "next"
import { Inter, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { Toaster } from "sonner"
import "./globals.css"

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
    icon: [{ url: "/images/zk%20small%20image.jpg", type: "image/jpeg" }],
    apple: [{ url: "/images/zk%20small%20image.jpg", type: "image/jpeg" }],
    shortcut: "/images/zk%20small%20image.jpg",
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
        <Toaster richColors position="top-center" />
        <Analytics />
      </body>
    </html>
  )
}
