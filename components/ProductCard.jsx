'use client';
import Link from 'next/link';
import { truncate, formatDuration, getProductMarkup, applyMarkup } from '@/lib/api';
import { useMoney } from '@/components/MoneyProvider';

export default function ProductCard({ product }) {
  const { formatUsd } = useMoney();
  const imageUrl = product?.images?.[0]?.url || product?.images?.[0] || null;
  const rawFrom = Array.isArray(product?.fromPrices) ? product.fromPrices[0] : null;
  const from = applyMarkup(rawFrom, getProductMarkup(product));
  const categories = (product?.categories || []).map((c) => c?.name || c).filter(Boolean);
  const duration = formatDuration(product?.duration);
  const locCity = product?.locationsStart?.[0]?.city;

  return (
    <Link
      href={`/products/${product.id}`}
      className="card card-hover overflow-hidden group flex flex-col"
    >
      <div className="relative aspect-[4/3] bg-gradient-to-br from-brand-50 to-slate-100 overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={product.name || 'Product image'}
            className="w-full h-full object-cover group-hover:scale-[1.04] transition duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-brand-300">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4 17l5-5 4 4 3-3 4 4M4 4h16v16H4z"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}
        {product.disabled ? (
          <span className="absolute top-2.5 left-2.5 badge bg-red-600 text-white shadow">
            Disabled
          </span>
        ) : null}
        {product.usesNetRates ? (
          <span className="absolute top-2.5 right-2.5 badge bg-amber-400/95 text-amber-950 shadow">
            Net rate
          </span>
        ) : null}
      </div>

      <div className="p-4 flex-1 flex flex-col">
        <h3 className="font-semibold text-ink-900 line-clamp-2 leading-snug">
          {product.name || `Product #${product.id}`}
        </h3>

        <div className="text-xs muted mt-1 flex items-center gap-1.5 flex-wrap">
          {product.supplier?.name ? (
            <span className="truncate max-w-[10rem]">{product.supplier.name}</span>
          ) : null}
          {locCity ? (
            <>
              <Sep />
              <span className="inline-flex items-center gap-1">
                <PinIcon />
                {locCity}
              </span>
            </>
          ) : null}
          {duration ? (
            <>
              <Sep />
              <span className="inline-flex items-center gap-1">
                <ClockIcon />
                {duration}
              </span>
            </>
          ) : null}
        </div>

        {product.description ? (
          <p className="text-sm text-ink-700 mt-2 line-clamp-2">
            {truncate(product.description, 140)}
          </p>
        ) : null}

        <div className="flex items-end justify-between mt-auto pt-3 gap-2">
          <div className="flex flex-wrap gap-1">
            {categories.slice(0, 2).map((c) => (
              <span key={c} className="chip">{c}</span>
            ))}
          </div>
          {from ? (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider muted">From</div>
              <div className="font-bold text-brand-800 text-lg tabular-nums">
                {formatUsd(from)}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function Sep() {
  return <span className="text-ink-400">·</span>;
}

function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 21s-7-6.3-7-12a7 7 0 1 1 14 0c0 5.7-7 12-7 12z"
        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="9" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
