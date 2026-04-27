'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMoney } from '@/components/MoneyProvider';

const NAV = [
  { href: '/',         label: 'Browse' },
  { href: '/bookings', label: 'Bookings' },
  { href: '/tickets',  label: 'Tickets' },
  { href: '/admin',    label: 'Admin' },
];

// Short list of currencies we surface in the picker even before the FX rates
// table loads from /api/exchange-rates. Once rates arrive we union this with
// every code present in the table so the user can pick anything Livn supports.
const PRIORITY_CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'NZD', 'CAD', 'JPY'];

export default function Header() {
  const pathname = usePathname() || '/';
  const isActive = (href) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');
  // Hide the picker on /checkout/* — that flow's currency is fixed at flow
  // start, so a header-level selector there would only confuse things.
  const onCheckout = pathname.startsWith('/checkout');

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
          {onCheckout ? null : <CurrencyPicker />}
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

function CurrencyPicker() {
  const { preferredDisplayCurrency, setPreferredDisplayCurrency, rates } = useMoney();
  // Build the option list: every currency present in the rates table, ranked
  // with the priority list first so AUD/EUR/USD/etc. cluster at the top.
  const codes = (() => {
    const set = new Set(PRIORITY_CURRENCIES);
    if (rates) for (const k of Object.keys(rates)) set.add(String(k).toUpperCase());
    const all = Array.from(set);
    const priority = PRIORITY_CURRENCIES.filter((c) => all.includes(c));
    const rest = all.filter((c) => !PRIORITY_CURRENCIES.includes(c)).sort();
    return [...priority, ...rest];
  })();
  return (
    <label className="hidden sm:inline-flex items-center gap-1.5 text-xs text-ink-500" title="Display prices in this currency">
      <CoinIcon />
      <select
        aria-label="Display currency"
        value={preferredDisplayCurrency}
        onChange={(e) => setPreferredDisplayCurrency(e.target.value)}
        className="bg-transparent border-0 text-sm font-semibold text-ink-700 focus:outline-none focus:ring-0 cursor-pointer pr-1"
      >
        {codes.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  );
}

function CoinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="text-ink-400">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 9h4.5a1.5 1.5 0 0 1 0 3H10a1.5 1.5 0 0 0 0 3h5M12 6v2m0 8v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
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
