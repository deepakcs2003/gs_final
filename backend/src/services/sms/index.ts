import axios from 'axios';
import { env, integrations } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * OTP delivery, behind a provider interface (README §23).
 *
 * `console` prints the code to the server log for local development. Production
 * refuses to boot with that setting (see config/env.ts), so a mocked OTP can
 * never reach a live deployment.
 */

export interface SmsProvider {
  readonly name: string;
  sendOtp(mobile: string, code: string): Promise<void>;
}

const consoleProvider: SmsProvider = {
  name: 'console',
  async sendOtp(mobile, code) {
    // The one place a code is intentionally printed. Never in production.
    logger.info(`[dev-otp] mobile=${maskMobile(mobile)} code=${code}`);
  },
};

const msg91Provider: SmsProvider = {
  name: 'msg91',
  async sendOtp(mobile, code) {
    if (!integrations.msg91) {
      throw new Error('MSG91 is not configured');
    }

    const response = await axios.post(
      'https://control.msg91.com/api/v5/otp',
      { otp: code },
      {
        params: {
          template_id: env.MSG91_OTP_TEMPLATE_ID,
          mobile,
          sender: env.MSG91_SENDER_ID,
          otp_expiry: 5,
        },
        headers: { authkey: env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
        timeout: 10_000,
        // Redirects on a credentialed POST would leak the auth key to whatever
        // host the response points at.
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 300,
      },
    );

    const body = response.data as { type?: string; message?: string } | undefined;
    if (body?.type && body.type !== 'success') {
      throw new Error(`MSG91 rejected the request: ${String(body.type)}`);
    }
  },
};

const providers: Record<string, SmsProvider> = {
  console: consoleProvider,
  msg91: msg91Provider,
};

export function getSmsProvider(): SmsProvider {
  return providers[env.SMS_PROVIDER] ?? consoleProvider;
}

/** Logs and errors show at most the last 4 digits of a phone number. */
export function maskMobile(mobile: string): string {
  if (mobile.length <= 4) return '****';
  return `${'*'.repeat(mobile.length - 4)}${mobile.slice(-4)}`;
}
