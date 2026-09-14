export interface PublicCoupon {
  code: string;
  description: string;
  type: 'PERCENT' | 'FIXED';
  valueInr: number;
  minOrderInr: number;
  maxDiscountInr: number;
  products: string[];
}

export interface ProductCouponOffer {
  code: string;
  description: string;
  type: 'PERCENT' | 'FIXED';
  discountMinor: number;
  finalPriceMinor: number;
  mrpMinor: number;
  savingsPercent: number;
}

function isEligible(productId: string, coupon: PublicCoupon): boolean {
  return coupon.products.length === 0 || coupon.products.includes(productId);
}

export function getBestCouponForProduct(productId: string, productPriceMinor: number, coupons: PublicCoupon[]): ProductCouponOffer | null {
  if (productPriceMinor <= 0) return null;

  let best: ProductCouponOffer | null = null;

  for (const coupon of coupons) {
    if (!isEligible(productId, coupon)) continue;
    if (productPriceMinor < coupon.minOrderInr * 100) continue;

    let discountMinor = 0;
    if (coupon.type === 'PERCENT') {
      const raw = Math.floor((productPriceMinor * Math.min(coupon.valueInr, 100)) / 100);
      const cap = coupon.maxDiscountInr > 0 ? coupon.maxDiscountInr * 100 : productPriceMinor;
      discountMinor = Math.min(raw, cap, productPriceMinor);
    } else {
      discountMinor = Math.min(coupon.valueInr * 100, productPriceMinor);
    }

    if (discountMinor <= 0) continue;

    const finalPriceMinor = Math.max(productPriceMinor - discountMinor, 0);
    const savingsPercent = Math.round((discountMinor / productPriceMinor) * 100);
    const candidate = {
      code: coupon.code,
      description: coupon.description,
      type: coupon.type,
      discountMinor,
      finalPriceMinor,
      mrpMinor: productPriceMinor,
      savingsPercent,
    } satisfies ProductCouponOffer;

    if (!best || candidate.discountMinor > best.discountMinor) best = candidate;
  }

  return best;
}
