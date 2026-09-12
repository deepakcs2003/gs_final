import { Order } from '../../models/commerce.js';
import { User } from '../../models/user.js';
import { Types, type PipelineStage } from 'mongoose';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { getWhatsAppSettings } from './settings.js';
import { enqueueWhatsApp } from './queue.js';
import { buildComponents } from './templates.js';
import { WaCampaign, type WaCampaignDoc } from '../../models/whatsapp.js';

/** Route-friendly error so the admin UI sees a clean message, not a 500. */
const badRequest = (message: string): AppError => new AppError(400, 'BAD_REQUEST', message);

/**
 * Campaign audience builder + blast enqueue. A campaign is always a MARKETING
 * template. Who receives it depends on `targetSource`:
 *   - WEBSITE_USERS → every registered, marketing-opted-in, unblocked user
 *   - ORDER_USERS  → opted-in users whose orders match the segment filters
 *   - MANUAL_NUMBERS → the admin's explicit number list (no opt-in required —
 *     the administrator typed them knowingly). The marketing cooldown still
 *     applies to opted-in users via `lastMarketingAt`; manual numbers have no
 *     user identity so cooldown does not apply.
 * The campaign-level dedupe key keeps repeated hits impossible.
 */

interface CampaignRecipient {
  userId?: string;
  mobile: string;
  totalSpendMinor: number;
}

/** Only registered, opted-in, unblocked users with a valid mobile qualify. */
export async function targetsForCampaign(campaign: WaCampaignDoc): Promise<CampaignRecipient[]> {
  const settings = await getWhatsAppSettings();
  const cooldownMs = settings.marketingCooldownDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  if (campaign.targetSource === 'MANUAL_NUMBERS') {
    const seen = new Set<string>();
    const recipients: CampaignRecipient[] = [];
    for (const raw of campaign.manualNumbers ?? []) {
      const mobile = String(raw).replace(/\D/g, '');
      if (!/^\d{10,15}$/.test(mobile) || seen.has(mobile)) continue;
      seen.add(mobile);
      recipients.push({ mobile, totalSpendMinor: 0 });
    }
    logger.info({ campaign: campaign.name, recipients: recipients.length }, 'campaign manual-number targeting computed');
    return recipients;
  }

  const segment = (campaign.segment ?? {}) as {
    hasOrders?: boolean;
    minSpendMinor?: number;
    purchasedProductIds?: Array<string | import('mongoose').Types.ObjectId>;
  };

  const orderMatch: Record<string, unknown> = { user: { $ne: null } };
  if (segment.purchasedProductIds?.length) {
    // items.product stores ObjectIds — cast so the $in actually matches, and
    // drop any non-ObjectId junk the admin form could have persisted.
    const ids = segment.purchasedProductIds
      .map((id) => String(id))
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (ids.length) orderMatch['items.product'] = { $in: ids };
    else return [];
  }
  // "Has orders" means *completed* orders — customers whose only order FAILED
  // have not actually bought anything.
  if (segment.hasOrders) orderMatch.status = { $nin: ['CANCELLED', 'FAILED'] };

  if (campaign.targetSource === 'ORDER_USERS') {
    const pipeline: PipelineStage[] = [
      { $match: orderMatch },
      {
        $group: {
          _id: '$user',
          totalSpendMinor: { $sum: '$amounts.totalMinor' },
          orderCount: { $sum: 1 },
        },
      },
    ];
    if (segment.minSpendMinor) pipeline.push({ $match: { totalSpendMinor: { $gte: segment.minSpendMinor } } });

    const agg = await Order.aggregate(pipeline);
    const userIds = agg.map((a) => a._id).filter((id): id is NonNullable<typeof id> => Boolean(id));
    if (userIds.length === 0) return [];
    const users = await User.find({
      _id: { $in: userIds },
      whatsappOptIn: true,
      whatsappMarketingOptIn: true,
      isBlocked: false,
    })
      .select('mobile lastMarketingAt')
      .lean();
    const spendByUser = new Map(agg.map((a) => [String(a._id), a.totalSpendMinor as number]));
    const recipients: CampaignRecipient[] = [];
    for (const user of users) {
      const mobile = (user.mobile ?? '').replace(/\D/g, '');
      if (!/^\d{10,15}$/.test(mobile)) continue;
      if (user.lastMarketingAt && now - new Date(user.lastMarketingAt).getTime() < cooldownMs) continue;
      recipients.push({ userId: String(user._id), mobile, totalSpendMinor: spendByUser.get(String(user._id)) ?? 0 });
    }
    logger.info({ campaign: campaign.name, recipients: recipients.length, cooldownDays: settings.marketingCooldownDays }, 'campaign order-user targeting computed');
    return recipients;
  }

  // WEBSITE_USERS — all opted-in registered users (order history not required).
  const users = await User.find({
    whatsappOptIn: true,
    whatsappMarketingOptIn: true,
    isBlocked: false,
  })
    .select('mobile lastMarketingAt')
    .lean();
  const recipients: CampaignRecipient[] = [];
  for (const user of users) {
    const mobile = (user.mobile ?? '').replace(/\D/g, '');
    if (!/^\d{10,15}$/.test(mobile)) continue;
    if (user.lastMarketingAt && now - new Date(user.lastMarketingAt).getTime() < cooldownMs) continue;
    recipients.push({ userId: String(user._id), mobile, totalSpendMinor: 0 });
  }
  logger.info({ campaign: campaign.name, recipients: recipients.length, cooldownDays: settings.marketingCooldownDays }, 'campaign website-user targeting computed');
  return recipients;
}

/**
 * Queues one WhatsApp job per recipient. The two-step contract lives in the
 * route: the admin always sees a cost preview first and this function refuses
 * to run without `confirm`, so a blast can never be fired by accident.
 */
export async function sendCampaign(
  campaign: WaCampaignDoc,
  confirm: boolean,
): Promise<{ recipients: number; estCostInr: number; queued: number; skipped: number }> {
  if (!confirm) throw badRequest('Send confirm karein — costing review ke baad bhejein.');
  if (campaign.status !== 'DRAFT') throw badRequest(`Campaign already ${campaign.status} hai.`);

  const settings = await getWhatsAppSettings();
  if (!settings.enabled) throw badRequest('WhatsApp disabled hai — Admin → Communications mein ON karein.');
  if (campaign.templateName === 'guddi_otp' || campaign.templateName === 'order_confirmed') {
    throw badRequest('Marketing campaign ke liye alag MARKETING template chahiye (guddi_offer).');
  }

  const recipients = await targetsForCampaign(campaign);
  if (recipients.length === 0) {
    const hint =
      campaign.targetSource === 'MANUAL_NUMBERS'
        ? 'Manual numbers list khaali hai ya saare numbers invalid hain.'
        : 'Koi eligible recipient nahi mila — opt-in ya segment check karein.';
    throw badRequest(hint);
  }

  const estCostInr = Math.round(recipients.length * campaign.perMessageCostInr * 100) / 100;
  let queued = 0;
  let skipped = 0;

  for (const r of recipients) {
    const result = await enqueueWhatsApp({
      mobile: r.mobile,
      templateName: campaign.templateName || 'guddi_offer',
      category: 'MARKETING',
      type: 'CAMPAIGN',
      customerId: r.userId,
      campaignId: String(campaign._id),
      dedupeKey: `campaign:${String(campaign._id)}:${r.mobile}`,
      components: buildComponents([campaign.message]),
    });
    if (result.queued) {
      queued += 1;
      // Cooldown clock starts at send time — no within-cooldown re-blast.
      if (r.userId) await User.updateOne({ _id: r.userId }, { $set: { lastMarketingAt: new Date() } });
    } else {
      skipped += 1;
    }
  }

  campaign.status = 'QUEUED';
  campaign.recipientCount = recipients.length;
  campaign.estimatedCostInr = estCostInr;
  campaign.sentCount = queued;
  campaign.failedCount = skipped;
  campaign.startedAt = new Date();
  await WaCampaign.updateOne(
    { _id: campaign._id },
    {
      $set: {
        status: campaign.status,
        recipientCount: campaign.recipientCount,
        estimatedCostInr: campaign.estimatedCostInr,
        sentCount: campaign.sentCount,
        failedCount: campaign.failedCount,
        startedAt: campaign.startedAt,
      },
    },
  );

  return { recipients: recipients.length, estCostInr, queued, skipped };
}