import { env, whatsapp } from '../../config/env.js';
import { MessageLog } from '../../models/whatsapp.js';
import { verifyWaWebhookSignature } from './client.js';
import { logger } from '../../utils/logger.js';

/**
 * WhatsApp delivery status webhook. Meta posts sent/delivered/read/failed
 * events here (mounted raw at /api/webhooks/whatsapp BEFORE the JSON parser —
 * signature check needs the exact bytes). Matches on the "wamid" stored at
 * send time, so the Message Log gets its real delivery timeline for free.
 */

export interface WaWebhookParseResult {
  valid: boolean;
  reason?: string;
  updated: number;
}

function statusMapping(status: string): { status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'; field: 'sentAt' | 'deliveredAt' | 'readAt' } | null {
  switch (status) {
    case 'sent':
      return { status: 'SENT', field: 'sentAt' };
    case 'delivered':
      return { status: 'DELIVERED', field: 'deliveredAt' };
    case 'read':
      return { status: 'READ', field: 'readAt' };
    case 'failed':
      return { status: 'FAILED', field: 'sentAt' };
    default:
      return null;
  }
}

export async function handleWaWebhook(parsed: unknown): Promise<WaWebhookParseResult> {
  let updated = 0;
  const payload = parsed as
    | { entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<Record<string, unknown>> } }> }> }
    | undefined;

  if (!payload?.entry) return { valid: true, reason: 'empty', updated: 0 };

  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const status of value.statuses ?? []) {
        const wamid = String(status.id ?? status.message_id ?? '');
        const mapped = statusMapping(String(status.status ?? ''));
        if (!wamid || !mapped) continue;

        const at = new Date(Number(status.timestamp ?? Date.now()) * 1000);
        if (Number.isNaN(at.getTime())) continue;

        const update: Record<string, unknown> = {
          status: mapped.status,
          updatedAt: new Date(),
        };
        update[mapped.field] = at;
        if (mapped.status === 'READ') update.deliveredAt = at;
        if (mapped.status === 'FAILED') {
          const errors = Array.isArray(status.errors) ? status.errors : [];
          const first = (errors[0] as { title?: string; message?: string } | undefined) ?? {};
          update.failureReason = String(first.message ?? first.title ?? 'Meta delivery failed').slice(0, 400);
        }

        const res = await MessageLog.updateOne({ metaMessageId: wamid }, { $set: update }).exec();
        if (res.modifiedCount > 0) updated += 1;
      }
    }
  }

  return { valid: true, updated };
}

/** GET verification handshake: echo Meta's challenge when tokens match. */
export function webhookChallenge(query: Record<string, unknown>): string | null {
  if (!whatsapp.verifyToken) return null;
  const mode = String(query['hub.mode'] ?? '');
  const token = String(query['hub.verify_token'] ?? '');
  const challenge = String(query['hub.challenge'] ?? '');
  if (mode === 'subscribe' && token === whatsapp.verifyToken && challenge) return challenge;
  return null;
}

/**
 * Signature guard for the POST handler (raw body required). In TEST mode an
 * unset WhatsApp app secret is tolerated so local webhook testing works without
 * Meta config; in PRODUCTION mode a missing/invalid signature is always rejected.
 */
export function authorizedWaWebhook(rawBody: Buffer, header: unknown): boolean {
  const sig = typeof header === 'string' ? header : '';
  if (sig) return verifyWaWebhookSignature(rawBody, sig);
  if (whatsapp.mode === 'test' && !whatsapp.appSecret) {
    logger.warn('whatsapp webhook: app secret set nahi hai (TEST MODE) — signature skip');
    return env.NODE_ENV !== 'production';
  }
  return false;
}