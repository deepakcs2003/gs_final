import type { TemplateCategory } from './constants.js';

/**
 * The MINIMUM template set required for the whole system to work. Every one of
 * these must also be created and approved in Meta Business Manager — the API
 * cannot send a template that does not exist with an approved status.
 *
 * Cost + velocity: a handful of reusable templates instead of one per product,
 * so approval effort stays tiny and the same messages handle any order.
 */
export interface WaTemplateDef {
  name: string;
  category: TemplateCategory;
  language: string;
  /** Exact body to create in Meta. {{n}} are the variable positions. */
  body: string;
  /** Whether the template needs a "Visit Website" URL button. */
  needsButton: boolean;
  buttonText: string;
  purpose: string;
}

export const TEMPLATE_REGISTRY: ReadonlyArray<WaTemplateDef> = [
  {
    name: 'guddi_otp',
    category: 'AUTHENTICATION',
    language: 'en_US',
    body: '{{1}} is your Guddi Silai one-time password. Valid for 5 minutes. Itne code ko kisi ke saath share na karein.',
    needsButton: false,
    buttonText: '',
    purpose: 'OTP for login — sent automatically.',
  },
  {
    name: 'order_confirmed',
    category: 'UTILITY',
    language: 'en_US',
    body: 'Namaste {{1}}! Aapka order {{2}} confirm ho gaya hai. Total amount: {{3}}. Payment detail — {{4}}. Guddi Silai se shopping ke liye shukriya!',
    needsButton: true,
    buttonText: 'Order Track Karein',
    purpose: 'Order confirmed + payment status — the combined order-placed + payment message.',
  },
  {
    name: 'order_shipped',
    category: 'UTILITY',
    language: 'en_US',
    body: 'Namaste {{1}}! Aapka order {{2}} ab ship ho chuka hai. AWB number: {{3}}. Track button se order ki poori location dekh sakte hain. Guddi Silai — stylish shopping ka vishwas.',
    needsButton: true,
    buttonText: 'Order Track Karein',
    purpose: 'Parcel dispatched — short text, link does the heavy lifting.',
  },
  {
    name: 'order_out_for_delivery',
    category: 'UTILITY',
    language: 'en_US',
    body: 'Namaste {{1}}! Aapka order {{2}} aaj delivery ke liye nikla hai. Cabin rakh lijiye.',
    needsButton: true,
    buttonText: 'Order Track Karein',
    purpose: 'Out for delivery — sent only while the parcel is mid-flight.',
  },
  {
    name: 'order_delivered',
    category: 'UTILITY',
    language: 'en_US',
    body: 'Namaste {{1}}! Aapka order {{2}} deliver ho gaya hai. Happy styling with Guddi Silai \u2764',
    needsButton: false,
    buttonText: '',
    purpose: 'Delivered confirmation.',
  },
  {
    name: 'order_cancelled_refund',
    category: 'UTILITY',
    language: 'en_US',
    body: 'Namaste {{1}}! Guddi Silai ki taraf se maafi — aapka order {{2}} cancel ho gaya hai. {{3}}. Kisi bhi sawaal ke liye hum hamesha haazir hain.',
    needsButton: true,
    buttonText: 'Order Track Karein',
    purpose: 'Cancellation + refund — one message, refund text is a variable.',
  },
  {
    name: 'guddi_offer',
    category: 'MARKETING',
    language: 'en_US',
    body: 'Guddi Silai — khaas offer sirf aapke liye!\n{{1}}\n\nLimited time ke liye. Jaldi karein!',
    needsButton: false,
    buttonText: '',
    purpose: 'Marketing campaigns (up to 5 text variables, 1024-byte limit).',
  },
];

export function templateByEvent(event: string): WaTemplateDef | undefined {
  const map: Record<string, string> = {
    OTP: 'guddi_otp',
    ORDER_CONFIRMED: 'order_confirmed',
    ORDER_SHIPPED: 'order_shipped',
    ORDER_OUT_FOR_DELIVERY: 'order_out_for_delivery',
    ORDER_DELIVERED: 'order_delivered',
    ORDER_CANCELLED: 'order_cancelled_refund',
    CAMPAIGN: 'guddi_offer',
    TEST: 'guddi_offer',
  };
  const name = map[event];
  return TEMPLATE_REGISTRY.find((t) => t.name === name);
}

/**
 * Meta template components. Each text parameter maps to a position in the
 * approved body. A URL button template passes its target URL as a button
 * parameter (Meta requires the button URL exactly as configured in the app).
 */
export function bodyParameters(texts: Array<string | number>): Array<{ type: 'text'; text: string }> {
  return texts.map((text) => ({ type: 'text' as const, text: String(text ?? '').slice(0, 160) }));
}

export function buildComponents(bodyTexts: Array<string | number>, buttonUrl?: string, otpCode?: string): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = [{ type: 'BODY', parameters: bodyParameters(bodyTexts) }];
  if (otpCode) {
    // AUTHENTICATION templates come with a copy-code button — Meta wants the
    // same code echoed into the button parameter.
    components.push({ type: 'BUTTON', sub_type: 'OTP', index: 0, parameters: [{ type: 'text', text: otpCode }] });
  } else if (buttonUrl) {
    components.push({ type: 'BUTTON', sub_type: 'URL', index: 0, parameters: [{ type: 'text', text: buttonUrl }] });
  }
  return components;
}