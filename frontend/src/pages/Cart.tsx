import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart, Trash2, AlertTriangle, Ruler, Tag, ArrowRight, Check } from 'lucide-react';
import clsx from 'clsx';
import { SmartImage } from '../components/SmartImage';
import { EmptyState } from '../components/ui';
import { useCartQuote, useAvailableCoupons, useConfig } from '../hooks/queries';
import { useCart } from '../store/cart';
import { useUi } from '../store/ui';
import { formatDate, formatMoney } from '../lib/format';
import { track } from '../lib/analytics';
import type { QuotedLine } from '../lib/types';

/**
 * Cart (README §27–28).
 *
 * Ready-made and custom lines are shown as two clearly separate blocks, because
 * they behave differently: one ships from stock, the other needs a measurement
 * before it can be made. Totals always come from the server.
 */

export function CartPage() {
  const navigate = useNavigate();
  const lines = useCart((state) => state.lines);
  const appliedCoupon = useCart((state) => state.appliedCoupon);
  const setAppliedCoupon = useCart((state) => state.setAppliedCoupon);
  const remove = useCart((state) => state.remove);
  const setQuantity = useCart((state) => state.setQuantity);
  const toast = useUi((state) => state.toast);
  const { data: config } = useConfig();

  const [couponInput, setCouponInput] = useState(appliedCoupon);

  const { data: quote, isFetching, isError: quoteFailed, error: quoteError, refetch: retryQuote } = useCartQuote(appliedCoupon);
  const currency = quote?.currency ?? config?.currency ?? 'INR';
  const { data: available } = useAvailableCoupons();

  if (lines.length === 0) {
    return (
      <EmptyState
        icon={<ShoppingCart size={30} />}
        title="Cart khaali hai"
        message="Koi blouse pasand aaya? Cart mein daalein aur order karein."
        action={
          <Link to="/ready-to-buy" className="btn-primary">
            Designs dekhein
          </Link>
        }
      />
    );
  }

  const readyLines = quote?.lines.filter((line) => line.type === 'READY_MADE') ?? [];
  const customLines = quote?.lines.filter((line) => line.type === 'CUSTOMIZE') ?? [];
  const pendingMeasurements = customLines.filter((line) => !line.measurementReady).length;

  const applyCoupon = () => {
    setAppliedCoupon(couponInput);
  };

  const tapCoupon = (code: string) => {
    setCouponInput(code);
    setAppliedCoupon(code);
  };

  const onCheckout = () => {
    if (quote?.blocking) {
      toast('Cart mein kuch problem hai — neeche dekhein', 'error');
      return;
    }
    track('CHECKOUT_START', { value: quote?.amounts.totalMinor ?? 0 });
    navigate('/checkout');
  };

  return (
    <div className="mx-auto max-w-5xl px-3 pt-4 sm:px-5">
      <h1 className="section-title mb-4">Aapka Cart</h1>

      <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-6">
        <div className="space-y-5">
          {readyLines.length > 0 ? (
            <CartSection title="Ready to Buy" count={readyLines.length}>
              {readyLines.map((line) => (
                <CartRow
                  key={line.key}
                  line={line}
                  currency={currency}
                  onRemove={() => remove(line.key)}
                  onQuantity={(next) => setQuantity(line.key, next)}
                />
              ))}
            </CartSection>
          ) : null}

          {customLines.length > 0 ? (
            <CartSection title="Customize Blouse" count={customLines.length}>
              {customLines.map((line) => (
                <CartRow
                  key={line.key}
                  line={line}
                  currency={currency}
                  onRemove={() => remove(line.key)}
                  onQuantity={(next) => setQuantity(line.key, next)}
                  onMeasure={() => navigate(`/measurement/${encodeURIComponent(line.key)}`)}
                />
              ))}
            </CartSection>
          ) : null}

          {isFetching && !quote ? <div className="skeleton h-32 rounded-xl2" /> : null}
          {quoteFailed ? (
            <div className="rounded-xl2 border border-alert/25 bg-alert/10 p-4 text-sm text-alert">
              <p className="font-semibold">
                {quoteError instanceof Error ? quoteError.message : 'Cart ka total load nahi ho paya.'}
              </p>
              <button type="button" onClick={() => void retryQuote()} className="mt-2 font-bold underline">
                Dobara try karein
              </button>
            </div>
          ) : null}

          <Link to="/ready-to-buy" className="btn-ghost w-full justify-start px-0 lg:hidden">
            ← Aur shopping karein
          </Link>
        </div>

        {/* Summary */}
        <aside className="mt-5 lg:mt-0">
          <div className="lg:sticky lg:top-[calc(var(--header-h)+16px)]">
            {/* Coupon (README §49) */}
            <div className="card mb-4 p-4">
              <label htmlFor="coupon" className="label flex items-center gap-1.5">
                <Tag size={15} />
                Coupon code
              </label>
              <div className="flex gap-2">
                <input
                  id="coupon"
                  value={couponInput}
                  onChange={(event) => setCouponInput(event.target.value.toUpperCase().slice(0, 24))}
                  placeholder="WELCOME10"
                  className="field uppercase"
                />
                <button type="button" onClick={applyCoupon} className="btn-outline shrink-0 px-4">
                  Lagayein
                </button>
              </div>
              {quote?.couponError ? <p className="mt-2 text-[13px] font-medium text-alert">{quote.couponError}</p> : null}
              {quote?.amounts.couponCode ? (
                <p className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-leaf">
                  <Check size={15} />
                  {quote.amounts.couponCode} lag gaya
                </p>
              ) : null}
            </div>

            {available?.items.length ? (
              <div className="card mb-4 p-4">
                <label className="label flex items-center gap-1.5">
                  <Tag size={15} />
                  Your coupons
                </label>
                <p className="mt-0.5 text-xs text-ink-muted">Yeh coupons aapke cart par abhi lag sakte hain.</p>
                <ul className="mt-3 space-y-2">
                  {available.items.map((coupon) => {
                    const applied = quote?.amounts.couponCode === coupon.code;
                    return (
                      <li key={coupon.code}>
                        <button
                          type="button"
                          onClick={() => tapCoupon(coupon.code)}
                          className={`flex w-full items-start justify-between gap-3 rounded-xl border p-3 text-left transition ${
                            applied ? 'border-leaf bg-leaf/10' : 'border-maroon-100 bg-white hover:border-maroon-300'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="font-mono text-sm font-bold tracking-wide text-maroon-700">{coupon.code}</p>
                            {coupon.description ? <p className="mt-0.5 text-xs text-ink-muted">{coupon.description}</p> : null}
                            <p className="mt-1 text-[11px] text-ink-light">
                              {coupon.minOrderInr > 0 ? `Min order ₹${coupon.minOrderInr} · ` : ''}
                              {coupon.type === 'PERCENT' ? `${coupon.valueInr}% off` : `₹${coupon.valueInr} off`}
                              {coupon.restrictedToProducts ? ' · in products' : ' · sabhi products'}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            {coupon.discountMinor > 0 ? (
                              <p className="text-sm font-bold text-leaf">− {formatMoney(coupon.discountMinor, currency)}</p>
                            ) : null}
                            {applied ? (
                              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-leaf">
                                <Check size={12} />Applied
                              </p>
                            ) : (
                              <p className="mt-1 text-[11px] font-semibold text-maroon-600">Apply</p>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div className="card p-4">
              <h2 className="mb-3 font-display text-base font-bold">Order Summary</h2>

              {quote ? (
                <dl className="space-y-2 text-[14px]">
                  <Row label="Subtotal" value={formatMoney(quote.amounts.subtotalMinor, currency)} />
                  {quote.amounts.discountMinor > 0 ? (
                    <Row
                      label="Discount"
                      value={`− ${formatMoney(quote.amounts.discountMinor, currency)}`}
                      tone="leaf"
                    />
                  ) : null}
                  <Row
                    label="Delivery"
                    value={
                      quote.shippingChargedLater
                        ? 'Payment ke time'
                        : quote.amounts.shippingMinor === 0
                          ? 'FREE'
                          : formatMoney(quote.amounts.shippingMinor, currency)
                    }
                    tone={quote.amounts.shippingMinor === 0 && !quote.shippingChargedLater ? 'leaf' : undefined}
                  />
                  <div className="!mt-3 flex items-center justify-between border-t border-maroon-100 pt-3">
                    <dt className="text-[15px] font-bold">Total</dt>
                    <dd className="text-xl font-bold text-maroon-700">
                      {formatMoney(quote.amounts.totalMinor, currency)}
                    </dd>
                  </div>
                </dl>
              ) : (
                <div className="space-y-2">
                  <div className="skeleton h-4 w-full rounded" />
                  <div className="skeleton h-4 w-2/3 rounded" />
                  <div className="skeleton h-6 w-1/2 rounded" />
                </div>
              )}

              {pendingMeasurements > 0 ? (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-marigold-50 p-3 text-[13px] font-medium text-marigold-800">
                  <Ruler size={15} className="mt-0.5 shrink-0" />
                  {pendingMeasurements} custom blouse ka measurement baaki hai. Order se pehle bharna zaroori hai.
                </p>
              ) : null}

              {quote?.deliveryEstimate && quote.lines.some((l) => l.type === 'CUSTOMIZE') ? (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-marigold-50 p-3 text-[13px] font-medium text-marigold-800">
                  <Ruler size={15} className="mt-0.5 shrink-0" />
                  <span>
                    Custom stitching mein approx {quote.deliveryEstimate.stitchingWorkingDays} working day
                    {quote.deliveryEstimate.stitchingWorkingDays === 1 ? '' : 's'} lagenge — estimated delivery{' '}
                    {formatDate(quote.deliveryEstimate.from)} → {formatDate(quote.deliveryEstimate.to)}.
                  </span>
                </p>
              ) : null}

              {quote?.blocking ? (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-alert/10 p-3 text-[13px] font-medium text-alert">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  Kuch items order nahi ho sakte. Upar dekh kar theek karein.
                </p>
              ) : null}

              <button
                type="button"
                onClick={onCheckout}
                disabled={!quote || quote.blocking || quote.amounts.totalMinor === 0}
                className="btn-primary btn-lg mt-4 w-full"
              >
                Order Karein
                <ArrowRight size={18} />
              </button>

              <Link to="/ready-to-buy" className="btn-ghost mt-1 hidden w-full lg:flex">
                Aur shopping karein
              </Link>
            </div>
          </div>
        </aside>
      </div>

      <div className="h-4" />
    </div>
  );
}

function CartSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2.5 flex items-center gap-2 font-display text-[17px] font-bold text-ink">
        {title}
        <span className="rounded-full bg-maroon-100 px-2 py-0.5 text-[12px] font-bold text-maroon-700">{count}</span>
      </h2>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function CartRow({
  line,
  currency,
  onRemove,
  onQuantity,
  onMeasure,
}: {
  line: QuotedLine;
  currency: 'INR' | 'USD';
  onRemove: () => void;
  onQuantity: (next: number) => void;
  onMeasure?: () => void;
}) {
  const hasIssues = line.issues.length > 0;

  return (
    <article className={clsx('card overflow-hidden', hasIssues && 'ring-1 ring-alert/40')}>
      <div className="flex gap-3 p-3">
        <Link to={`/blouse/${line.slug}`} className="h-28 w-24 shrink-0 overflow-hidden rounded-lg bg-maroon-50">
          <SmartImage src={line.image} alt={line.name} className="object-contain" sizes="96px" />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link to={`/blouse/${line.slug}`} className="min-w-0">
              <h3 className="line-clamp-2 text-[14px] font-semibold leading-snug text-ink">{line.name}</h3>
            </Link>
            <button
              type="button"
              onClick={onRemove}
              aria-label="Cart se hatayein"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-maroon-50 hover:text-alert"
            >
              <Trash2 size={17} />
            </button>
          </div>

          <p className="mt-0.5 text-[12px] text-ink-muted">
            {[
              line.designId,
              line.colorName,
              line.size ? `Size ${line.size}` : '',
              line.fabricName ? `${line.fabricColorName} ${line.fabricName}` : '',
            ]
              .filter(Boolean)
              .join(' • ')}
          </p>

          {line.laceNames.length > 0 ? (
            <p className="text-[12px] text-ink-muted">Lace: {line.laceNames.join(', ')}</p>
          ) : null}

          {line.latkanNames.length > 0 ? (
            <p className="text-[12px] text-ink-muted">Latkan: {line.latkanNames.join(', ')}</p>
          ) : null}

          {line.type === 'CUSTOMIZE' ? (
            <div className="mt-1.5 grid gap-1 rounded-lg bg-maroon-50/60 px-2 py-1.5 text-[11.5px] text-ink-muted sm:grid-cols-2">
              <span>Fabric: {line.fabricName || 'Not selected'}</span>
              <span>Material: {line.fabricMaterial || 'Not specified'}</span>
              <span>Fabric colour: {line.fabricColorName || 'Not specified'}</span>
              <span>Extras: {line.laceNames.length + line.latkanNames.length} selected</span>
            </div>
          ) : null}

          {line.type === 'CUSTOMIZE' ? <MaterialDetails line={line} /> : null}

          {/* Measurement status (README §27) */}
          {line.type === 'CUSTOMIZE' ? (
            line.measurementReady ? (
              <p className="mt-1 flex items-center gap-1 text-[12.5px] font-semibold text-leaf">
                <Check size={14} /> Measurement complete
              </p>
            ) : (
              <button
                type="button"
                onClick={onMeasure}
                className="mt-1.5 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-marigold-500 px-3 text-[13px] font-bold text-ink"
              >
                <Ruler size={14} />
                Measurement Complete Karein
              </button>
            )
          ) : null}

          {line.note ? <p className="mt-1 text-[12px] italic text-ink-muted">"{line.note}"</p> : null}

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="inline-flex items-center rounded-lg border border-ink-light/25 bg-white">
              <button
                type="button"
                aria-label="Kam karein"
                className="h-9 w-9 text-lg font-bold text-maroon-700 disabled:opacity-40"
                disabled={line.quantity <= 1}
                onClick={() => onQuantity(line.quantity - 1)}
              >
                −
              </button>
              <span className="w-8 text-center text-sm font-bold">{line.quantity}</span>
              <button
                type="button"
                aria-label="Zyada karein"
                className="h-9 w-9 text-lg font-bold text-maroon-700 disabled:opacity-40"
                disabled={line.quantity >= 20}
                onClick={() => onQuantity(line.quantity + 1)}
              >
                +
              </button>
            </div>

            <span className={line.lineTotalMinor === 0 ? 'text-[15px] font-black uppercase tracking-wide text-leaf' : 'text-[15px] font-bold text-ink'}>
              {line.lineTotalMinor === 0 ? 'FREE' : formatMoney(line.lineTotalMinor, currency)}
            </span>
          </div>
        </div>
      </div>

      {hasIssues ? (
        <ul className="border-t border-alert/20 bg-alert/5 px-3 py-2">
          {line.issues.map((issue) => (
            <li key={issue} className="flex items-start gap-1.5 text-[12.5px] font-medium text-alert">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {issue}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function MaterialDetails({ line }: { line: QuotedLine }) {
  const materials = [
    ...line.fabricDetails.map((item) => ({ type: 'Fabric', name: item.name, detail: `${item.material} • ${item.colorName}`, image: item.image })),
    ...line.laceDetails.map((item) => ({ type: 'Lace', name: item.name, detail: item.colorName, image: item.image })),
    ...line.latkanDetails.map((item) => ({ type: 'Latkan', name: item.name, detail: item.colorName, image: item.image })),
  ];
  if (materials.length === 0) return null;
  return (
    <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
      {materials.map((item, index) => (
        <div key={`${item.type}-${item.name}-${index}`} className="flex min-w-[145px] items-center gap-2 rounded-lg border border-maroon-100 bg-white px-1.5 py-1.5">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-maroon-50">
            <SmartImage src={item.image} alt={item.name} className="object-contain" sizes="40px" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase text-maroon-700">{item.type}</p>
            <p className="truncate text-[11px] font-semibold text-ink">{item.name}</p>
            <p className="truncate text-[10px] text-ink-muted">{item.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'leaf' }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={clsx('font-semibold', tone === 'leaf' ? 'text-leaf' : 'text-ink')}>{value}</dd>
    </div>
  );
}
