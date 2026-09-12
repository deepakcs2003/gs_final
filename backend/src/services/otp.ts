import { logger } from '../utils/logger.js';
import { integrations } from '../config/env.js';
import { sendOtpViaWhatsApp } from './whatsapp/notify.js';

/**
 * OTP delivery behind a provider interface. `whatsapp` is the ONLY real
 * provider now — the code is delivered as an approved WhatsApp AUTHENTICATION
 * template through the queue. `console` prints the code to the server log for
 * local development. MSG91 and all other SMS providers are gone — WhatsApp
 * replaced them entirely (see README / backend/.env.example).
 */
export interface OtpProvider {
  readonly name: string;
  sendOtp(mobile: string, code: string): Promise<void>;
  /** Free-form transactional message — logged only; Meta blocks customer texts. */
  sendMessage(mobile: string, message: string): Promise<void>;
}

const consoleProvider: OtpProvider = {
  name: 'console',
  async sendOtp(mobile, code) {
    // The one place a code is intentionally printed. Never in production.
    logger.info(`[dev-otp] mobile=${maskMobile(mobile)} code=${code}`);
  },
  async sendMessage(mobile, message) {
    logger.info(`[dev-text] mobile=${maskMobile(mobile)} message=${message.slice(0, 160)}`);
  },
};

/**
 * WhatsApp-backed provider. sendOtp enqueues the OTP template; the queue worker
 * (never the HTTP request) delivers it a moment later. Throws when the message
 * could not be queued (e.g. disabled, or a non-test number in test mode) so the
 * auth route returns a clean "OTP bhejne mein problem" error.
 */
const whatsappProvider: OtpProvider = {
  name: 'whatsapp',
  async sendOtp(mobile, code) {
    await sendOtpViaWhatsApp(mobile, code);
  },
  async sendMessage(mobile, message) {
    // All customer messages are approved WhatsApp templates now — free-text
    // transactional messages are not sent to users (Meta disallows them for
    // business-initiated conversations outside the 24h window).
    logger.info(`[wa-free-text] mobile=${maskMobile(mobile)} skipped msg=${message.slice(0, 160)}`);
  },
};

export function getOtpProvider(): OtpProvider {
  return integrations.whatsapp ? whatsappProvider : consoleProvider;
}

/** Logs and errors show at most the last 4 digits of a phone number. */
export function maskMobile(mobile: string): string {
  if (mobile.length <= 4) return '****';
  return `${'*'.repeat(mobile.length - 4)}${mobile.slice(-4)}`;
}