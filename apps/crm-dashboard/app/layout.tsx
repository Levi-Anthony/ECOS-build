import type { Metadata, Viewport } from "next";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ECOS Dashboard",
  description: "ECOS relationship intelligence dashboard",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <nav className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="font-semibold text-gray-900 tracking-tight">ECOS</span>
          <a href="/" className="inline-flex min-h-10 min-w-[40px] items-center text-sm text-gray-600 hover:text-gray-900 transition-colors">Contacts</a>
          <a href="/people" className="inline-flex min-h-10 min-w-[40px] items-center text-sm text-gray-600 hover:text-gray-900 transition-colors">People</a>
          <a href="/brain" className="inline-flex min-h-10 min-w-[40px] items-center text-sm text-gray-600 hover:text-gray-900 transition-colors">BRAIN</a>
          <a href="/artifacts" className="inline-flex min-h-10 min-w-[40px] items-center text-sm text-gray-600 hover:text-gray-900 transition-colors">Artifacts</a>
          <a href="/taste" className="inline-flex min-h-10 min-w-[40px] items-center text-sm text-gray-600 hover:text-gray-900 transition-colors">Taste</a>
          <a href="/it" className="inline-flex min-h-10 min-w-[40px] items-center text-sm text-gray-600 hover:text-gray-900 transition-colors">IT</a>
          <a href="/follow-ups" className="inline-flex min-h-10 min-w-[40px] items-center text-sm text-gray-600 hover:text-gray-900 transition-colors">Follow-ups</a>
          <a href="/weekly" className="inline-flex min-h-10 min-w-[40px] items-center text-sm text-gray-600 hover:text-gray-900 transition-colors">Weekly</a>
          <a href="/briefings" className="inline-flex min-h-10 min-w-[40px] items-center text-sm text-gray-600 hover:text-gray-900 transition-colors">Briefings</a>
        </nav>
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</main>
      </body>
    </html>
  );
}
