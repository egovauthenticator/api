import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { hashPassword } from '../utils/utils.js';

/* ------------------------------
   Helpers: load HTML from env
   ------------------------------ */

// Some users accidentally paste with leading/trailing backticks or whitespace
function sanitizeEnvHtml(raw) {
  if (!raw) return null;
  let v = raw.trim();
  // strip wrapping backticks if present (common mistake)
  if (v.startsWith('`') && v.endsWith('`')) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

async function loadTemplate(kind) {
  // Prefer plain HTML env var; otherwise try base64; otherwise null
  if (kind === 'verify') {
    return sanitizeEnvHtml(process.env.EV_TEMPLATE);
  }
  if (kind === 'reset') {
    return sanitizeEnvHtml(process.env.EV_RESET_TEMPLATE);
  }
  return null;
}

/* ------------------------------
   Mail transport
   ------------------------------ */
function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: env?.evEmail || process.env.EV_EMAIL,
      pass: (env?.evPass || process.env.EV_PASS)?.toString().trim(),
    },
  });
}

/* ------------------------------
   Public API
   ------------------------------ */

export async function sendEmailVerification(recipient, otp) {
  const transporter = createTransporter();

  const evEmail = env?.evEmail || process.env.EV_EMAIL;
  const evAddress = env?.evAddress || process.env.EV_ADDRESS;
  const evSubject = env?.evSubject || process.env.EV_SUBJECT;
  const evCompany = env?.evCompany || process.env.EV_COMPANY;
  const evVerifyURL = (env?.evUrl || process.env.EV_URL || '').replace(/\/+$/, '');

  // Load HTML template from env (or fallback bundled)
  let html = await loadTemplate('verify');

  // Replace tokens
  html = html.replace('{{_OTP_}}', otp);

  const hashedOTP = await hashPassword(otp);
  const verifyUrl = `${evVerifyURL}?email=${encodeURIComponent(recipient)}&code=${encodeURIComponent(hashedOTP)}`;
  html = html.replace('{{_URL_}}', verifyUrl);
  html = html.replace('{{_YEAR_}}', String(new Date().getFullYear()));
  html = html.split('{{_COMPANY_}}').join(evCompany ?? '');

  // Send
  await transporter.sendMail({
    from: evAddress || evEmail,
    to: recipient,
    subject: evSubject,
    html,
  });

  return true;
}

export async function sendResetPasswordOtp(recipient, otp) {
  const transporter = createTransporter();

  const evEmail = env?.evEmail || process.env.EV_EMAIL;
  const evAddress = env?.evAddress || process.env.EV_ADDRESS;
  const evSubject = env?.evResetSubject || process.env.EV_RESET_SUBJECT;
  const evCompany = env?.evCompany || process.env.EV_COMPANY;
  const evVerifyURL = (env?.evUrl || process.env.EV_URL || '').replace(/\/+$/, '');

  // Load HTML template from env (or fallback bundled)
  let html = await loadTemplate('reset');

  // Replace tokens
  html = html.replace('{{_OTP_}}', otp);

  const hashedOTP = await hashPassword(otp);
  const resetUrl = `${evVerifyURL}?user=${encodeURIComponent(recipient)}&code=${encodeURIComponent(hashedOTP)}`;
  html = html.replace('{{_URL_}}', resetUrl);
  html = html.replace('{{_YEAR_}}', String(new Date().getFullYear()));
  html = html.split('{{_COMPANY_}}').join(evCompany ?? '');

  // Send
  await transporter.sendMail({
    from: evAddress || evEmail,
    to: recipient,
    subject: evSubject,
    html,
  });

  return true;
}
