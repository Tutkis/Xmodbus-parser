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

export const metadata: Metadata = {
  title: "Modbus Analyzer — RTU/ASCII/TCP Traffic Parser",
  description:
    "Progressive Web App for parsing, inspecting and building Modbus RTU/ASCII/TCP traffic. Paste hex, upload a text file or a pcap, get color-coded frame breakdowns, Wireshark-style details, timeline graph, and CSV/JSON/PDF export.",
  keywords: [
    "Modbus", "RTU", "ASCII", "TCP", "parser", "decoder",
    "pcap", "analyzer", "industrial", "PWA", "offline",
  ],
  authors: [{ name: "Modbus Analyzer" }],
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Modbus Analyzer",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    title: "Modbus Analyzer",
    description: "PWA for parsing Modbus RTU/ASCII/TCP traffic",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
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
