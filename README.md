# Livn / Bobber X — Next.js frontend

JavaScript (no TypeScript) Next.js 14 app-router project with Tailwind CSS.
Consumes the PHP backend at `../build/` via a same-origin server-side proxy
(so the browser never needs CORS or API credentials).

```
frontend/
├── package.json                   Next 14.2, React 18, Tailwind 3
├── next.config.mjs
├── tailwind.config.js             includes the `brand` color palette
├── postcss.config.mjs
├── jsconfig.json                  "@/..." path alias → project root
├── .env.local.example             Copy to .env.local
├── app/
│   ├── layout.jsx                 root layout + Header + footer
│   ├── globals.css                Tailwind + .btn/.card/.input component classes
│   ├── page.jsx                   Browse (local cache or live Livn search)
│   ├── products/[id]/page.jsx     Detail + date picker + "Start booking"
│   ├── checkout/[flowId]/page.jsx Wizard: fares → questions → quote → confirm
│   ├── bookings/
│   │   ├── page.jsx               List / search
│   │   └── [id]/page.jsx          Detail + cancel + ticket PDFs
│   ├── tickets/page.jsx           List tickets, download PDFs
│   ├── admin/page.jsx             Cache status, sync, CSV export
│   └── api/
│       ├── livn/[...path]/route.js  Proxy → PHP /api/v1/*
│       └── catalog/route.js         Proxy → PHP /catalog.php (CSV download)
├── components/
│   ├── Header.jsx
│   ├── States.jsx                 <Loading/> <ErrorBox/> <Empty/>
│   ├── ProductCard.jsx
│   ├── FlowStepper.jsx            FARE_SELECTION → FINAL_QUOTE → … progress bar
│   ├── FareSelector.jsx           Base variants × time slots × fares × add-ons
│   ├── QuestionRenderer.jsx       TEXT/EMAIL/PHONE/DATE/SELECT_*/BOOLEAN/BINARY
│   └── QuoteView.jsx              Line items, cancellation policy, T&C
└── lib/
    └── api.js                     apiGet/apiPost/apiPut/apiDelete + formatters
```

---

## 1. Prerequisites

- Node.js 18.17+ (20+ recommended)
- The PHP backend from `../build/` running and reachable. For local dev:

  ```bash
  cd ../build
  cp .env.example .env
  # Set LIVN_MOCK=1 in .env for a full offline demo.
  php -S 127.0.0.1:8080 index.php
  ```

  > Always pass `index.php` as the last arg. The built-in PHP server doesn't
  > read `.htaccess`.

---

## 2. Setup

```bash
cd frontend
cp .env.local.example .env.local
# Open .env.local — make it point at your running PHP backend:
#   LIVN_BACKEND_URL=http://127.0.0.1:8080
# If the PHP backend has OUR_API_KEY set, paste the same value as:
#   LIVN_BACKEND_KEY=<that secret>

npm install
npm run dev
```

Open <http://localhost:3000>.

---

## 3. How it all connects

```
Browser ─► Next.js /api/livn/*  ─► PHP /api/v1/*  ─► Livn (dev.livnapi.com)
Browser ─► Next.js /api/catalog ─► PHP /catalog.php  (CSV attachment)
```

- Every fetch from the browser is same-origin. No CORS headers to configure.
- `LIVN_BACKEND_URL` and `LIVN_BACKEND_KEY` are **server-only** (no
  `NEXT_PUBLIC_` prefix), so they never end up in the client bundle.
- The browser response envelope is the same `{ success, data, error, meta }`
  that the PHP backend emits.

---

## 4. Walk-through: full booking demo

1. **Home** (`/`) — click **Sync catalog now** (one-off) or switch to **Live
   search**. Product cards appear.
2. **Product detail** (`/products/1`) — pick a date from the calendar, click
   **Start booking**. You land on the checkout.
3. **Checkout** (`/checkout/{flowId}`):
   - **FARE_SELECTION** — use the +/- buttons to pick quantities. Click
     **Preview price** for an instant quote without progressing, or
     **Continue** to advance.
   - **FINAL_QUOTE** — fill in the passenger details (name, email, phone,
     DOB). The `QuoteView` shows line items + cancellation policy.
   - **CONFIRMED_BOOKING** — green "Booking confirmed" card. Each ticket
     has a direct PDF link (through `/api/livn/tickets/{id}/pdf`).
4. **Bookings** (`/bookings`) — search/filter, click a row for detail,
   cancel if needed. Voucher PDF available.
5. **Admin** (`/admin`) — trigger a fresh sync, view stats, download the
   CSV catalog (streamed through `/api/catalog`).

---

## 5. Environment variables

Set in `.env.local` for local dev, or in your hosting platform's dashboard
in production. All are server-only.

| Key                  | Example                              | Notes                                         |
|----------------------|--------------------------------------|-----------------------------------------------|
| `LIVN_BACKEND_URL`   | `http://127.0.0.1:8080`              | Where the PHP backend lives                   |
| `LIVN_BACKEND_KEY`   | `<same value as PHP's OUR_API_KEY>`  | Optional — only needed if the PHP side uses it |

---

## 6. Production build

```bash
npm run build
npm run start
```

Or deploy to Vercel / Netlify / a VPS — just remember to configure the two
env vars above. The frontend does **not** need the Livn credentials
themselves; those stay on the PHP side.

---

## 7. Troubleshooting

### Pages render but every API call fails with `proxy_unreachable`

The PHP backend at `LIVN_BACKEND_URL` isn't running or the URL is wrong.
Verify with:

```bash
curl $LIVN_BACKEND_URL/health
```

If that fails, fix the PHP side first.

### 401 `livn_error` everywhere

Real Livn credentials aren't in the PHP `.env`. Either add them or set
`LIVN_MOCK=1` on the PHP side for a full offline demo.

### Home page shows nothing

Your local cache hasn't been synced. Click **Sync catalog now** on the home
page, or run `php bin/sync.php` in the PHP folder.

### Checkout page refreshes and loses state

Flow progress is stashed in `sessionStorage` under `livn.flow.<flowId>`. If
you hit hard-refresh we reload from `GET /api/v1/flows/{id}` — that only
works when Livn knows about the flow (i.e. the flow id exists upstream or
mock mode is on).

### Images don't render

Product images come from `res.cloudinary.com` — the `next.config.mjs`
already allows that and all `https` hosts. If you run behind a proxy that
strips the `Host` header, add the proxy's hostname to `remotePatterns`.

---

## 8. Files to study first

- `lib/api.js` — how the UI talks to the PHP backend (80 lines, no magic).
- `app/checkout/[flowId]/page.jsx` — the wizard logic; reads from
  `flow.steps`, mutates the active step, and PUTs the whole flow back.
- `components/QuestionRenderer.jsx` — how every Livn answer type is handled.
- `components/FareSelector.jsx` — base variants / time slots / fares /
  add-ons rendering.
