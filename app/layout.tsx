import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flight Searcher",
  description: "易遊網機票監控與比價",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" className="h-full antialiased">
      <body className="min-h-full bg-gray-950 text-gray-100">{children}</body>
    </html>
  );
}
