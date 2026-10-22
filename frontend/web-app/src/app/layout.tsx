import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Universal Agent",
  description: "Delegate work to agents running on machines you control.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-6">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Universal Agent
            </Link>
            <nav className="ml-auto flex items-center gap-4 text-sm">
              <Link
                href="/devices"
                className="text-ink-muted transition-colors duration-hover ease-standard hover:text-ink"
              >
                Devices
              </Link>
              <Link
                href="/workspaces"
                className="text-ink-muted transition-colors duration-hover ease-standard hover:text-ink"
              >
                Workspaces
              </Link>
              <Link
                href="/tasks/new"
                className="rounded-control bg-primary px-3 py-1.5 font-medium text-on-primary transition-colors duration-hover ease-standard hover:bg-primary-strong"
              >
                New task
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
