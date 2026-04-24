// Server-only: append-only date-rotated booking log.
//
// One file per UTC date at log/YYYY-MM-DD.jsonl (one JSON object per line
// so it stays grep-able and parseable). Each event captures everything
// support needs to reconcile a transaction with a booking — Braintree
// transaction id, Livn flow / booking ids, product, amount, status, error.
//
// Designed for the post-booking flow:
//   - status === 'captured'        → happy path, money taken
//   - status === 'capture_failed'  → booking confirmed but capture failed
//                                    → MUST be settled manually in Braintree
//                                    → email is critical
//   - status === 'auth_voided'     → auth happened, booking failed, hold released
//   - status === 'auth_failed'     → auth declined, no booking, no money

import { promises as fs } from 'node:fs';
import path from 'node:path';

const LOG_DIR = path.join(process.cwd(), 'log');

function todayUtc() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function appendBookingLog(event) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  const file = path.join(LOG_DIR, `${todayUtc()}.jsonl`);
  await fs.mkdir(LOG_DIR, { recursive: true });
  // 'a' append-only; one line per event so grep / jq work cleanly.
  await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
  return { file, entry };
}
