import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// basePath-aware path prefixer for static assets in metadata.
// NEXT_PUBLIC_BASE_PATH is set at build time by the GitHub Action
// (e.g. "/Xmodbus-parser" for project Pages sites, empty for root).
const BP = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, '') || '';
const P = (path: string) => `${BP}${path}`;

export const metadata: Metadata = {
  title: "Modbus Analyzer — RTU/ASCII/TCP Traffic Parser",
  description:
    "Progressive Web App for parsing, inspecting and building Modbus RTU/ASCII/TCP traffic. Paste hex, upload a text file or a pcap, get color-coded frame breakdowns, Wireshark-style details, timeline graph, and CSV/JSON/PDF export. Works offline.",
  keywords: [
    "Modbus", "RTU", "ASCII", "TCP", "parser", "decoder",
    "pcap", "analyzer", "industrial", "PWA", "offline",
    "SCADA", "automation", "serial", "Modbus RTU",
  ],
  authors: [{ name: "Tutkis" }],
  manifest: P("/manifest.webmanifest"),
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Modbus Analyzer",
  },
  icons: {
    icon: [
      { url: P("/favicon-32.png"), sizes: "32x32", type: "image/png" },
      { url: P("/favicon-16.png"), sizes: "16x16", type: "image/png" },
      { url: P("/icon-192.png"), sizes: "192x192", type: "image/png" },
      { url: P("/icon-512.png"), sizes: "512x512", type: "image/png" },
      { url: P("/icon.svg"), sizes: "any", type: "image/svg+xml" },
    ],
    apple: [
      { url: P("/apple-touch-icon.png"), sizes: "180x180", type: "image/png" },
    ],
    shortcut: [P("/icon.svg")],
  },
  openGraph: {
    title: "Modbus Analyzer",
    description: "PWA for parsing Modbus RTU/ASCII/TCP traffic",
    type: "website",
    images: [P("/icon-512.png")],
  },
  twitter: {
    card: "summary",
    title: "Modbus Analyzer",
    description: "PWA for parsing Modbus RTU/ASCII/TCP traffic",
    images: [P("/icon-512.png")],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eff1f5" },
    { media: "(prefers-color-scheme: dark)", color: "#1e1e2e" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
