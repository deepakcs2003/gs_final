/**
 * WhatsApp messaging domain constants. Kept out of the model file so routes and
 * services can import them without a Mongoose side effect (models/ is only for
 * schema + model registration).
 */

/** Purpose of a message — recorded on the MessageLog for filtering/reporting. */
export const MESSAGE_TYPES = [
  'OTP',
  'ORDER_CONFIRMED',
  'ORDER_SHIPPED',
  'ORDER_OUT_FOR_DELIVERY',
  'ORDER_DELIVERED',
  'ORDER_CANCELLED',
  'CAMPAIGN',
  'TEST',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const TEMPLATE_CATEGORIES = ['AUTHENTICATION', 'UTILITY', 'MARKETING'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/** Order lifecycle events that produce a WhatsApp message (spec minimum set). */
export const ORDER_NOTIFICATION_TYPES = [
  'ORDER_CONFIRMED',
  'ORDER_SHIPPED',
  'ORDER_OUT_FOR_DELIVERY',
  'ORDER_DELIVERED',
  'ORDER_CANCELLED',
] as const;
export type OrderNotificationType = (typeof ORDER_NOTIFICATION_TYPES)[number];

/** Backoff between retries of a transient failure (rate limit etc.). */
export const WA_BACKOFF_MS = [5_000, 30_000, 180_000] as const;

/** Job lifecycle inside the queue worker. */
export const WA_JOB_STATUSES = ['PENDING', 'SENDING', 'SUCCESS', 'FAILED'] as const;
export type WaJobStatus = (typeof WA_JOB_STATUSES)[number];

export const WA_CAMPAIGN_STATUSES = ['DRAFT', 'QUEUED', 'SENDING', 'DONE', 'PARTIAL', 'CANCELLED'] as const;
export type WaCampaignStatus = (typeof WA_CAMPAIGN_STATUSES)[number];