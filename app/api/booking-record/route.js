// POST /api/booking-record
// Body: a booking event (see lib/booking-log.js for the canonical fields).
//
// Always writes the date-rotated file log first (cheap, never throws blocks
// the response). Then sends the SMTP notification email if SMTP_* + MAIL_*
// are configured. Failures of either side are surfaced in the response so
// the client can show a soft warning, but neither side blocks the other.

import { appendBookingLog } from '@/lib/booking-log';
import { sendBookingEmail } from '@/lib/mailer';

function ok(data) { return Response.json({ success: true, data }); }
function fail(code, message, status = 400) {
  return Response.json({ success: false, error: { code, message } }, { status });
}

export async function POST(request) {
  let event;
  try { event = await request.json(); } catch { return fail('bad_json', 'Invalid JSON body'); }
  if (!event || typeof event !== 'object') return fail('bad_event', 'Event body missing');
  if (!event.status) return fail('missing_status', 'event.status is required');

  const result = { logged: null, emailed: null };

  try {
    const written = await appendBookingLog(event);
    result.logged = { file: written.file };
  } catch (err) {
    result.logged = { error: String(err?.message || err) };
  }

  try {
    const sent = await sendBookingEmail(event);
    result.emailed = sent;
  } catch (err) {
    result.emailed = { sent: false, error: String(err?.message || err) };
  }

  return ok(result);
}
