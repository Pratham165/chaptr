import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // Query unread updates count strictly scoped to the authenticated session user
  const unreadCount = session?.user?.id
    ? await db.readingProgress.count({
        where: {
          userId: session.user.id,
          hasUpdate: true,
        },
      })
    : 0;

  return (
    <div className="min-h-screen flex flex-col bg-ink-950 text-paper-50 font-sans selection:bg-accent-red selection:text-paper-50">
      {/* Header */}
      <header className="border-b border-ink-700 bg-ink-900/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/library" className="flex items-center gap-2 group">
              <span className="w-2 h-2 rounded-full bg-accent-red" />
              <span className="font-serif text-xl font-bold tracking-tight text-paper-50 group-hover:text-accent-red transition-colors">
                CHAPTR
              </span>
            </Link>
            <nav className="flex items-center gap-6 text-sm">
              <Link
                href="/library"
                className="text-paper-50 hover:text-accent-red font-medium transition-colors"
              >
                Library
              </Link>
              <Link
                href="/dashboard"
                className="text-paper-400 hover:text-paper-50 font-medium transition-colors relative flex items-center gap-1.5"
              >
                <span>Dashboard</span>
                {unreadCount > 0 && (
                  <span
                    data-testid="nav-unread-indicator"
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-paper-50 bg-accent-red rounded-full"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-paper-50" />
                    <span>{unreadCount}</span>
                  </span>
                )}
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-4 text-sm">
            {session?.user?.email && (
              <span className="text-paper-400 text-xs hidden sm:inline-block">
                {session.user.name || session.user.email}
              </span>
            )}
            {session ? (
              <form
                action={async () => {
                  "use server";
                  await signOut();
                }}
              >
                <button
                  type="submit"
                  className="text-xs uppercase tracking-wider text-paper-400 hover:text-accent-red px-2.5 py-1 border border-ink-700 hover:border-ink-700 bg-ink-950 rounded-[4px] transition-colors"
                >
                  Sign out
                </button>
              </form>
            ) : (
              <Link
                href="/login"
                className="text-xs uppercase tracking-wider bg-accent-red hover:bg-accent-red-dim text-paper-50 px-3 py-1.5 rounded-[4px] transition-colors"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      {/* Footer with MangaDex credit per Acceptable Usage Policy */}
      <footer className="border-t border-ink-700 bg-ink-900 py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-paper-400">
          <div>
            <span className="font-serif font-semibold text-paper-50">CHAPTR</span> &mdash; Ink on paper reading tracker.
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-paper-400 opacity-60" />
            <span>Data provided by MangaDex</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
