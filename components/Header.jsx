'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/',         label: 'Browse' },
  { href: '/bookings', label: 'Bookings' },
  { href: '/tickets',  label: 'Tickets' },
  { href: '/admin',    label: 'Admin' },
];

export default function Header() {
  const pathname = usePathname() || '/';
  const isActive = (href) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');

  return (
    <header className="sticky top-0 z-30 backdrop-blur bg-white/75 border-b border-slate-200/70">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5 group">
          <span
            aria-hidden
            className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-600 to-brand-900 text-white grid place-items-center shadow-brand-glow ring-1 ring-brand-800/40"
          >
            <Logo />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-bold tracking-tight text-ink-900 text-[17px]">wcities</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
              Tours · Activities · Tickets
            </span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {NAV.map((n) => {
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={
                  'relative px-3 py-1.5 text-sm font-medium rounded-lg transition ' +
                  (active
                    ? 'text-brand-800 bg-brand-50'
                    : 'text-ink-500 hover:text-ink-900 hover:bg-slate-100')
                }
              >
                {n.label}
                {active ? (
                  <span className="absolute left-3 right-3 -bottom-[9px] h-0.5 rounded-full bg-brand-700" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/admin" className="hidden sm:inline-flex btn-secondary">
            Sync catalog
          </Link>
        </div>
      </div>

      {/* Mobile nav */}
      <nav className="md:hidden border-t border-slate-200/70 bg-white/80">
        <div className="max-w-7xl mx-auto px-2 py-1.5 flex gap-1 overflow-x-auto">
          {NAV.map((n) => {
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={
                  'px-3 py-1.5 text-sm rounded-md whitespace-nowrap ' +
                  (active
                    ? 'bg-brand-700 text-white'
                    : 'text-ink-700 hover:bg-slate-100')
                }
              >
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}

function Logo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 12c0-4.97 4.03-9 9-9s9 4.03 9 9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M6 13l2.2 6 2.3-7 1.5 9 2-11 1.8 8 2.2-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
