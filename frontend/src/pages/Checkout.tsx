import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, Mail, Home, Landmark, Building2, Map, Navigation, ShieldCheck, Truck, Banknote, CreditCard, MapPin, Check, AlertTriangle, Tag, X, ShoppingBag, ArrowLeft, QrCode, MessageSquare, ChevronDown, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { EmptyState } from '../components/ui';
import { useCartQuote, useAvailableCoupons, useConfig, useCurrentUser, usePincodeCheck } from '../hooks/queries';
import { buyModeLines, toApiLines, useCart } from '../store/cart';
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
  const buyKeys = useCart((state) => state.buyKeys);
  const appliedCoupon = useCart((state) => state.appliedCoupon);
  const setAppliedCoupon = useCart((state) => state.setAppliedCoupon);
  const clearCart = useCart((state) => state.clear);
  const removeFromCart = useCart((state) => state.remove);
  const removeKeys = useCart((state) => state.removeKeys);
  const endBuy = useCart((state) => state.endBuy);
  const toast = useUi((state) => state.toast);
  const openLogin = useUi((state) => state.openLogin);

  // "Buy Now" orders only the chosen line(s) even if other things sit in the
  // cart; the coupon list below reflects the same selection.
  const activeLines = useMemo(() => buyModeLines(lines, buyKeys), [lines, buyKeys]);
  const hasCustom = activeLines.some((line) => line.type === 'CUSTOMIZE');

  const { data: config } = useConfig();
  const { data: user } = useCurrentUser();
  const { data: quote } = useCartQuote(appliedCoupon);
  const { data: available } = useAvailableCoupons();
  const pincodeCheck = usePincodeCheck();

  const [couponInput, setCouponInput] = useState(appliedCoupon);

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
  const isBuyNow = buyKeys.length > 0;
  const [paymentMethod, setPaymentMethod] = useState<'RAZORPAY' | 'COD'>('RAZORPAY');
  const [customerNote, setCustomerNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [placing, setPlacing] = useState(false);
  const [itemsOpen, setItemsOpen] = useState(true);

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

  // Fill city/state from the verified pincode. Area/landmark are intentionally
  // NOT auto-filled — the customer types those themselves.
  useEffect(() => {
    if (!pincodeCheck.data?.valid || pincodeCheck.data.pincode !== form.pincode) return;
    setForm((current) => ({
      ...current,
      city: pincodeCheck.data.city,
      state: pincodeCheck.data.state,
    }));
  }, [form.pincode, pincodeCheck.data]);

  // Auto-verify the pincode the moment all 6 digits are entered.
  useEffect(() => {
    if (form.pincode.length !== 6) return;
    if (pincodeCheck.data?.pincode === form.pincode) return;
    if (!pincodeCheck.isPending) pincodeCheck.mutate(form.pincode);
  }, [form.pincode, pincodeCheck.data?.pincode, pincodeCheck.isPending, pincodeCheck.mutate]);

  // Leaving checkout (browser back, or the back button below) ends a "Buy Now"
  // session, so the item stays in the cart as an ordinary line.
  useEffect(() => {
    return () => endBuy();
  }, [endBuy]);

  if (activeLines.length === 0) {
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

  const applyCoupon = () => {
    setAppliedCoupon(couponInput);
  };

  const clearCoupon = () => {
    setCouponInput('');
    setAppliedCoupon('');
  };

  // Back = the product stays safe in the cart; buy mode ends so the whole
  // cart is visible again on the cart page.
  const onBack = () => {
    endBuy();
    navigate('/cart');
  };

  // Order summary se kisi item ko hatao. Buy Now mein sirf wahi line order
  // ho raha tha, isliye usse cart se bhi nikaal kar buy mode band kar dete
  // hain — baaki cart items (agar hain) normal cart checkout ban jaate hain.
  const removeLine = (lineKey: string) => {
    if (isBuyNow) {
      removeKeys(buyKeys);
      endBuy();
    } else {
      removeFromCart(lineKey);
    }
    toast('Item order se hata diya', 'info');
  };

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

  /** Order lagne ke baad cart ka haal: cart checkout = poori cart clear; Buy Now
   *  = sirf khareeda item hataya, baaki saman cart mein waise ka waasa rehta hai. */
  const finishOrder = (orderNumber: string, mobile: string) => {
    if (isBuyNow) {
      removeKeys(buyKeys);
      setAppliedCoupon('');
    } else {
      clearCart();
    }
    endBuy();
    navigate(`/order/${orderNumber}?mobile=${encodeURIComponent(mobile)}`);
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
          lines: toApiLines(activeLines),
          checkoutMode: isBuyNow ? 'buy_now' : 'cart',
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
        finishOrder(order.orderNumber, form.mobile);
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
          finishOrder(order.orderNumber, form.mobile);
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
      <div className="mb-2 flex items-center gap-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Wapas jayein"
          className="btn-outline flex h-9 w-9 shrink-0 items-center justify-center !px-0 lg:hidden"
        >
          <ArrowLeft size={17} />
        </button>
        <h1 className="section-title mb-0 flex-1">Checkout</h1>
        <button
          type="button"
          onClick={onBack}
          className="hidden shrink-0 items-center gap-1.5 text-[13px] font-semibold text-maroon-700 hover:underline lg:flex"
        >
          <ArrowLeft size={15} />
          Cart mein wapas
        </button>
      </div>

      <nav className="mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-ink-muted">
        <Link to="/ready-to-buy" className="hover:underline">
          Shopping
        </Link>
        <span>›</span>
        <Link to="/cart" onClick={onBack} className="hover:underline">
          Cart
        </Link>
        <span>›</span>
        <span className="font-semibold text-ink">Checkout</span>
      </nav>

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
          {/* Customer Details */}
          <section className="card p-5">
            <SectionHeading icon={<User size={17} />} title="Customer Details" />
            <div className="space-y-4">
              <Field label="Full name" error={errors.name} required>
                <IconInput icon={<User size={16} strokeWidth={1.8} />} value={form.name} onChange={(e) => set('name', e.target.value)} invalid={Boolean(errors.name)} maxLength={80} placeholder="Apna pura naam likhein" />
              </Field>
              <Field label="Mobile number" error={errors.mobile} required hint="Delivery ke liye zaroori hai">
                <div className="flex gap-2">
                  <span className="grid h-[48px] shrink-0 place-items-center rounded-xl border border-ink-light/30 bg-maroon-50 px-3.5 text-[15px] font-semibold text-maroon-700">+91</span>
                  <input
                    value={form.mobile}
                    onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))}
                    inputMode="numeric"
                    placeholder="10 digit number"
                    className={inputClass(Boolean(errors.mobile))}
                  />
                </div>
              </Field>
              <Field label="Email" error={errors.email} hint="Optional — order updates ke liye">
                <IconInput icon={<Mail size={16} strokeWidth={1.8} />} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} invalid={Boolean(errors.email)} maxLength={160} placeholder="name@example.com" />
              </Field>
            </div>
          </section>

          {/* Address */}
          <section className="card p-5">
            <SectionHeading icon={<MapPin size={17} />} title="Delivery Address" note="Address yahan bheja jayega" />
            <div className="space-y-4">
              <Field label="House / Street" error={errors.line1} required>
                <IconInput icon={<Home size={16} strokeWidth={1.8} />} value={form.line1} onChange={(e) => set('line1', e.target.value)} invalid={Boolean(errors.line1)} maxLength={160} placeholder="House no., street, building" />
              </Field>
              <Field label="Area / Landmark">
                <IconInput icon={<Landmark size={16} strokeWidth={1.8} />} value={form.line2} onChange={(e) => set('line2', e.target.value)} maxLength={160} placeholder="Area, landmark, kisi jaane-mane marke ke paas" />
              </Field>

              {/* Pincode first — verified pincode auto-fills city + state (README §72) */}
              <Field label="Pincode" error={errors.pincode} required>
                <div className="flex gap-2">
                  <IconInput
                    icon={<Navigation size={16} strokeWidth={1.8} />}
                    wrapClassName="flex-1 min-w-0"
                    value={form.pincode}
                    onChange={(e) => {
                      pincodeCheck.reset();
                      setForm((current) => ({
                        ...current,
                        pincode: e.target.value.replace(/\D/g, '').slice(0, 6),
                        city: '',
                        state: '',
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
                    invalid={Boolean(errors.pincode)}
                    placeholder="6 digit pincode"
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
                <p className="mt-1.5 text-[11px] text-ink-muted">6 digit likhte hi pincode check hoga, city aur state apne aap bharenge.</p>
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
                      : 'Pincode verify nahi hua. 6 digit pincode likhein.'}
                </p>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <Field label="City" error={errors.city} required>
                  <IconInput icon={<Building2 size={16} strokeWidth={1.8} />} value={form.city} onChange={(e) => set('city', e.target.value)} invalid={Boolean(errors.city)} maxLength={60} placeholder="City" />
                </Field>
                <Field label="State" error={errors.state} required>
                  <IconInput icon={<Map size={16} strokeWidth={1.8} />} value={form.state} onChange={(e) => set('state', e.target.value)} invalid={Boolean(errors.state)} maxLength={60} placeholder="State" />
                </Field>
              </div>
            </div>
          </section>

          {/* Payment method — cart aur Buy Now dono mein yahin chuna jaata hai */}
          <section className="card p-5">
            <SectionHeading icon={<CreditCard size={17} />} title="Payment Method" />
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
              {config?.razorpay.enabled && paymentMethod === 'RAZORPAY' ? (
                <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-leaf/20 bg-leaf/5 p-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-leaf/10 text-leaf">
                    <QrCode size={18} />
                  </span>
                  <span className="min-w-0 space-y-1">
                    <span className="block text-[13px] font-bold text-ink">UPI se payment — aise:</span>
                    <span className="block text-[12.5px] leading-snug text-ink-muted">
                      Desktop/laptop par Razorpay ek <b className="font-semibold text-ink">QR code</b> dikhayegi —
                      phone ke kisi bhi UPI app (GPay, PhonePe, Paytm) se scan karke pay karein. Mobile par UPI apps
                      seedha dikhte hain — bina QR scan kiye direct pay karein.
                    </span>
                  </span>
                </div>
              ) : (
                <p className="pt-1 text-[12px] leading-snug text-ink-muted">
                  UPI, Cards aur Netbanking — sab online payment mein milte hain.
                </p>
              )}
            </div>
          </section>

          {/* Order note */}
          <section className="card p-5">
            <SectionHeading icon={<MessageSquare size={17} />} title="Order Note" note="(optional)" />
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
            {buyKeys.length > 0 ? (
              <p className="mb-3 flex items-start gap-2 rounded-xl bg-marigold-50 px-3 py-2 text-[13px] font-medium text-marigold-800">
                <ShoppingBag size={15} className="mt-0.5 shrink-0" />
                Buy Now order: sirf yeh item order hoga — cart mein rakh kar faila hua baaki saman is order mein nahi jayega.
              </p>
            ) : null}

            {/* Coupon (README §49) — same behaviour as the cart page */}
            <div className="card mb-4 p-4">
              <label htmlFor="checkout-coupon" className="label flex items-center gap-1.5">
                <Tag size={15} />
                Coupon code
              </label>
              <div className="flex gap-2">
                <input
                  id="checkout-coupon"
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
                <p className="mt-2 flex items-center justify-between gap-2 text-[13px] font-semibold text-leaf">
                  <span className="flex items-center gap-1.5">
                    <Check size={15} />
                    {quote.amounts.couponCode} lag gaya
                  </span>
                  <button type="button" onClick={clearCoupon} className="flex items-center gap-1 text-[12px] font-medium text-ink-muted hover:text-alert">
                    <X size={13} />
                    Hatao
                  </button>
                </p>
              ) : null}
            </div>

            {available?.items.length ? (
              <div className="card mb-4 p-4">
                <label className="label flex items-center gap-1.5">
                  <Tag size={15} />
                  Aapke coupons
                </label>
                <p className="mt-0.5 text-xs text-ink-muted">Yeh coupons is order par abhi lag sakte hain.</p>
                <ul className="mt-3 space-y-2">
                  {available.items.map((coupon) => {
                    const applied = quote?.amounts.couponCode === coupon.code;
                    return (
                      <li key={coupon.code}>
                        <button
                          type="button"
                          onClick={() => {
                            setCouponInput(coupon.code);
                            setAppliedCoupon(coupon.code);
                          }}
                          className={`flex w-full items-center gap-2 rounded-xl border p-2.5 text-left transition ${
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

            <div className="card p-5">
              <button
                type="button"
                onClick={() => setItemsOpen((v) => !v)}
                aria-expanded={itemsOpen}
                className="mb-3 flex w-full items-center gap-2.5 text-left"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-maroon-50 text-maroon-600">
                  <Truck size={17} />
                </span>
                <span className="flex-1 font-display text-[17px] font-bold text-ink">Order Summary</span>
                <span className="text-[12px] font-semibold text-ink-muted">
                  {quote ? `${quote.lines.length} item${quote.lines.length > 1 ? 's' : ''}` : ''}
                </span>
                <ChevronDown size={16} className={`text-ink-muted transition-transform ${itemsOpen ? '' : '-rotate-90'}`} />
              </button>

              {itemsOpen ? (
                <ul className="mb-3 space-y-2 border-b border-maroon-100 pb-3">
                  {quote?.lines.map((line) => (
                    <li key={line.key} className="flex items-start justify-between gap-2 text-[13px]">
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
                      <span className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => removeLine(line.key)}
                          aria-label={`${line.name} order se hatayein`}
                          title="Order se hatayein"
                          className="grid h-7 w-7 place-items-center rounded-full text-ink-light transition hover:bg-alert/10 hover:text-alert"
                        >
                          <Trash2 size={14} />
                        </button>
                        <span className={line.lineTotalMinor === 0 ? 'font-black uppercase tracking-wide text-leaf' : 'font-semibold'}>
                          {line.lineTotalMinor === 0 ? 'FREE' : formatMoney(line.lineTotalMinor, currency)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

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

              {hasCustom ? (
                <div className="mt-4 rounded-xl border border-maroon-200/70 bg-maroon-50/70 p-4">
                  <p className="flex items-center gap-2 text-[13px] font-bold text-maroon-800">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[12px]">⚠️</span>
                    Customized Blouse – Important Note
                  </p>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-ink">
                    Please note: The displayed blouse is a design reference. Our artisans can create a replica with
                    approximately 80–95% similarity, depending on the design, fabric, embroidery, stitching details,
                    and availability of materials.
                  </p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink">
                    We always make our best effort to achieve the closest possible match to the shown design, but an
                    exact 100% replica cannot be guaranteed.
                  </p>
                  <p className="mt-2 text-[12.5px] font-medium text-maroon-700">
                    Thank you for your understanding and happy shopping! ❤️
                  </p>
                </div>
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
                      ? `Place Order • ${quote ? formatMoney(quote.amounts.totalMinor, currency) : ''}`
                      : `Pay ${quote ? formatMoney(quote.amounts.totalMinor, currency) : ''}`}
                </button>
              )}

              {paymentMethod === 'COD' && quote && quote.amounts.codAdvanceMinor > 0 ? (
                <p className="mt-2 text-center text-[11.5px] font-medium text-ink-muted">
                  {formatMoney(quote.amounts.codAdvanceMinor, currency)} advance abhi,
                  baaki {formatMoney(quote.amounts.codBalanceMinor, currency)} delivery par.
                </p>
              ) : null}

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
      <span className="mb-2 block text-sm font-semibold text-ink">
        {label}
        {required ? <span className="text-alert"> *</span> : null}
      </span>
      {children}
      {error ? <p className="mt-1.5 flex items-start gap-1 text-[13px] font-medium text-alert"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</p> : hint ? <p className="mt-1.5 text-[13px] leading-snug text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/** Shared input style — light-gray rounded box; red border + tint when invalid. */
function inputClass(invalid?: boolean): string {
  return [
    'min-h-[48px] w-full rounded-xl border bg-white text-[16px] text-ink transition',
    'placeholder:text-ink-light focus:outline-none',
    invalid
      ? 'border-alert bg-alert/5 focus:border-alert focus:ring-2 focus:ring-alert/20'
      : 'border-ink-light/30 focus:border-maroon-500 focus:ring-2 focus:ring-maroon-200',
  ].join(' ');
}

/** Rounded input with a simple outline icon on the left, matching the reference. */
function IconInput({ icon, invalid, className, wrapClassName, ...props }: { icon: React.ReactNode; invalid?: boolean; className?: string; wrapClassName?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={clsx('relative', wrapClassName ?? 'w-full')}>
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-light">{icon}</span>
      <input {...props} className={clsx(inputClass(invalid), 'pl-10', className)} />
    </div>
  );
}

/** Bold card-style section heading with a tinted icon box. */
function SectionHeading({ icon, title, note }: { icon: React.ReactNode; title: string; note?: string }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-maroon-50 text-maroon-600">{icon}</span>
      <h2 className="font-display text-[17px] font-bold text-ink">{title}</h2>
      {note ? <span className="ml-auto text-[12px] font-semibold text-ink-muted">{note}</span> : null}
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
