import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flight Searcher",
  description: "機票監控與雙來源比價 (易遊網 + Trip.com)",
};

/* Block script to set initial theme before React hydration (no flash). */
const themeInitScript = `
(function(){
  try {
    var t = localStorage.getItem('theme') || 'dark';
    if (t === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full bg-gray-950 text-gray-100">{children}</body>
    </html>
  );
}
