import './globals.css';
import Header from '@/components/Header';
import { MoneyProvider } from '@/components/MoneyProvider';

export const metadata = {
  title: 'wcities — Tours, Activities & Tickets',
  description:
    'wcities: discover tours and activities around the world, manage bookings, and issue tickets in one modern console.',
};

export const viewport = {
  themeColor: '#192f66',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col antialiased">
        <MoneyProvider>
          <Header />
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8">
            {children}
          </main>
          <footer className="mt-12 border-t border-slate-200/70 bg-white/60 backdrop-blur">
            <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col md:flex-row gap-3 md:items-center md:justify-between text-xs text-ink-500">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-brand-700 text-white grid place-items-center text-[10px] font-bold">
                  w
                </span>
                <span className="font-semibold text-ink-700">wcities</span>
                <span className="muted">· Tours &amp; Activities platform</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>Prices shown in USD · converted from supplier currency</span>
                <span>© {new Date().getFullYear()} wcities</span>
              </div>
            </div>
          </footer>
        </MoneyProvider>
      </body>
    </html>
  );
}
