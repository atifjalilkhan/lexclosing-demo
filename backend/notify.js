/**
 * notify.js — email alert to staff when a new intake comes in
 *
 * This is the single feature that makes the difference between "leads sit
 * in a dashboard nobody's watching" and "a paralegal gets pinged the moment
 * someone submits an after-hours intake." Uses Resend (resend.com) because
 * its free tier (100 emails/day, no credit card) comfortably covers a
 * small firm's intake volume; swapping in SendGrid would mean changing
 * only the fetch call below.
 *
 * Safe by default: if RESEND_API_KEY isn't set, this module logs to the
 * console instead of sending an email, so the rest of the app runs fine
 * with zero third-party accounts during development/demo.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_FROM = process.env.NOTIFY_FROM_EMAIL || 'intake@rwhm.com';
const NOTIFY_TO = process.env.NOTIFY_TO_EMAIL; // e.g. intake-alerts@rwhm.com

async function notifyNewIntake({ caseNumber, client, accidentType, accidentDate }) {
  const subject = `New intake: ${caseNumber} — ${client.firstName} ${client.lastName}`;
  const body = [
    `New client intake received.`,
    ``,
    `Case number: ${caseNumber}`,
    `Client: ${client.firstName} ${client.lastName}`,
    `Phone: ${client.phone}`,
    `Email: ${client.email}`,
    `Accident type: ${accidentType}`,
    `Accident date: ${accidentDate}`,
    ``,
    `Log into the admin dashboard to review and assign this case.`,
  ].join('\n');

  if (!RESEND_API_KEY || !NOTIFY_TO) {
    console.log(
      '[notify] RESEND_API_KEY or NOTIFY_TO_EMAIL not set — skipping real ' +
        'email send. Would have sent:\n' +
        `  Subject: ${subject}\n` +
        `  To: ${NOTIFY_TO || '(not configured)'}\n`
    );
    return { sent: false, reason: 'not configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: NOTIFY_TO,
        subject,
        text: body,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[notify] Resend API error:', res.status, errText);
      return { sent: false, reason: `Resend API error: ${res.status}` };
    }

    return { sent: true };
  } catch (err) {
    console.error('[notify] Failed to send intake email:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { notifyNewIntake };
