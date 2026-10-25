import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "FANTASTICZONE · Shop Smart. Save More.", template: "%s · FANTASTICZONE" },
  description:
    "Preorder products from China at buying price. Shipping is grouped into batches and split transparently once your items are measured.",
  applicationName: "FANTASTICZONE",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "FANTASTICZONE", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#F7F7F9",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG" className={inter.variable}>
      <body className="min-h-dvh font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
