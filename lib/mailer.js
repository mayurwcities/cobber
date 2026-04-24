// Server-only: SMTP mailer + booking notification email.
//
// Reads SMTP_* + MAIL_* from env. If SMTP isn't configured, sendMail()
// becomes a no-op and we surface that in the API response instead of
// crashing the booking flow — file logging is independent and always runs.

import nodemailer from 'nodemailer';

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    // Implicit TLS on 465; STARTTLS otherwise. Override with SMTP_SECURE=true/false.
    secure: process.env.SMTP_SECURE
      ? /^true$/i.test(process.env.SMTP_SECURE)
      : port === 465,
    auth: { user, pass },
  });
  return cachedTransporter;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STATUS_LABEL = {
  captured:        { text: 'Booking + Payment Captured',  color: '#166534', bg: '#dcfce7' },
  capture_failed:  { text: 'Booking Confirmed — Capture FAILED', color: '#7f1d1d', bg: '#fee2e2' },
  auth_voided:     { text: 'Booking Failed — Hold Released', color: '#92400e', bg: '#fef3c7' },
  auth_failed:     { text: 'Card Authorization Declined', color: '#7f1d1d', bg: '#fee2e2' },
};

function buildHtml(event) {
  const status = STATUS_LABEL[event.status] || { text: event.status, color: '#0b1430', bg: '#e2e8f0' };
  const rows = [
    ['Status',           status.text],
    ['Timestamp (UTC)',  event.timestamp || new Date().toISOString()],
    ['Environment',      event.environment || (process.env.BRAINTREE_ENVIRONMENT || 'Sandbox')],
    ['Flow ID',          event.flowId],
    ['Booking ID(s)',    Array.isArray(event.bookingIds) ? event.bookingIds.join(', ') : (event.bookingIds || '—')],
    ['Livn Reference',   event.livnReference],
    ['Product ID',       event.productId],
    ['Event / Product',  event.productName],
    ['Date',             event.date],
    ['Amount',           event.amount && event.currency ? `${event.amount} ${event.currency}` : event.amount],
    ['Braintree Txn ID', event.transactionId],
    ['Braintree Status', event.transactionStatus],
    ['Customer',         event.customer],
    ['Error',            event.errorMessage],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '');

  const tr = rows
    .map(([k, v]) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#1f2a4a;background:#f8fafc;width:200px;vertical-align:top;">${escapeHtml(k)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#0b1430;font-family:ui-monospace,Consolas,monospace;">${escapeHtml(v)}</td>
      </tr>
    `).join('');

  return `<!doctype html>
<html><body style="font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,sans-serif;color:#0b1430;background:#f6f8fd;margin:0;padding:24px;">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
    <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
      <div style="font-size:12px;letter-spacing:0.05em;text-transform:uppercase;color:#54618a;">Booking notification</div>
      <div style="display:inline-block;margin-top:6px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;color:${status.color};background:${status.bg};">
        ${escapeHtml(status.text)}
      </div>
    </div>
    <table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px;">
      ${tr}
    </table>
    ${event.status === 'capture_failed' ? `
      <div style="padding:12px 20px;background:#fef2f2;border-top:1px solid #fecaca;color:#7f1d1d;font-size:13px;">
        <strong>Action required:</strong> the customer's booking is confirmed but the card was not charged.
        Please settle transaction <code>${escapeHtml(event.transactionId)}</code> manually in the Braintree control panel within the hold window (~7 days credit / ~30 days debit).
      </div>
    ` : ''}
  </div>
  <div style="max-width:680px;margin:12px auto 0;font-size:11px;color:#54618a;text-align:center;">
    Automated message from the wcities booking system.
  </div>
</body></html>`;
}

function buildSubject(event) {
  const env = event.environment || (process.env.BRAINTREE_ENVIRONMENT || 'Sandbox');
  const tag = env.toLowerCase() === 'production' ? '' : `[${env}] `;
  switch (event.status) {
    case 'captured':       return `${tag}Booking confirmed — ${event.productName || 'product ' + event.productId} (#${Array.isArray(event.bookingIds) ? event.bookingIds.join(',') : event.bookingIds || event.flowId})`;
    case 'capture_failed': return `${tag}⚠ ACTION REQUIRED: capture failed for booking ${Array.isArray(event.bookingIds) ? event.bookingIds.join(',') : event.bookingIds || event.flowId} (txn ${event.transactionId})`;
    case 'auth_voided':    return `${tag}Booking failed — hold released (flow ${event.flowId})`;
    case 'auth_failed':    return `${tag}Card declined (flow ${event.flowId})`;
    default:               return `${tag}Booking event: ${event.status} (flow ${event.flowId})`;
  }
}

export async function sendBookingEmail(event) {
  const transporter = getTransporter();
  if (!transporter) {
    return { sent: false, reason: 'smtp_not_configured' };
  }
  const to = (process.env.MAIL_TO || '').split(',').map(s => s.trim()).filter(Boolean);
  const from = process.env.MAIL_FROM;
  if (!to.length || !from) {
    return { sent: false, reason: 'mail_recipients_or_from_missing' };
  }

  await transporter.sendMail({
    from,
    to,
    subject: buildSubject(event),
    html: buildHtml(event),
  });
  return { sent: true, to };
}
