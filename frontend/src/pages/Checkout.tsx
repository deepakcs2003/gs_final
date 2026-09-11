import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldCheck, Truck, Banknote, CreditCard, MapPin, Check, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { EmptyState } from '../components/ui';
import { useCartQuote, useConfig, useCurrentUser, usePincodeCheck } from '../hooks/queries';
import { toApiLines, useCart } from '../store/cart';
import { useUi } from '../store/ui';
import { api, ApiError } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';
import { track } from '../lib/analytics';

/**
 * Checkout (README §12, §29).
 *
 * Guest checkout is the default — login is offered, never required. The client
 * sends choices and an address; the server prices the order, so nothing here
 * can change what is charged.
 */

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface CreateOrderResponse {
  orderNumber: string;
  paymentMethod: 'RAZORPAY' | 'COD';
  razorpayOrderId?: string;
  razorpayKeyId?: string;
  amountMinor?: number;
  currency?: 'INR' | 'USD';
  totalMinor?: number;
  codAdvanceMinor?: number;
  codBalanceMinor?: number;
  prefill?: { name: string; contact: string; email: string };
}

/** Loads Razorpay's checkout script once, on demand. */
function loadRazorpay(): Promise<boolean> {
  if ((window as unknown as { Razorpay?: unknown }).Razorpay) return Promise.resolve(true);

  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

export function CheckoutPage() {
  const navigate = useNavigate();
  const lines = useCart((state) => state.lines);
  const appliedCoupon = useCart((state) => state.appliedCoupon);
  const clearCart = useCart((state) => state.clear);
  const toast = useUi((state) => state.toast);
  const openLogin = useUi((state) => state.openLogin);

  const { data: config } = useConfig();
  const { data: user } = useCurrentUser();
  const { data: quote } = useCartQuote(appliedCoupon);
  const pincodeCheck = usePincodeCheck();

  const [form, setForm] = useState({
    name: '',
    mobile: '',
    email: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    pincode: '',
  });
  const [paymentMethod, setPaymentMethod] = useState<'RAZORPAY' | 'COD'>('RAZORPAY');
  const [customerNote, setCustomerNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [placing, setPlacing] = useState(false);

  const currency = quote?.currency ?? config?.currency ?? 'INR';
  const codAllowed = quote?.codAllowed ?? config?.codAllowed ?? false;

  // Prefill from the customer's saved default address.
  useEffect(() => {
    if (!user) return;
    const address = user.addresses.find((a) => a.isDefault) ?? user.addresses[0];
    setForm((current) => ({
      ...current,
      name: current.name || user.name || address?.name || '',
      ...(address
        ? {
            line1: current.line1 || address.line1,
            line2: current.line2 || address.line2,
            city: current.city || address.city,
            state: current.state || address.state,
            pincode: current.pincode || address.pincode,
          }
        : {}),
    }));
  }, [user]);

  // COD cannot be preselected where it isn't offered (README §32).
  useEffect(() => {
    if (!codAllowed && paymentMethod === 'COD') setPaymentMethod('RAZORPAY');
  }, [codAllowed, paymentMethod]);

  useEffect(() => {
    if (!pincodeCheck.data?.valid || pincodeCheck.data.pincode !== form.pincode) return;
    setForm((current) => ({
      ...current,
      city: pincodeCheck.data.city,
      state: pincodeCheck.data.state,
      line2: pincodeCheck.data.areas[0] || current.line2,
    }));
  }, [form.pincode, pincodeCheck.data]);

  if (lines.length === 0) {
    return (
      <EmptyState
        icon={<Truck size={30} />}
        title="Cart khaali hai"
        message="Order karne ke liye pehle kuch designs cart mein daalein."
        action={
          <Link to="/ready-to-buy" className="btn-primary">
            Designs dekhein
          </Link>
        }
      />
    );
  }

  const set = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = 'Apna naam likhein.';
    if (!/^[6-9]\d{9}$/.test(form.mobile)) next.mobile = '10 digit ka mobile number likhein.';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Email sahi nahi hai.';
    if (form.line1.trim().length < 4) next.line1 = 'Pura address likhein.';
    if (form.city.trim().length < 2) next.city = 'City likhein.';
    if (form.state.trim().length < 2) next.state = 'State likhein.';
    if (!/^\d{6}$/.test(form.pincode)) next.pincode = '6 digit ka pincode likhein.';
    else if (!pincodeCheck.data?.valid || pincodeCheck.data.pincode !== form.pincode) next.pincode = 'Pincode pehle verify karein.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const placeOrder = async () => {
    if (!validate()) {
      toast('Kuch details baaki hain', 'error');
      return;
    }

    setPlacing(true);
    try {
      const order = await api<CreateOrderResponse>('/orders', {
        method: 'POST',
        body: {
          lines: toApiLines(lines),
          contact: { name: form.name.trim(), mobile: form.mobile, ...(form.email ? { email: form.email } : {}) },
          address: {
            line1: form.line1.trim(),
            line2: form.line2.trim(),
            city: form.city.trim(),
            state: form.state.trim(),
            pincode: form.pincode,
            country: config?.country ?? 'IN',
          },
          paymentMethod,
          ...(appliedCoupon ? { couponCode: appliedCoupon } : {}),
          ...(customerNote ? { customerNote } : {}),
        },
      });

      track('ORDER_PLACED', { value: quote?.amounts.totalMinor ?? 0 });

      if (order.paymentMethod === 'COD' && !order.razorpayOrderId) {
        clearCart();
        navigate(`/order/${order.orderNumber}?mobile=${form.mobile}`);
        return;
      }

      await payWithRazorpay(order);
    } catch (err) {
      if (err instanceof ApiError) {
        const issues = (err.details as { error?: { fields?: { issues?: string[] } } })?.error?.fields?.issues;
        toast(issues?.[0] ?? err.message, 'error');
      } else {
        toast('Order place nahi ho paya. Dobara try karein.', 'error');
      }
    } finally {
      setPlacing(false);
    }
  };

  const payWithRazorpay = async (order: CreateOrderResponse) => {
    const ready = await loadRazorpay();
    if (!ready || !order.razorpayKeyId) {
      toast('Payment window nahi khul paya. COD try karein.', 'error');
      return;
    }

    const RazorpayCtor = (window as unknown as { Razorpay: new (options: unknown) => { open: () => void } }).Razorpay;

    const checkout = new RazorpayCtor({
      key: order.razorpayKeyId,
      amount: order.amountMinor,
      currency: order.currency,
      name: 'Guddi Silai',
      description: order.paymentMethod === 'COD' ? `COD advance for ${order.orderNumber}` : `Order ${order.orderNumber}`,
      order_id: order.razorpayOrderId,
      prefill: order.prefill,
      theme: { color: '#7B1E3B' },
      handler: async (response: RazorpayResponse) => {
        try {
          // The signature is verified server-side; a success here means nothing
          // until the server confirms it.
          await api(`/orders/${order.orderNumber}/verify-payment`, {
            method: 'POST',
            body: {
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
            },
          });
          track('PAYMENT_SUCCESS', { value: order.amountMinor ?? 0 });
          clearCart();
          navigate(`/order/${order.orderNumber}?mobile=${form.mobile}`);
        } catch (err) {
          track('PAYMENT_FAILED');
          toast(err instanceof ApiError ? err.message : 'Payment verify nahi hua.', 'error');
        }
      },
      modal: {
        ondismiss: () => {
          toast('Payment cancel ho gaya. Cart safe hai.', 'info');
        },
      },
    });

    checkout.open();
  };

  const pincodeResult = pincodeCheck.data;

  return (
    <div className="mx-auto max-w-5xl px-3 pt-4 sm:px-5">
      <h1 className="section-title mb-1">Checkout</h1>
      {!user ? (
        <p className="hint mb-4">
          Guest ke roop mein order kar sakti hain.{' '}
          <button type="button" onClick={() => openLogin('/checkout')} className="font-semibold text-maroon-700 underline">
            Ya login karein
          </button>
        </p>
      ) : (
        <p className="hint mb-4">Namaste {user.name || 'ji'} 🙏</p>
      )}

      <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-6">
        <div className="space-y-4">
          {/* Contact */}
          <section className="card p-4">
            <h2 className="mb-3 font-display text-base font-bold">Aapki Details</h2>
            <div className="space-y-3">
              <Field label="Pura naam" error={errors.name} required>
                <input value={form.name} onChange={(e) => set('name', e.target.value)} className="field" maxLength={80} />
              </Field>
              <Field label="Mobile number" error={errors.mobile} required hint="Delivery ke liye zaroori hai">
                <div className="flex gap-2">
                  <span className="grid h-12 shrink-0 place-items-center rounded-xl border border-ink-light/30 bg-maroon-50 px-3 text-[15px] font-semibold">
                    +91
                  </span>
                  <input
                    value={form.mobile}
                    onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))}
                    inputMode="numeric"
                    className="field"
                  />
                </div>
              </Field>
              <Field label="Email" error={errors.email} hint="Optional — order updates ke liye">
                <input
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  type="email"
                  className="field"
                  maxLength={160}
                />
              </Field>
            </div>
          </section>

          {/* Address */}
          <section className="card p-4">
            <h2 className="mb-3 flex items-center gap-2 font-display text-base font-bold">
              <MapPin size={17} />
              Delivery Address
            </h2>
            <div className="space-y-3">
              <Field label="House / Street" error={errors.line1} required>
                <input value={form.line1} onChange={(e) => set('line1', e.target.value)} className="field" maxLength={160} />
              </Field>
              <Field label="Area / Landmark">
                <input value={form.line2} onChange={(e) => set('line2', e.target.value)} className="field" maxLength={160} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="City" error={errors.city} required>
                  <input value={form.city} onChange={(e) => set('city', e.target.value)} className="field" maxLength={60} />
                </Field>
                <Field label="State" error={errors.state} required>
                  <input value={form.state} onChange={(e) => set('state', e.target.value)} className="field" maxLength={60} />
                </Field>
              </div>

              {/* Pincode check (README §72) */}
              <Field label="Pincode" error={errors.pincode} required>
                <div className="flex gap-2">
                  <input
                    value={form.pincode}
                      onChange={(e) => {
                        pincodeCheck.reset();
                        setForm((current) => ({
                          ...current,
                          pincode: e.target.value.replace(/\D/g, '').slice(0, 6),
                          city: '',
                          state: '',
                          line2: '',
                        }));
                        setErrors((current) => {
                          const next = { ...current };
                          delete next.pincode;
                          delete next.city;
                          delete next.state;
                          return next;
                        });
                      }}
                    inputMode="numeric"
                    className="field"
                  />
                  <button
                    type="button"
                    disabled={form.pincode.length !== 6 || pincodeCheck.isPending}
                    onClick={() => pincodeCheck.mutate(form.pincode)}
                    className="btn-outline shrink-0 px-4"
                  >
                    {pincodeCheck.isPending ? '…' : 'Check'}
                  </button>
                </div>
              </Field>

              {pincodeResult ? (
                <p
                  className={clsx(
                    'flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium',
                    pincodeResult.serviceable ? 'bg-leaf/10 text-leaf' : 'bg-alert/10 text-alert',
                  )}
                >
                  {pincodeResult.serviceable ? <Check size={15} className="mt-0.5" /> : null}
                  {pincodeResult.valid && pincodeResult.serviceable
                    ? `${pincodeResult.city}, ${pincodeResult.state} • ${pincodeResult.estimatedDeliveryText}${pincodeResult.courier ? ` • ${pincodeResult.courier}` : ''}`
                    : pincodeResult.valid
                      ? 'Pincode valid hai, lekin is address par delivery available nahi hai.'
                      : 'Pincode verify nahi hua. Pincode check karein.'}
                </p>
              ) : null}
            </div>
          </section>

          {/* Payment */}
          <section className="card p-4">
            <h2 className="mb-3 font-display text-base font-bold">Payment</h2>
            <div className="space-y-2.5">
              <PaymentOption
                selected={paymentMethod === 'RAZORPAY'}
                onSelect={() => setPaymentMethod('RAZORPAY')}
                icon={<CreditCard size={20} />}
                title="Online Payment"
                subtitle="UPI, Card, Netbanking, Wallet"
                disabled={!config?.razorpay.enabled}
              />
              <PaymentOption
                selected={paymentMethod === 'COD'}
                onSelect={() => setPaymentMethod('COD')}
                icon={<Banknote size={20} />}
                title="Cash on Delivery"
                subtitle={codAllowed ? 'Saman milne par paisa dein' : 'Aapke country ke liye available nahi'}
                disabled={!codAllowed}
              />
              {config?.razorpay.enabled ? (
                <p className="flex items-start gap-1.5 text-[12px] leading-snug text-ink-muted">
                  <ShieldCheck size={13} className="mt-0.5 shrink-0 text-leaf" />
                  Desktop par UPI ke liye Razorpay ek QR code dikhati hai — phone ke kisi bhi UPI app se scan karke pay karein. Mobile par UPI apps direct dikhte hain.
                </p>
              ) : null}
            </div>

            <label className="label mt-4" htmlFor="order-note">
              Order ke liye koi note? <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <textarea
              id="order-note"
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value.slice(0, 500))}
              rows={2}
              placeholder="Jaise: shaam ko deliver karein"
              className="field py-3"
            />
          </section>
        </div>

        {/* Summary */}
        <aside className="mt-4 lg:mt-0">
          <div className="lg:sticky lg:top-[calc(var(--header-h)+16px)]">
            <div className="card p-4">
              <h2 className="mb-3 font-display text-base font-bold">Order Summary</h2>

              <ul className="mb-3 space-y-2 border-b border-maroon-100 pb-3">
                {quote?.lines.map((line) => (
                  <li key={line.key} className="flex justify-between gap-2 text-[13px]">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{line.name}</span>
                      <span className="text-ink-muted">
                        {line.quantity} × {line.colorName || line.fabricName || line.designId}
                      </span>
                      {line.type === 'CUSTOMIZE' ? (
                        <span className="block text-[11px] text-ink-muted">
                          Fabric: {line.fabricName || 'Not selected'}
                          {line.laceNames.length ? ` • Lace: ${line.laceNames.join(', ')}` : ''}
                          {line.latkanNames.length ? ` • Latkan: ${line.latkanNames.join(', ')}` : ''}
                        </span>
                      ) : null}
                    </span>
                    <span className={line.lineTotalMinor === 0 ? 'shrink-0 font-black uppercase tracking-wide text-leaf' : 'shrink-0 font-semibold'}>
                      {line.lineTotalMinor === 0 ? 'FREE' : formatMoney(line.lineTotalMinor, currency)}
                    </span>
                  </li>
                ))}
              </ul>

              {quote ? (
                <dl className="space-y-2 text-[14px]">
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Subtotal</dt>
                    <dd className="font-semibold">{formatMoney(quote.amounts.subtotalMinor, currency)}</dd>
                  </div>
                  {quote.amounts.discountMinor > 0 ? (
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">Discount</dt>
                      <dd className="font-semibold text-leaf">− {formatMoney(quote.amounts.discountMinor, currency)}</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Delivery</dt>
                    <dd className="font-semibold">
                      {quote.shippingChargedLater
                        ? 'Payment ke time'
                        : quote.amounts.shippingMinor === 0
                          ? 'FREE'
                          : formatMoney(quote.amounts.shippingMinor, currency)}
                    </dd>
                  </div>
                  {paymentMethod === 'COD' && quote.amounts.codAdvanceMinor > 0 ? (
                    <>
                      <div className="flex justify-between border-t border-maroon-100 pt-2">
                        <dt className="font-semibold text-maroon-700">COD advance ({Math.round((quote.amounts.codAdvanceMinor / Math.max(quote.amounts.codAdvanceMinor + quote.amounts.codBalanceMinor, 1)) * 100)}%)</dt>
                        <dd className="font-bold text-maroon-700">{formatMoney(quote.amounts.codAdvanceMinor, currency)} now</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-ink-muted">Delivery par balance</dt>
                        <dd className="font-semibold">{formatMoney(quote.amounts.codBalanceMinor, currency)}</dd>
                      </div>
                    </>
                  ) : null}
                  <div className="!mt-3 flex items-center justify-between border-t border-maroon-100 pt-3">
                    <dt className="text-[15px] font-bold">Total</dt>
                    <dd className="text-xl font-bold text-maroon-700">
                      {formatMoney(quote.amounts.totalMinor, currency)}
                    </dd>
                  </div>
                </dl>
              ) : null}

              {quote?.deliveryEstimate && quote.lines.some((l) => l.type === 'CUSTOMIZE') ? (
                <p className="mt-4 rounded-xl bg-marigold-50 px-3 py-2 text-[12px] font-medium text-marigold-800">
                  Custom stitching mein approx {quote.deliveryEstimate.stitchingWorkingDays} working day
                  {quote.deliveryEstimate.stitchingWorkingDays === 1 ? '' : 's'} lagenge — estimated delivery{' '}
                  {formatDate(quote.deliveryEstimate.from)} → {formatDate(quote.deliveryEstimate.to)}.
                </p>
              ) : null}

              {quote?.blocking ? (
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-alert/10 p-3 text-[13px] font-medium text-alert">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span className="space-y-1">
                    <span className="block font-bold">Kuch items order nahi ho sakte.</span>
                    {quote.lines.flatMap((line) => line.issues).length > 0 ? (
                      <span className="block">{quote.lines.flatMap((line) => line.issues).join(' • ')}</span>
                    ) : null}
                    <Link to="/cart" className="block font-bold underline">
                      Cart mein theek kar ke wapas aayein
                    </Link>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void placeOrder()}
                  disabled={placing || !quote || quote.blocking}
                  className="btn-primary btn-lg mt-4 w-full"
                >
                  {placing
                    ? 'Ruk jaiye…'
                    : paymentMethod === 'COD'
                      ? quote && quote.amounts.codAdvanceMinor > 0
                        ? `Pay COD advance ${formatMoney(quote.amounts.codAdvanceMinor, currency)}`
                        : 'COD Order Confirm Karein'
                      : `Pay ${quote ? formatMoney(quote.amounts.totalMinor, currency) : ''}`}
                </button>
              )}

              <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-ink-muted">
                <ShieldCheck size={14} className="text-leaf" />
                Payment secure hai — details save nahi hoti
              </p>
            </div>
          </div>
        </aside>
      </div>

      <div className="h-4" />
    </div>
  );
}

function Field({
  label,
  children,
  error,
  hint,
  required,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div>
      <span className="label">
        {label}
        {required ? <span className="text-alert"> *</span> : null}
      </span>
      {children}
      {error ? <p className="mt-1 text-[13px] font-medium text-alert">{error}</p> : hint ? <p className="hint mt-1">{hint}</p> : null}
    </div>
  );
}

function PaymentOption({
  selected,
  onSelect,
  icon,
  title,
  subtitle,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={clsx(
        'flex w-full items-center gap-3 rounded-xl border-2 p-3.5 text-left transition',
        selected && !disabled ? 'border-maroon-600 bg-maroon-50' : 'border-ink-light/25 bg-white',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-full', selected ? 'bg-maroon-600 text-white' : 'bg-maroon-50 text-maroon-600')}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold text-ink">{title}</span>
        <span className="block text-[12.5px] text-ink-muted">{subtitle}</span>
      </span>
      <span
        className={clsx(
          'grid h-5 w-5 shrink-0 place-items-center rounded-full border-2',
          selected && !disabled ? 'border-maroon-600 bg-maroon-600' : 'border-ink-light/40',
        )}
      >
        {selected && !disabled ? <Check size={12} className="text-white" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}
