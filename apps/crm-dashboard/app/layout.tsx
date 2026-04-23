import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ECOS Dashboard",
  description: "ECOS relationship intelligence dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
          <span className="font-semibold text-gray-900 tracking-tight">ECOS</span>
          <a href="/" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Contacts</a>
          <a href="/brain" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">BRAIN</a>
          <a href="/it" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">IT</a>
          <a href="/follow-ups" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Follow-ups</a>
          <a href="/weekly" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Weekly</a>
          <a href="/briefings" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Briefings</a>
        </nav>
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
