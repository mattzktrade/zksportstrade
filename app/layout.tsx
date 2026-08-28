import type React from "react"
import type { Metadata, Viewport } from "next"
import { Inter, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { LaptopQol } from "@/components/laptop-qol"
import "./globals.css"
import { LOGO_ICON } from "@/lib/branding"

const PLATFORM_SCRIPT = `(function(){try{var p=navigator.platform||"";var u=navigator.userAgent||"";document.documentElement.dataset.platform=/Mac|iPhone|iPad|iPod/.test(p)||/Mac OS X|Macintosh|iPhone|iPad/.test(u)?"mac":"other"}catch(e){}})();`

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  preload: false,
})

export const metadata: Metadata = {
  title: "ZK Sports & Entertainment | Trade Portal",
  description:
    "Exclusive F1 hospitality packages for trade partners. Book premium motorsport experiences for your clients.",
  icons: {
    icon: [{ url: LOGO_ICON.src, type: "image/png", sizes: "32x32" }],
    apple: [{ url: LOGO_ICON.src, type: "image/png" }],
    shortcut: LOGO_ICON.src,
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PLATFORM_SCRIPT }} />
        <link rel="preconnect" href="https://static.wixstatic.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://assets.quintevents.com" crossOrigin="anonymous" />
      </head>
      <body className={`${inter.variable} ${geistMono.variable} font-sans antialiased`}>
        <LaptopQol />
        {children}
        <Analytics />
      </body>
    </html>
  )
}
