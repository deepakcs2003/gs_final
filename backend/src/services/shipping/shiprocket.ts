import axios, { type AxiosInstance } from 'axios';
import { env, integrations, shiprocketMock } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../utils/errors.js';
import type { Order } from '../../models/commerce.js';

/**
 * Shiprocket integration (README §12, §72; user spec STEP 1-15).
 *
 * Two modes:
 *  - MOCK  (SHIPROCKET_MOCK / non-production default): every operation returns
 *    a clearly-marked `mock: true` result. Nothing leaves the process, no token
 *    is fetched, no fake courier names are ever claimed as real. Pincode
 *    serviceability keeps the conservative fallback. Used for UI development
 *    and the admin test-drive before real credentials exist.
 *  - LIVE  : the real API. Errors surface as 502 AppErrors with public
 *    Hinglish messages; raw bodies are never logged (they contain addresses).
 *
 * The token lasts ~10 days (240h per docs) and is cached in memory.
 *
 * Safety rules enforced here and by callers:
 *  - credentials never leave the backend (env only, .env is git-ignored);
 *  - auto create/awb/pickup all default OFF until the real flow is verified;
 *  - a new shipment is never created for an order that already has one
 *    (duplicate protection covers payment callbacks, webhooks, admin retries);
 *  - on failure the order is marked SHIPMENT_CREATION_FAILED, never SHIPPED.
 */

export { shiprocketMock };

export const SHIPROCKET_PICKUP_DEFAULT = env.SHIPROCKET_PICKUP_LOCATION;

export const SHIPROCKET_SHIPPING_STATUSES = {
  NOT_SHIPPED: 'NOT_SHIPPED',
  SHIPMENT_CREATED: 'SHIPMENT_CREATED',
  AWB_ASSIGNED: 'AWB_ASSIGNED',
  PICKUP_SCHEDULED: 'PICKUP_SCHEDULED',
  SHIPPED: 'SHIPPED',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  SHIPMENT_CREATION_FAILED: 'SHIPMENT_CREATION_FAILED',
} as const;

export type ShiprocketShippingStatus = (typeof SHIPROCKET_SHIPPING_STATUSES)[keyof typeof SHIPROCKET_SHIPPING_STATUSES];

const BASE_URL = env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in/v1/external';
const TOKEN_TTL_MS = 10 * 24 * 60 * 60 * 1000;

let cachedToken: { token: string; expiresAt: number } | null = null;

/** In-memory cache of the last test-connection result (avoid login spam). */
let lastTest: { at: number; result: TestConnectionResult } | null = null;

function apiError(publicMessage: string, details?: unknown): AppError {
  return new AppError(502, 'SHIPROCKET_API_ERROR', publicMessage, { details });
}

function http(): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    timeout: 20_000,
    maxRedirects: 0,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function getToken(): Promise<string> {
  if (!integrations.shiprocket) throw apiError('Shiprocket credentials configured nahi hain.');
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const { data } = await http().post('/auth/login', {
    email: env.SHIPROCKET_EMAIL,
    password: env.SHIPROCKET_PASSWORD,
  });

  const token = (data as { token?: string })?.token;
  if (!token) throw apiError('Shiprocket login se token nahi mila.');
  cachedToken = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return token;
}

async function authed(): Promise<AxiosInstance> {
  const token = await getToken();
  const instance = http();
  instance.defaults.headers.common.Authorization = `Bearer ${token}`;
  return instance;
}

/** Callers decide the mode; mock paths never reach getToken. */
function wrapCall<T>(fn: () => Promise<T>, what: string): Promise<T> {
  return fn().catch((err: unknown) => {
    logger.warn({ err: (err as Error)?.message, what, mode: 'live' }, 'shiprocket call failed');
    if (err instanceof AppError) throw err;
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 401 || status === 403) {
      cachedToken = null;
      throw apiError('Shiprocket session expire/saah nahi hai. Dobara try karein.');
    }
    throw apiError('Shiprocket kaam nahi kar raha. Thodi der baad try karein.');
  });
}

function mockResponse<T extends object>(payload: T, message?: string): T & { mock: true; message: string } {
  return { ...payload, mock: true, message: message ?? 'Shiprocket MOCK mode — real API call nahi hua.' };
}

export interface ServiceabilityResult {
  serviceable: boolean;
  codAvailable: boolean;
  estimatedDays: number | null;
  courier: string;
  shippingChargeInr: number | null;
}

export interface PincodeLocation {
  valid: boolean;
  city: string;
  district: string;
  state: string;
  areas: string[];
}

/** Uses the India Post directory for address hints; no address is stored. */
export async function lookupPincode(pincode: string): Promise<PincodeLocation> {
  try {
    const { data } = await axios.get(`https://api.postalpincode.in/pincode/${pincode}`, { timeout: 5000 });
    const result = Array.isArray(data) ? data[0] as { Status?: string; PostOffice?: Array<{ Name?: string; District?: string; State?: string }> } : null;
    const offices = result?.PostOffice ?? [];
    const first = offices[0];
    if (!first || result?.Status !== 'Success') return { valid: false, city: '', district: '', state: '', areas: [] };
    return {
      valid: true,
      city: first.District ?? '',
      district: first.District ?? '',
      state: first.State ?? '',
      areas: [...new Set(offices.map((office) => office.Name ?? '').filter(Boolean))].slice(0, 8),
    };
  } catch {
    return { valid: false, city: '', district: '', state: '', areas: [] };
  }
}

/**
 * Checkout pincode check. In mock mode (or when unconfigured) it returns the
 * conservative fallback — never a fake courier — so dev checkouts flow.
 */
export async function checkPincodeServiceability(
  deliveryPincode: string,
  pickupPincode: string,
  weightKg = 0.5,
  codRequested = false,
): Promise<ServiceabilityResult> {
  const fallback: ServiceabilityResult = {
    serviceable: true,
    codAvailable: true,
    estimatedDays: null,
    courier: '',
    shippingChargeInr: null,
  };

  if (!integrations.shiprocket || shiprocketMock) return fallback;

  try {
    const client = await authed();
    const { data } = await client.get('/courier/serviceability/', {
      params: {
        pickup_postcode: pickupPincode,
        delivery_postcode: deliveryPincode,
        weight: weightKg,
        cod: codRequested ? 1 : 0,
      },
    });

    const couriers = (data as { data?: { available_courier_companies?: unknown[] } })?.data
      ?.available_courier_companies;

    if (!Array.isArray(couriers) || couriers.length === 0) {
      return { serviceable: false, codAvailable: false, estimatedDays: null, courier: '', shippingChargeInr: null };
    }

    const best = couriers[0] as {
      courier_name?: string;
      estimated_delivery_days?: string | number;
      rate?: number;
      cod?: number;
    };

    const days = Number(best.estimated_delivery_days);

    return {
      serviceable: true,
      codAvailable: Boolean(best.cod),
      estimatedDays: Number.isFinite(days) && days > 0 ? Math.round(days) : null,
      courier: typeof best.courier_name === 'string' ? best.courier_name.slice(0, 60) : '',
      shippingChargeInr: Number.isFinite(Number(best.rate)) ? Math.round(Number(best.rate)) : null,
    };
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

export interface TestConnectionResult {
  success: boolean;
  connected: boolean;
  mode: 'mock' | 'live';
  message: string;
  testedAt: string;
}

export async function testConnection(): Promise<TestConnectionResult> {
  if (lastTest && Date.now() - lastTest.at < 60_000) return lastTest.result;

  let result: TestConnectionResult;
  if (shiprocketMock) {
    result = {
      success: true,
      connected: true,
      mode: 'mock',
      message: 'Shiprocket MOCK mode active — credentials ki zaroorat nahi. Production ko real credentials chahiye.',
      testedAt: new Date().toISOString(),
    };
  } else if (!integrations.shiprocket) {
    result = {
      success: false,
      connected: false,
      mode: 'live',
      message: 'Shiprocket configured nahi hai. Backend .env mein SHIPROCKET_EMAIL/SHIPROCKET_PASSWORD set karein.',
      testedAt: new Date().toISOString(),
    };
  } else {
    try {
      await getToken();
      result = {
        success: true,
        connected: true,
        mode: 'live',
        message: 'Connection theek hai — Shiprocket token mil gaya.',
        testedAt: new Date().toISOString(),
      };
    } catch (err) {
      cachedToken = null;
      result = {
        success: false,
        connected: false,
        mode: 'live',
        message: (err instanceof AppError ? err.publicMessage : 'Connection fail hua. Credentials/network check karein.'),
        testedAt: new Date().toISOString(),
      };
    }
  }

  lastTest = { at: Date.now(), result };
  return result;
}

export function resetTokenCache(): void {
  cachedToken = null;
  lastTest = null;
}

/* ------------------------------------------------------------------ */
/* Shipment lifecycle (admin + auto-push)                              */
/* ------------------------------------------------------------------ */

export interface ShipmentCreateResult {
  shiprocketOrderId: string;
  shipmentId: string;
  mock?: boolean;
  message?: string;
}

/** Creates the Shiprocket order. Duplicate-guarded: never re-creates. */
export async function createShipment(order: InstanceType<typeof Order>, pickupLocation: string): Promise<ShipmentCreateResult> {
  if (order.shipping.shiprocketOrderId) {
    return {
      shiprocketOrderId: order.shipping.shiprocketOrderId,
      shipmentId: order.shipping.shipmentId,
      message: 'Shipment pehle se maujood hai.',
    };
  }

  if (shiprocketMock) {
    const id = `MOCK-${order.orderNumber}`;
    return mockResponse(
      { shiprocketOrderId: id, shipmentId: `MOCK-SHIP-${Date.now()}` },
      'Mock shipment bana diya. Real create tabhi hoga jab mock OFF ho.',
    );
  }
  if (!integrations.shiprocket) throw apiError('Shiprocket credentials configured nahi hain.');

  return wrapCall(async () => {
    const client = await authed();
    const isCod = order.payment.method === 'COD';
    const { data } = await client.post('/orders/create/adhoc', {
      order_id: order.orderNumber,
      order_date: new Date(order.placedAt ?? Date.now()).toISOString().slice(0, 19).replace('T', ' '),
      pickup_location: pickupLocation || SHIPROCKET_PICKUP_DEFAULT,
      billing_customer_name: order.contact.name,
      billing_last_name: '',
      billing_address: order.address.line1,
      billing_address_2: order.address.line2 ?? '',
      billing_city: order.address.city,
      billing_pincode: order.address.pincode,
      billing_state: order.address.state,
      billing_country: order.address.country === 'IN' ? 'India' : order.address.country,
      billing_email: order.contact.email || 'orders@guddisilai.com',
      billing_phone: order.contact.mobile,
      shipping_is_billing: true,
      order_items: order.items.map((item) => ({
        name: `${item.name} (${item.designId})`,
        sku: item.sku || item.designId,
        units: item.quantity,
        selling_price: Math.round(item.lineTotalMinor / item.quantity / 100),
      })),
      payment_method: isCod ? 'COD' : 'Prepaid',
      sub_total: Math.round(order.amounts.totalMinor / 100),
      length: 25,
      breadth: 20,
      height: 4,
      weight: 0.3 * order.items.reduce((n, i) => n + i.quantity, 0),
    });

    const result = data as { order_id?: number | string; shipment_id?: number | string };
    if (!result.order_id || !result.shipment_id) throw apiError('Shiprocket ne shipment IDs wapas nahi bheje.');
    return {
      shiprocketOrderId: String(result.order_id),
      shipmentId: String(result.shipment_id),
    };
  }, 'createShipment');
}

export interface CourierOption {
  courierId: string;
  name: string;
  rate: number | null;
  estimatedDays: number | null;
}

export async function recommendCouriers(shipmentId: string): Promise<CourierOption[]> {
  if (shiprocketMock) {
    return [
      mockResponse(
        { courierId: 'mock-courier', name: 'Mock Courier (MOCK mode)', rate: null, estimatedDays: null },
        'MOCK mode — recommended courier list nahi aayi.',
      ),
    ];
  }
  if (!integrations.shiprocket) throw apiError('Shiprocket credentials configured nahi hain.');

  return wrapCall(async () => {
    const client = await authed();
    const { data } = await client.get('/courier/recommend', { params: { shipment_id: shipmentId } });
    const raw = (data as { data?: { recommended_courier_company_and_rate?: unknown[] } })?.data
      ?.recommended_courier_company_and_rate;

    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => {
        const e = entry as {
          courier_company_id?: number | string;
          courier_name?: string;
          rate?: number | string;
          estimated_delivery_days?: number | string;
        };
        if (!e.courier_company_id) return null;
        const rate = Number(e.rate);
        const days = Number(e.estimated_delivery_days);
        return {
          courierId: String(e.courier_company_id),
          name: String(e.courier_name ?? 'Courier').slice(0, 60),
          rate: Number.isFinite(rate) ? rate : null,
          estimatedDays: Number.isFinite(days) && days > 0 ? Math.round(days) : null,
        };
      })
      .filter((c): c is CourierOption => c !== null)
      .slice(0, 10);
  }, 'recommendCouriers');
}

export interface AwbResult {
  awb: string;
  courierId: string;
  courierName: string;
  trackingUrl: string;
  mock?: boolean;
  message?: string;
}

export async function assignAwb(shipmentId: string, courierId: string): Promise<AwbResult> {
  if (shiprocketMock) {
    return mockResponse(
      {
        awb: `MOCKAWB${Date.now().toString().slice(-8)}`,
        courierId,
        courierName: 'Mock Courier',
        trackingUrl: '',
      },
      'Mock AWB assign ho gaya — real AWB nahi.',
    );
  }
  if (!integrations.shiprocket) throw apiError('Shiprocket credentials configured nahi hain.');

  return wrapCall(async () => {
    const client = await authed();
    const { data } = await client.post('/courier/assign/awb', {
      shipment_id: shipmentId,
      courier_id: courierId,
    });

    const body = (data as { data?: unknown })?.data ?? data;
    const awb = pickString(body, ['awb_code', 'awb', 'data.awb']);
    if (!awb) throw apiError('AWB assign ka response sahi nahi aaya.');

    return {
      awb,
      courierId,
      courierName: pickString(body, ['courier_name', 'courier_company_name', 'data.courier_name']) || 'Courier',
      trackingUrl: pickString(body, ['tracking_url', 'awb_track_url']),
    };
  }, 'assignAwb');
}

export interface PickupResult {
  scheduled: boolean;
  pickupScheduledAt: string | null;
  message: string;
  mock?: boolean;
}

export async function schedulePickup(shipmentId: string, pickupLocation: string): Promise<PickupResult> {
  if (shiprocketMock) {
    return mockResponse(
      { scheduled: true, pickupScheduledAt: null, message: 'Mock pickup schedule ho gaya.' },
      'Mock pickup — real pickup nahi.',
    );
  }
  if (!integrations.shiprocket) throw apiError('Shiprocket credentials configured nahi hain.');

  return wrapCall(async () => {
    const client = await authed();
    const { data } = await client.post('/shipments/pickup', {
      shipment_id: shipmentId,
      pickup_location: pickupLocation || SHIPROCKET_PICKUP_DEFAULT,
    });

    const body = (data as { data?: unknown })?.data ?? data;
    const scheduledAt = pickString(body, ['pickup_scheduled_at', 'pickup_scheduled_date', 'data.pickup_scheduled_at']);
    return {
      scheduled: true,
      pickupScheduledAt: scheduledAt || null,
      message: 'Pickup schedule ho gaya.',
    };
  }, 'schedulePickup');
}

export interface LabelResult {
  labelUrl: string;
  mock?: boolean;
  message?: string;
}

export async function generateLabel(shipmentId: string): Promise<LabelResult> {
  if (shiprocketMock) {
    return mockResponse({ labelUrl: '' }, 'Mock mode — label nahi banta.');
  }
  if (!integrations.shiprocket) throw apiError('Shiprocket credentials configured nahi hain.');

  return wrapCall(async () => {
    const client = await authed();
    const { data } = await client.get('/courier/generate/label', { params: { shipment_ids: shipmentId } });
    const labelUrl = pickString(data as Record<string, unknown>, ['label_url', 'data.label_url']);
    if (!labelUrl) throw apiError('Label URL response sahi nahi aaya.');
    return { labelUrl };
  }, 'generateLabel');
}

export interface TrackResult {
  status: string;
  statusText: string;
  delivered: boolean;
  outForDelivery: boolean;
  inTransit: boolean;
  etd: string | null;
  lastEventAt: string | null;
  mock?: boolean;
  message?: string;
}

/** Maps Shiprocket's free-text track_status onto our machine statuses. */
function mapTrackStatus(raw: string): { status: string; delivered: boolean; outForDelivery: boolean; inTransit: boolean } {
  const s = raw.toLowerCase();
  if (/delivered/i.test(s))
    return { status: SHIPROCKET_SHIPPING_STATUSES.DELIVERED, delivered: true, outForDelivery: false, inTransit: false };
  if (/out for delivery/i.test(s))
    return { status: SHIPROCKET_SHIPPING_STATUSES.OUT_FOR_DELIVERY, delivered: false, outForDelivery: true, inTransit: false };
  if (/cancelled|cancel/i.test(s))
    return { status: SHIPROCKET_SHIPPING_STATUSES.CANCELLED, delivered: false, outForDelivery: false, inTransit: false };
  if (/in transit|transit/i.test(s))
    return { status: SHIPROCKET_SHIPPING_STATUSES.IN_TRANSIT, delivered: false, outForDelivery: false, inTransit: true };
  if (/shipped/i.test(s))
    return { status: SHIPROCKET_SHIPPING_STATUSES.SHIPPED, delivered: false, outForDelivery: false, inTransit: false };
  return { status: SHIPROCKET_SHIPPING_STATUSES.SHIPPED, delivered: false, outForDelivery: false, inTransit: false };
}

/** Reusable mapping for raw status text (webhook payloads, live track). */
export function parseTrackStatus(
  raw: string,
  statusText?: string,
  extra?: { etd?: string | null; lastEventAt?: string | null },
): TrackResult {
  const base = mapTrackStatus(raw);
  return {
    ...base,
    statusText: (statusText && statusText.trim()) || raw || '',
    etd: extra?.etd ?? null,
    lastEventAt: extra?.lastEventAt ?? null,
  };
}

export async function trackCourier(trackingId: string, byAwb = false): Promise<TrackResult> {
  if (shiprocketMock) {
    return mockResponse(
      {
        status: SHIPROCKET_SHIPPING_STATUSES.IN_TRANSIT,
        statusText: 'Mock courier — parcel create ho chuka hai. Real tracking data nahi.',
        delivered: false,
        outForDelivery: false,
        inTransit: true,
        etd: null,
        lastEventAt: null,
      },
      'Mock tracking.',
    );
  }
  if (!integrations.shiprocket) throw apiError('Shiprocket credentials configured nahi hain.');

  return wrapCall(async () => {
    const client = await authed();
    const body: Record<string, unknown> = byAwb ? { awb: trackingId } : { shipment_id: trackingId };
    const { data } = await client.post('/courier/track', body);

    const td = (data as { tracking_data?: Record<string, unknown> })?.tracking_data;
    const rawStatus = pickString(td ?? (data as Record<string, unknown>), [
      'track_status',
      'current_status',
      'status',
      'data.track_status',
    ]) ?? '';

    const mapped = mapTrackStatus(rawStatus);
    const events = (td?.shipment_track as Array<{ status?: string; date?: string }> | undefined) ?? [];
    const statusText = events
      .filter((e) => e.status)
      .map((e) => (e.date ? `${e.status} — ${e.date}` : String(e.status)))
      .slice(-3)
      .join('\n');

    return {
      ...mapped,
      statusText: statusText || rawStatus || 'Tracking update nahi mila.',
      etd: pickString(td ?? {}, ['etd', 'lnt_etd']),
      lastEventAt: pickString((events.at(-1) as { date?: string } | undefined) ?? {}, ['date']) ?? null,
    };
  }, 'trackCourier');
}

/** Applies live tracking to an order (shared by admin sync + webhook). */
export async function applyTrackingToOrder(
  order: InstanceType<typeof Order>,
  track: TrackResult,
  note: string,
): Promise<void> {
  const shipping = order.shipping;
  shipping.lastSyncedAt = new Date();
  shipping.status = track.status;
  if (track.statusText) shipping.statusText = track.statusText;
  if (track.etd) {
    const parsed = new Date(track.etd);
    if (!Number.isNaN(parsed.getTime())) shipping.estimatedDeliveryAt = parsed;
  }
  if (track.delivered) {
    shipping.deliveredAt ??= new Date();
    if (order.status !== 'DELIVERED') {
      order.statusHistory.push({ status: 'DELIVERED', at: new Date(), note });
      order.status = 'DELIVERED';
    }
  } else if ((track.inTransit || track.outForDelivery || track.status === SHIPROCKET_SHIPPING_STATUSES.SHIPPED) &&
    (order.status === 'PACKED' || order.status === 'SHIPPED')) {
    shipping.shippedAt ??= new Date();
    if (order.status === 'PACKED') {
      order.statusHistory.push({ status: 'SHIPPED', at: new Date(), note });
      order.status = 'SHIPPED';
    }
  }
  await order.save();
}

export interface CancelResult {
  cancelled: boolean;
  message: string;
  mock?: boolean;
}

export async function cancelShipment(orderId: string, shipmentId: string): Promise<CancelResult> {
  if (shiprocketMock) {
    return mockResponse(
      { cancelled: true, message: 'Mock cancel ho gaya.' },
      'Mock mode — real cancellation nahi.',
    );
  }
  if (!integrations.shiprocket) throw apiError('Shiprocket credentials configured nahi hain.');

  return wrapCall(async () => {
    const client = await authed();
    // Deprecated endpoint accepts either key; send both defensively.
    await client.post('/orders/cancel', {
      order_id: orderId,
      shipment_id: shipmentId,
      reason: 'Customer cancellation / admin decision',
    });
    return { cancelled: true, message: 'Shipment cancel kar diya.' };
  }, 'cancelShipment');
}

/** Extracts the first present value from dotted paths on a nested object. */
function pickString(source: unknown, paths: string[]): string {
  let current: unknown = source;
  for (const path of paths) {
    const parts = path.split('.');
    let node: unknown = source;
    for (const part of parts) {
      if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
        node = (node as Record<string, unknown>)[part];
      } else {
        node = undefined;
        break;
      }
    }
    if (typeof node === 'string' && node.trim()) return node.trim();
  }
  return current && typeof current === 'string' ? current : '';
}