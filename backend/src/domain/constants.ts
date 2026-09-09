/**
 * Domain constants shared by models, routes and the seed script.
 *
 * README §83: the three product types are kept apart at the data layer so the
 * frontend never has to guess which controls a product supports.
 */
export const PRODUCT_TYPES = ['READY_MADE', 'CUSTOMIZE', 'SHOWCASE'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const ORDER_STATUSES = [
  'PLACED',
  'CONFIRMED',
  'PROCESSING',
  'STITCHING',
  'QUALITY_CHECK',
  'PACKED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'RETURNED',
  'FAILED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Customer-facing labels for the tracking timeline (README §35). */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PLACED: 'Order Placed',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  STITCHING: 'Stitching',
  QUALITY_CHECK: 'Quality Check',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RETURNED: 'Returned',
  FAILED: 'Failed',
};

export const PAYMENT_METHODS = ['RAZORPAY', 'COD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'COD_PENDING'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const CURRENCIES = ['INR', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/**
 * README §32: these markets are billed in INR and may use COD. Everyone else
 * sees USD and cannot choose COD.
 */
export const INR_COUNTRIES = ['IN', 'BD', 'PK', 'NP', 'BT', 'LK'] as const;

/** COD is only offered inside India — foreign COD is uncollectable. */
export const COD_COUNTRIES = ['IN'] as const;

export const IMAGE_KINDS = ['front', 'back', 'side', 'sleeve', 'fabric', 'embroidery', 'latkan', 'model', 'other'] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

/** README §76 — every meaningful interaction is stored as an event. */
export const ANALYTICS_EVENTS = [
  'PAGE_VIEW',
  'PRODUCT_VIEW',
  'PRODUCT_VIEW_END',
  'PRODUCT_IMAGE_VIEW',
  'IMAGE_ZOOM',
  'SEARCH',
  'CATEGORY_VIEW',
  'WISHLIST_ADD',
  'WISHLIST_REMOVE',
  'CART_ADD',
  'CART_REMOVE',
  'BUY_NOW',
  'CHECKOUT_START',
  'MEASUREMENT_START',
  'MEASUREMENT_COMPLETE',
  'WHATSAPP_CLICK',
  'SHARE',
  'ORDER_PLACED',
  'PAYMENT_SUCCESS',
  'PAYMENT_FAILED',
] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENTS)[number];

export const ADMIN_ROLES = [
  'SUPER_ADMIN',
  'ORDER_MANAGER',
  'PRODUCT_MANAGER',
  'STITCHING_MANAGER',
  'ANALYST',
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Average Indian blouse sizes (README §6). */
export const DEFAULT_SIZES = [32, 34, 36, 38, 40, 42, 44] as const;

export const MEASUREMENT_UNITS = ['inch', 'cm'] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];

export const CM_PER_INCH = 2.54;
