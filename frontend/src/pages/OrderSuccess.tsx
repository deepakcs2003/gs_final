import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Package, MessageCircle, Truck } from 'lucide-react';
import clsx from 'clsx';
import { SmartImage } from '../components/SmartImage';
import { EmptyState } from '../components/ui';
import { useConfig, useOrder } from '../hooks/queries';
import { formatDate, formatMoney } from '../lib/format';
import type { OrderDetail } from '../lib/types';

/**
 * Order confirmation + tracking (README §35).
 *
 * Reachable by a guest with the order number and the mobile number on the
 * order — no account needed to see where a blouse has got to.
 */

const TIMELINE_STEPS = [
  'PLACED',
  'CONFIRMED',
  'PROCESSING',
  'STITCHING',
  'QUALITY_CHECK',
  'PACKED',
  'SHIPPED',
  'DELIVERED',
] as const;

const STEP_LABELS: Record<string, string> = {
  PLACED: 'Order Placed',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  STITCHING: 'Stitching',
  QUALITY_CHECK: 'Quality Check',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
};

export function OrderSuccessPage() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const [searchParams] = useSearchParams();
  const mobile = searchParams.get('mobile') ?? undefined;

  const { data: config } = useConfig();
  const { data: order, isLoading, isError } = useOrder(orderNumber, mobile);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 px-3 pt-6 sm:px-5">
        <div className="skeleton h-28 rounded-xl2" />
        <div className="skeleton h-48 rounded-xl2" />
      </div>
    );
  }

  if (isError || !order) {
    return (
      <EmptyState
        icon={<Package size={30} />}
        title="Order nahi mila"
        message="Order number ya mobile number check karein."
        action={
          <Link to="/orders" className="btn-primary">
            My Orders
          </Link>
        }
      />
    );
  }

  const isCustom = order.items.some((item) => item.type === 'CUSTOMIZE');
  // Stitching only applies when something is actually being made.
  const steps = TIMELINE_STEPS.filter((step) => (step === 'STITCHING' ? isCustom : true));
  const currentIndex = steps.indexOf(order.status as (typeof steps)[number]);
  const failed = order.status === 'FAILED' || order.status === 'CANCELLED';

  // Parcel tracking rail — driven by shipping.status, not the order timeline.
  const PARCEL_STEPS = ['Assigned', 'In Transit', 'Out for Delivery', 'Delivered'];
  const parcelIndex =
    order.tracking.status === 'DELIVERED' ? 3
      : order.tracking.status === 'OUT_FOR_DELIVERY' ? 2
        : order.tracking.status === 'IN_TRANSIT' ? 1
          : 0;

  return (
    <div className="mx-auto max-w-2xl px-3 pt-5 sm:px-5">
      <div
        className={clsx(
          'card mb-4 p-5 text-center',
          failed ? 'bg-alert/5' : 'bg-leaf/5',
        )}
      >
        <CheckCircle2 size={44} className={clsx('mx-auto mb-2', failed ? 'text-alert' : 'text-leaf')} />
        <h1 className="font-display text-xl font-bold text-ink">
          {failed ? 'Order complete nahi hua' : 'Shukriya! Aapka order mil gaya 🌸'}
        </h1>
        <p className="hint mt-1">
          Order ID: <span className="font-bold text-ink">{order.orderNumber}</span>
        </p>
        <p className="hint">{formatDate(order.placedAt)}</p>

        {order.paymentMethod === 'COD' && !failed ? (
          <p className="mt-3 rounded-xl bg-marigold-50 px-3 py-2 text-[13px] font-semibold text-marigold-800">
            {order.amounts.codAdvanceMinor > 0
              ? `Advance ${formatMoney(order.amounts.codAdvanceMinor, order.currency)} paid. Delivery par ${formatMoney(order.amounts.codBalanceMinor, order.currency)} dena hoga.`
              : `Delivery ke waqt ${formatMoney(order.totalMinor, order.currency)} dena hoga`}
          </p>
        ) : null}

        {order.status === 'AWAITING_REVIEW' ? (
          <p className="mt-3 rounded-xl bg-marigold-50 px-3 py-2 text-[13px] font-semibold text-marigold-800">
            Aapka order hamare team ke review mein hai — kuch hi waqt mein confirm hoke timeline yahan aa jayegi.
          </p>
        ) : null}
      </div>

      {order.deliveryEstimate && isCustom ? (
        <section className="card mb-4 p-4">
          <h2 className="font-display text-base font-bold">Estimated delivery</h2>
          <p className="hint mt-1">
            Custom stitching mein approx {order.deliveryEstimate.stitchingWorkingDays} working day
            {order.deliveryEstimate.stitchingWorkingDays === 1 ? '' : 's'} lagenge, uske baad shipping.
          </p>
          <p className="mt-3 text-sm font-semibold text-ink">
            {formatDate(order.deliveryEstimate.from)} → {formatDate(order.deliveryEstimate.to)}
          </p>
          <p className="hint mt-1">Ye ek estimation hai — exact date confirm hokar WhatsApp/SMS par bheji jayegi.</p>
        </section>
      ) : null}

      {/* Timeline */}
      {!failed ? (
        <section className="card mb-4 p-4">
          <h2 className="mb-3 font-display text-base font-bold">Order Status</h2>
          <ol className="space-y-0">
            {steps.map((step, index) => {
              const done = currentIndex >= index;
              const isCurrent = currentIndex === index;
              return (
                <li key={step} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={clsx(
                        'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                        done ? 'bg-leaf text-white' : 'bg-maroon-100 text-maroon-400',
                      )}
                    >
                      {done ? '✓' : index + 1}
                    </span>
                    {index < steps.length - 1 ? (
                      <span className={clsx('h-6 w-0.5', done ? 'bg-leaf' : 'bg-maroon-100')} />
                    ) : null}
                  </div>
                  <span
                    className={clsx(
                      'pb-1.5 text-[14px]',
                      isCurrent ? 'font-bold text-ink' : done ? 'font-medium text-ink' : 'text-ink-muted',
                    )}
                  >
                    {STEP_LABELS[step]}
                  </span>
                </li>
              );
            })}
          </ol>

          {order.tracking.awb ? (
            <div className="mt-4 rounded-xl border border-ink-light/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-bold text-ink">Parcel tracking</p>
                <span className="rounded-full bg-maroon-50 px-2 py-0.5 text-[10px] font-bold text-maroon-700">
                  {order.tracking.courier || 'Courier'} • AWB {order.tracking.awb}
                </span>
              </div>
              <ol className="mt-3 flex items-center gap-1">
                {PARCEL_STEPS.map((label, index) => (
                  <li
                    key={label}
                    className={clsx(
                      'flex-1 rounded-lg px-1.5 py-1 text-center text-[11px] font-semibold',
                      index <= parcelIndex ? 'bg-leaf/15 text-leaf' : 'bg-maroon-50 text-ink-muted',
                    )}
                  >
                    {label}
                  </li>
                ))}
              </ol>
              {order.tracking.statusText ? (
                <p className="mt-2 text-[12px] text-ink-muted">{order.tracking.statusText.split('\n')[0]}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-muted">
                {order.tracking.estimatedDeliveryAt ? (
                  <span>Estimated delivery: {formatDate(order.tracking.estimatedDeliveryAt)}</span>
                ) : null}
                {order.tracking.lastSyncedAt ? (
                  <span>Updated {new Date(order.tracking.lastSyncedAt).toLocaleString('en-IN')}</span>
                ) : null}
              </div>
              {order.tracking.trackingUrl ? (
                <a
                  href={order.tracking.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-outline mt-2 w-full"
                >
                  <Truck size={15} /> Track on courier site
                </a>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Items */}
      <section className="card mb-4 p-4">
        <h2 className="mb-3 font-display text-base font-bold">Aapke items</h2>
        <ul className="space-y-3">
          {order.items.map((item, index) => (
            <li key={`${item.designId}-${index}`} className="flex gap-3">
              <Link to={`/blouse/${item.slug}`} className="h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-maroon-50">
                <SmartImage src={item.image} alt={item.name} className="object-contain" sizes="64px" />
              </Link>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[14px] font-semibold text-ink">{item.name}</p>
                <p className="text-[12px] text-ink-muted">
                  {[item.designId, item.colorName, item.size ? `Size ${item.size}` : '', item.fabricName]
                    .filter(Boolean)
                    .join(' • ')}
                </p>
                {item.laceNames && item.laceNames.length > 0 ? (
                  <p className="text-[12px] text-ink-muted">Lace: {item.laceNames.join(', ')}</p>
                ) : null}
                {item.latkanNames && item.latkanNames.length > 0 ? (
                  <p className="text-[12px] text-ink-muted">Latkan: {item.latkanNames.join(', ')}</p>
                ) : null}
                <OrderMaterialDetails item={item} />
                <p className="text-[12px] text-ink-muted">Qty: {item.quantity}</p>
              </div>
              <span className={item.lineTotalMinor === 0 ? 'shrink-0 text-[14px] font-black uppercase tracking-wide text-leaf' : 'shrink-0 text-[14px] font-bold'}>
                {item.lineTotalMinor === 0 ? 'FREE' : formatMoney(item.lineTotalMinor, order.currency)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1.5 border-t border-maroon-100 pt-3 text-[14px]">
          <div className="flex justify-between">
            <dt className="text-ink-muted">Subtotal</dt>
            <dd className="font-semibold">{formatMoney(order.amounts.subtotalMinor, order.currency)}</dd>
          </div>
          {order.amounts.discountMinor > 0 ? (
            <div className="flex justify-between">
              <dt className="text-ink-muted">Discount</dt>
              <dd className="font-semibold text-leaf">− {formatMoney(order.amounts.discountMinor, order.currency)}</dd>
            </div>
          ) : null}
          {order.paymentMethod === 'COD' && order.amounts.codAdvanceMinor > 0 ? (
            <>
              <div className="flex justify-between">
                <dt className="text-ink-muted">COD advance paid</dt>
                <dd className="font-semibold text-leaf">{formatMoney(order.amounts.codAdvanceMinor, order.currency)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">COD balance at delivery</dt>
                <dd className="font-semibold">{formatMoney(order.amounts.codBalanceMinor, order.currency)}</dd>
              </div>
            </>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-ink-muted">Delivery</dt>
            <dd className="font-semibold">
              {order.amounts.shippingMinor === 0 ? 'FREE' : formatMoney(order.amounts.shippingMinor, order.currency)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-maroon-100 pt-2">
            <dt className="font-bold">Total</dt>
            <dd className="text-lg font-bold text-maroon-700">{formatMoney(order.totalMinor, order.currency)}</dd>
          </div>
        </dl>
      </section>

      {/* Delivery address */}
      <section className="card mb-4 p-4">
        <h2 className="mb-2 font-display text-base font-bold">Delivery Address</h2>
        <p className="text-[14px] leading-relaxed text-ink">
          {order.contact.name}
          <br />
          {order.address.line1}
          {order.address.line2 ? `, ${order.address.line2}` : ''}
          <br />
          {order.address.city}, {order.address.state} — {order.address.pincode}
          <br />
          {order.contact.mobile}
        </p>
        {order.customerNote ? <p className="mt-2 text-[13px] italic text-ink-muted">"{order.customerNote}"</p> : null}
      </section>

      <div className="flex gap-2.5">
        {config?.whatsappNumber ? (
          <a
            href={`https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent(
              `Hello Guddi Silai 🌸\nMera order number ${order.orderNumber} hai.\n`,
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline flex-1 border-leaf text-leaf"
          >
            <MessageCircle size={17} />
            Help chahiye
          </a>
        ) : null}
        <Link to="/ready-to-buy" className="btn-primary flex-1">
          Aur shopping karein
        </Link>
      </div>

      <div className="h-4" />
    </div>
  );
}

function OrderMaterialDetails({ item }: { item: OrderDetail['items'][number] }) {
  const materials = [
    ...(item.fabricDetails ?? []).map((material) => ({ type: 'Fabric', name: material.name, detail: `${material.material} • ${material.colorName}`, image: material.image })),
    ...(item.laceDetails ?? []).map((material) => ({ type: 'Lace', name: material.name, detail: material.colorName, image: material.image })),
    ...(item.latkanDetails ?? []).map((material) => ({ type: 'Latkan', name: material.name, detail: material.colorName, image: material.image })),
  ];
  if (materials.length === 0) return null;
  return (
    <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
      {materials.map((material, index) => (
        <div key={`${material.type}-${material.name}-${index}`} className="flex min-w-[132px] items-center gap-1.5 rounded-md border border-maroon-100 bg-maroon-50/40 p-1">
          <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-white"><SmartImage src={material.image} alt={material.name} className="object-contain" sizes="32px" /></div>
          <div className="min-w-0"><p className="text-[9px] font-bold uppercase text-maroon-700">{material.type}</p><p className="truncate text-[10px] font-semibold">{material.name}</p><p className="truncate text-[9px] text-ink-muted">{material.detail}</p></div>
        </div>
      ))}
    </div>
  );
}
