import { whatsapp } from '../../config/env.js';
import { MessageLog, WaJob } from '../../models/whatsapp.js';
import type { MessageType, TemplateCategory } from './constants.js';
import { WA_BACKOFF_MS } from './constants.js';
import { getWhatsAppSettings } from './settings.js';
import { sendWaTemplate } from './client.js';
import { logger } from '../../utils/logger.js';

/**
 * Durable outbox + background worker.
 *
 * HTTP requests only write a MessageLog and a WaJob row — they never talk to
 * Meta. A timer drains the queue every few seconds, so an order can be placed
 * even while WhatsApp is down, and the message retries with backoff instead of
 * being lost. Idempotency comes from the unique `dedupeKey` on MessageLog.
 */

export interface EnqueueInput {
  mobile: string;
  templateName: string;
  category: TemplateCategory;
  type: MessageType;
  language?: string;
  components?: Array<Record<string, unknown>>;
  customerId?: string;
  orderId?: string;
  campaignId?: string;
  dedupeKey?: string;
}

export interface EnqueueResult {
  queued: boolean;
  reason?: string;
  messageLogId?: string;
}

export async function enqueueWhatsApp(input: EnqueueInput): Promise<EnqueueResult> {
  if (!/^\d{10,15}$/.test(input.mobile.replace(/\D/g, ''))) {
    return { queued: false, reason: 'valid mobile nahi hai' };
  }

  const settings = await getWhatsAppSettings();
  if (!settings.enabled) return { queued: false, reason: 'whatsapp disabled' };

  if (input.dedupeKey) {
    const existing = await MessageLog.exists({
      dedupeKey: input.dedupeKey,
      status: { $in: ['PENDING', 'SENT', 'DELIVERED', 'READ'] },
    });
    if (existing) return { queued: false, reason: 'duplicate — pehle se gaya' };
  }

const log = await MessageLog.create({
    mobile: input.mobile.replace(/\D/g, ''),
    type: input.type,
    category: input.category,
    templateName: input.templateName,
    customerId: input.customerId ?? undefined,
    orderId: input.orderId ?? undefined,
    campaignId: input.campaignId ?? undefined,
    dedupeKey: input.dedupeKey ?? undefined,
    status: 'PENDING',
    mode: whatsapp.mode,
  }).catch((err: unknown) => {
    // Two enqueues racing on the same dedupeKey: the unique index is the
    // source of truth — the loser gets a duplicate and must not queue twice.
    if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 11000) {
      return null as unknown as InstanceType<typeof MessageLog>;
    }
    throw err;
  });

  if (!log) return { queued: false, reason: 'duplicate — pehle se gaya' };

  await WaJob.create({
    messageLog: log._id,
    mobile: input.mobile.replace(/\D/g, ''),
    templateName: input.templateName,
    language: input.language ?? 'en_US',
    category: input.category,
    components: input.components ?? [],
    status: 'PENDING',
    nextAt: new Date(),
  });

  return { queued: true, messageLogId: String(log._id) };
}

/** Marks the MessageLog row from a successful Meta send. */
async function markSent(messageLogId: string, wamid: string, transport: string): Promise<void> {
  await MessageLog.updateOne(
    { _id: messageLogId },
    {
      $set: {
        status: 'SENT',
        metaMessageId: wamid,
        sentAt: new Date(),
        updatedAt: new Date(),
        failureReason: '',
        errorCode: 0,
      },
    },
  );
  logger.debug({ wamid, transport }, 'whatsapp message sent');
}

async function markFailed(messageLogId: string, reason: string, errorCode?: number): Promise<void> {
  await MessageLog.updateOne(
    { _id: messageLogId },
    {
      $set: {
        status: 'FAILED',
        failureReason: reason.slice(0, 400),
        errorCode: errorCode ?? 0,
        updatedAt: new Date(),
      },
    },
  );
}

let workerBusy = false;

/** Sends up to `max` due jobs. Runs on an interval, never overlaps itself. */
export async function drainWaQueue(max = 20): Promise<void> {
  if (workerBusy) return;
  workerBusy = true;
  try {
    const settings = await getWhatsAppSettings();
    if (!settings.enabled) return;

    // Atomically claim one due job at a time. `PENDING → SENDING` via
    // findOneAndUpdate is the lease: two workers on two instances can never
    // claim the same row, so a message is never double-sent. Stale `SENDING`
    // rows from a dead process are NOT re-picked — after `maxAttempts` a
    // message goes FAILED, which the admin can inspect/retry.
    for (let i = 0; i < max; i++) {
      const job = await WaJob.findOneAndUpdate(
        { status: 'PENDING', nextAt: { $lte: new Date() } },
        { $set: { status: 'SENDING', updatedAt: new Date() } },
        { sort: { createdAt: 1 }, new: true },
      );
      if (!job) break;

      const result = await sendWaTemplate({
        mobile: job.mobile,
        templateName: job.templateName,
        language: job.language,
        components: (job.components as Array<Record<string, unknown>> | undefined) ?? [],
      });

      if (result.ok && job.messageLog) {
        await markSent(String(job.messageLog), result.wamid, result.transport);
        job.status = 'SUCCESS';
        job.updatedAt = new Date();
        await job.save();
      } else if (result.ok) {
        // No linked message row — just record the job.
        job.status = 'SUCCESS';
        job.updatedAt = new Date();
        await job.save();
      } else if (result.retryable && job.attempts < job.maxAttempts) {
        job.attempts += 1;
        job.status = 'PENDING';
        job.lastError = result.message;
        const backoff = WA_BACKOFF_MS[Math.min(job.attempts - 1, WA_BACKOFF_MS.length - 1)] ?? 60_000;
        job.nextAt = new Date(Date.now() + backoff);
        job.updatedAt = new Date();
        await job.save();
      } else {
        if (job.messageLog) await markFailed(String(job.messageLog), result.message, result.meta?.code);
        job.status = 'FAILED';
        job.lastError = result.message;
        job.updatedAt = new Date();
        await job.save();
      }
    }
  } finally {
    workerBusy = false;
  }
}

/**
 * Starts the polling worker. Called once from the server entrypoint after the
 * DB is connected; the interval is deliberately small so an OTP login or an
 * order notification lands within a few seconds of being queued.
 */
export function startWaWorker(intervalMs = 4_000): ReturnType<typeof setInterval> {
  void drainWaQueue().catch((err) => logger.warn({ err: (err as Error).message }, 'wa worker start failed'));
  return setInterval(() => {
    void drainWaQueue().catch((err) => logger.warn({ err: (err as Error).message }, 'wa worker error'));
  }, intervalMs);
}