import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Check, Ruler, ArrowRight, BookmarkPlus, ZoomIn, ChevronDown, X, Sparkles, Info, ClipboardCheck, CircleHelp } from 'lucide-react';
import clsx from 'clsx';
import { SmartImage } from '../components/SmartImage';
import { EmptyState } from '../components/ui';
import {
  useCurrentUser,
  useMeasurementFields,
  useMeasurementProfiles,
  useSaveMeasurementProfile,
} from '../hooks/queries';
import { useCart } from '../store/cart';
import { useUi } from '../store/ui';
import { api, ApiError } from '../lib/api';
import { track } from '../lib/analytics';
import type { MeasurementFieldDef, MeasurementUnit } from '../lib/types';

/**
 * Measurement form (README §18–22, §74).
 *
 * One field per card, each with its own picture and a plain-Hinglish
 * explanation of where to hold the tape. Validation happens as you type *and*
 * again on the server, and nothing can be ordered until the customer has
 * ticked the confirmation.
 */

export function MeasurementPage() {
  const { cartKey } = useParams<{ cartKey: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useUi((state) => state.toast);

  const line = useCart((state) => state.lines.find((l) => l.key === cartKey));
  const setMeasurement = useCart((state) => state.setMeasurement);
  const setNote = useCart((state) => state.setNote);
  const startBuy = useCart((state) => state.startBuy);

  const { data: user } = useCurrentUser();
  const openLogin = useUi((state) => state.openLogin);

  const [unit, setUnit] = useState<MeasurementUnit>('inch');
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [note, setLocalNote] = useState(line?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [saveProfile, setSaveProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);

  const { data: fieldData, isLoading } = useMeasurementFields(unit);
  const { data: profiles } = useMeasurementProfiles(unit, Boolean(user));
  const saveProfileMutation = useSaveMeasurementProfile();

  useEffect(() => {
    track('MEASUREMENT_START', { productId: line?.productId ?? null });
  }, [line?.productId]);

  // Prefill from an existing measurement on this line, if there is one.
  useEffect(() => {
    if (!line?.measurement) return;
    setUnit(line.measurement.unit);
    setValues(Object.fromEntries(Object.entries(line.measurement.values).map(([k, v]) => [k, String(v)])));
    setConfirmed(line.measurement.confirmed);
  }, [line?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const fields = fieldData?.fields ?? [];

  const filledCount = useMemo(
    () => fields.filter((field) => values[field.key] && !errors[field.key]).length,
    [fields, values, errors],
  );

  const requiredMissing = fields.filter((field) => field.required && !values[field.key]).length;
  const canContinue = requiredMissing === 0 && Object.keys(errors).length === 0 && confirmed;

  if (!line) {
    return (
      <EmptyState
        icon={<Ruler size={30} />}
        title="Yeh item cart mein nahi hai"
        message="Pehle koi design choose karein aur fabric select karein."
        action={
          <Link to="/customize" className="btn-primary">
            Customize designs dekhein
          </Link>
        }
      />
    );
  }

  /** Validates one field against the admin-configured range for this unit. */
  const validateField = (key: string, raw: string) => {
    const field = fields.find((f) => f.key === key);
    if (!field) return;

    setErrors((current) => {
      const next = { ...current };
      const numeric = Number(raw);

      if (!raw) {
        if (field.required) next[key] = `${field.label} bharna zaroori hai.`;
        else delete next[key];
      } else if (!Number.isFinite(numeric) || numeric <= 0) {
        next[key] = 'Sirf number likhein, jaise 34';
      } else if (numeric < field.min || numeric > field.max) {
        next[key] = `${field.min} se ${field.max} ${unit} ke beech hona chahiye.`;
      } else {
        delete next[key];
      }
      return next;
    });
  };

  const applyProfile = (profileValues: Record<string, number>) => {
    setValues(Object.fromEntries(Object.entries(profileValues).map(([k, v]) => [k, String(v)])));
    setErrors({});
    toast('Saved measurement bhar diya', 'success');
  };

  const onContinue = async () => {
    setSaving(true);
    const numericValues = Object.fromEntries(
      Object.entries(values)
        .filter(([, value]) => value !== '')
        .map(([key, value]) => [key, Number(value)]),
    );

    try {
      // The browser already validated; this is the authoritative check.
      const result = await api<{ ok: boolean; errors: Record<string, string> }>('/measurements/validate', {
        method: 'POST',
        body: { measurement: { unit, values: numericValues, confirmed: true } },
      });

      if (!result.ok) {
        setErrors(result.errors);
        toast('Kuch measurement sahi nahi hai', 'error');
        return;
      }

      setMeasurement(line.key, { unit, values: numericValues, confirmed: true });
      if (note !== line.note) setNote(line.key, note);

      if (saveProfile && user) {
        await saveProfileMutation
          .mutateAsync({
            name: profileName.trim() || 'Default Profile',
            unit,
            values: numericValues,
            isDefault: true,
          })
          .catch(() => toast('Measurement save nahi hua, lekin order chal sakta hai', 'info'));
      }

      // Fabric-choose flows jump straight into a single-product checkout; a
      // measurement opened from the cart keeps the whole-cart flow (README §17).
      const buyNow = (location.state as { buyNow?: boolean } | null)?.buyNow === true;
      if (buyNow) {
        startBuy(line.key);
        navigate('/checkout');
      } else {
        navigate('/cart');
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Kuch problem aa gayi.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-3 pt-4 sm:px-5">
      {/* Step indicator (README §17) */}
      <ol className="mb-5 flex items-center gap-1.5 text-[12px] font-semibold">
        {['Design', 'Fabric', 'Measurement', 'Order'].map((step, index) => (
          <li key={step} className="flex flex-1 items-center gap-1.5">
            <span
              className={clsx(
                'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px]',
                index <= 2 ? 'bg-maroon-600 text-white' : 'bg-maroon-100 text-maroon-500',
              )}
            >
              {index < 2 ? <Check size={13} strokeWidth={3} /> : index + 1}
            </span>
            <span className={clsx('truncate', index === 2 ? 'text-maroon-700' : 'text-ink-muted')}>{step}</span>
          </li>
        ))}
      </ol>

      <header className="mb-4 rounded-[26px] border border-maroon-200 bg-gradient-to-br from-maroon-700 via-maroon-600 to-[#6b1226] p-4 text-white shadow-[0_18px_38px_rgba(123,30,59,0.18)]">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/12 ring-1 ring-white/20">
            <Ruler size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-maroon-100">Step 3 of 4</p>
            <h1 className="mt-1 font-display text-[28px] font-bold leading-tight">Apna Measurement Dein</h1>
            <p className="mt-1 text-sm text-maroon-50">
              {line.snapshot.name}
              {line.snapshot.fabricName ? ` • ${line.snapshot.fabricName}` : ''}
              {line.snapshot.laceName ? ` • ${line.snapshot.laceName}` : ''}
              {line.snapshot.latkanName ? ` • ${line.snapshot.latkanName}` : ''}
            </p>
          </div>
        </div>
      </header>

      <div className="mb-4 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-maroon-100 bg-white p-3.5 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-marigold-100 text-marigold-700">
                <Sparkles size={16} />
              </span>
              <h2 className="text-[15px] font-bold text-ink">Progress</h2>
            </div>
            <span className="rounded-full bg-maroon-50 px-2.5 py-1 text-[11px] font-bold text-maroon-700">{filledCount}/{fields.length} filled</span>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-maroon-50">
            <div className="h-full rounded-full bg-gradient-to-r from-maroon-600 to-marigold-500 transition-all" style={{ width: `${fields.length ? (filledCount / fields.length) * 100 : 0}%` }} />
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            {requiredMissing > 0 ? `${requiredMissing} required fields left` : 'All required measurements are ready'}
          </p>
        </div>

        <div className="rounded-2xl border border-maroon-100 bg-maroon-50 p-3.5 shadow-card">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white text-maroon-600">
              <Info size={16} />
            </span>
            <h2 className="text-[15px] font-bold text-ink">Need help?</h2>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            Har field ke saamne reference image aur instructions hain. Agar confused ho, image ko bada karke dekh lo.
          </p>
        </div>
      </div>

      {/* Unit toggle (README §21) */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-ink-muted">Unit:</span>
          <div className="inline-flex rounded-xl border border-ink-light/25 bg-white p-1">
            {(['inch', 'cm'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  // Values are re-entered rather than auto-converted: converting a
                  // half-finished form silently changes numbers under the user.
                  if (option !== unit && Object.keys(values).length > 0) {
                    setValues({});
                    setErrors({});
                  }
                  setUnit(option);
                }}
                className={clsx(
                  'min-h-[36px] rounded-lg px-4 text-sm font-bold transition',
                  unit === option ? 'bg-maroon-600 text-white shadow-sm' : 'text-ink-muted hover:bg-maroon-50',
                )}
              >
                {option === 'inch' ? 'Inch' : 'CM'}
              </button>
            ))}
          </div>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-maroon-100 bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-muted">
          <ClipboardCheck size={14} className="text-maroon-600" />
          Darzi tape use karein
        </div>
      </div>

      {/* Saved profiles (README §23) */}
      {user && profiles && profiles.length > 0 ? (
        <section className="mb-4 rounded-xl2 bg-marigold-50 p-3.5">
          <h2 className="mb-1 flex items-center gap-1.5 text-[14px] font-bold text-ink">
            <BookmarkPlus size={15} className="shrink-0 text-marigold-700" />
            Aapke saved measurements
          </h2>
          <p className="hint mb-2">Kisi par tap karein — measurement apne aap bhar jayega.</p>
          <div className="flex flex-wrap gap-2">
            {profiles.map((profile) => (
              <button key={profile.id} type="button" onClick={() => applyProfile(profile.values)} className="chip">
                {profile.name}
                {profile.isDefault ? ' ★' : ''}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton h-32 rounded-xl2" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {fields.map((field) => (
            <FieldCard
              key={field.key}
              field={field}
              value={values[field.key] ?? ''}
              error={errors[field.key]}
              unit={unit}
              onChange={(raw) => {
                setValues((current) => ({ ...current, [field.key]: raw }));
                validateField(field.key, raw);
              }}
              onZoom={() =>
                setZoom({
                  src: field.gifUrl || field.imageUrl,
                  alt: `${field.label} kaise measure karein`,
                })
              }
            />
          ))}
        </div>
      )}

      {/* Order note (README §73) */}
      <div className="mt-4">
        <label htmlFor="order-note" className="label">
          Koi special baat? <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <textarea
          id="order-note"
          value={note}
          maxLength={300}
          rows={2}
          onChange={(event) => setLocalNote(event.target.value)}
          placeholder="Jaise: blouse thoda lamba rakhna"
          className="field py-3"
        />
      </div>

      {/* Save for later (README §23) */}
      <div className="mt-4 overflow-hidden rounded-xl2 bg-white shadow-card">
        {user ? (
          <>
            <label className="flex cursor-pointer items-center gap-3 p-3.5">
              <input
                type="checkbox"
                checked={saveProfile}
                onChange={(event) => setSaveProfile(event.target.checked)}
                className="h-5 w-5 shrink-0 accent-maroon-600"
              />
              <span className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                <BookmarkPlus size={17} className="shrink-0 text-maroon-700" />
                Measurement save karein
              </span>
            </label>
            {saveProfile ? (
              <div className="border-t border-maroon-100 px-3.5 pb-3.5 pt-3">
                <label htmlFor="profile-name" className="label">
                  Kiska measurement hai? <span className="font-normal text-ink-muted">(naam daalein)</span>
                </label>
                <input
                  id="profile-name"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  maxLength={40}
                  placeholder="Jaise: Sunita, Didi, Mummy…"
                  className="field py-2.5"
                />
                <p className="hint mt-1">Naam nahi likha to "Default Profile" ke naam se save hoga.</p>
              </div>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            onClick={() => openLogin(window.location.pathname)}
            className="flex w-full items-center gap-3 p-3.5 text-left"
          >
            <span className="font-semibold text-maroon-700">Login karein</span>
            <span className="text-ink-muted">— measurement save ho jayega, agli baar dobara nahi bharna padega.</span>
          </button>
        )}
      </div>

      {/* Confirmation (README §74) */}
      <div className="mt-4 rounded-2xl border border-marigold-300 bg-gradient-to-br from-marigold-50 to-white p-4 shadow-card">
        <div className="mb-2 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-marigold-200 text-marigold-700">
            <CircleHelp size={15} />
          </span>
          <h2 className="font-display text-base font-bold text-ink">Measurement confirm karein</h2>
        </div>
        <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[14px] sm:grid-cols-3">
          {fields
            .filter((field) => values[field.key])
            .map((field) => (
              <div key={field.key} className="rounded-xl border border-marigold-200 bg-white/80 px-2.5 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{field.label}</dt>
                <dd className="mt-1 font-bold text-ink">
                  {values[field.key]}
                  {unit === 'inch' ? '"' : 'cm'}
                </dd>
              </div>
            ))}
        </dl>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-marigold-200 bg-white/60 p-2.5">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-maroon-600"
          />
          <span className="text-[14px] font-semibold text-ink">
            Maine apna measurement check kar liya hai aur yeh sahi hai.
          </span>
        </label>
      </div>

      {/* Image zoom (field image par click) */}
      {zoom ? (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-ink/85 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${zoom.alt} — badi image`}
          onClick={() => setZoom(null)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white p-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="overflow-hidden rounded-xl bg-maroon-50">
              <img
                src={zoom.src}
                alt={zoom.alt}
                className="mx-auto max-h-[72vh] max-w-full object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 px-1">
              <p className="min-w-0 truncate text-sm font-bold text-ink">{zoom.alt}</p>
              <button
                type="button"
                onClick={() => setZoom(null)}
                aria-label="Band karein"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-maroon-50 text-maroon-700 transition active:scale-90"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Sticky continue */}
      <div
        className="fixed inset-x-0 z-30 border-t border-maroon-100 bg-white/97 px-3 py-2.5 shadow-sheet backdrop-blur"
        style={{ bottom: 'calc(var(--bottomnav-h) + var(--safe-bottom))' }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-ink">
              {filledCount}/{fields.length} bhare
            </p>
            <p className="hint truncate">
              {!confirmed
                ? 'Confirm wala box tick karein'
                : requiredMissing > 0
                  ? `${requiredMissing} zaroori field baaki hain`
                  : 'Sab tayyar hai'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onContinue()}
            disabled={!canContinue || saving}
            className="btn-primary btn-lg shrink-0 px-6"
          >
            {saving ? 'Save…' : 'Aage Badhein'}
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
      <div className="h-20" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Field card — image (tap to zoom) + collapsed instruction + highlighted range */
/* -------------------------------------------------------------------------- */

function FieldCard({
  field,
  value,
  error,
  unit,
  onChange,
  onZoom,
}: {
  field: MeasurementFieldDef;
  value: string;
  error: string | undefined;
  unit: MeasurementUnit;
  onChange: (raw: string) => void;
  onZoom: () => void;
}) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);

  // Only show "View more" when the instruction actually overflows two lines.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const measure = () => setOverflow(el.scrollHeight > el.clientHeight + 1);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const hasMedia = Boolean(field.gifUrl || field.imageUrl);

  return (
    <div className="overflow-hidden rounded-2xl border border-maroon-100 bg-white shadow-card transition hover:shadow-[0_12px_28px_rgba(123,30,59,0.08)]">
      <div className="flex gap-3 p-3.5">
        {hasMedia ? (
          <button
            type="button"
            onClick={onZoom}
            aria-label={`${field.label} kaise measure karein — badha kar dekhein`}
            title="Badha kar dekhein"
            className="group relative h-24 w-20 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-maroon-50 to-maroon-100 ring-1 ring-maroon-100"
          >
            <SmartImage src={field.gifUrl || field.imageUrl} alt={`${field.label} kaise measure karein`} sizes="80px" />
            <span className="absolute inset-0 grid place-items-center rounded-2xl bg-ink/0 text-white opacity-0 transition group-hover:bg-ink/25 group-hover:opacity-100">
              <ZoomIn size={22} />
            </span>
            <span className="absolute bottom-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-maroon-700 shadow-sm">
              <ZoomIn size={13} />
            </span>
          </button>
        ) : (
          <div className="grid h-24 w-20 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-maroon-50 to-maroon-100 text-maroon-300 ring-1 ring-maroon-100">
            <Ruler size={26} />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <label htmlFor={`m-${field.key}`} className="block text-[15px] font-bold text-ink">
              {field.label}
              {field.required ? <span className="text-alert"> *</span> : null}
            </label>
            <span
              title={`${field.min} se ${field.max} ${unit} tak sahih hai`}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-marigold-300 bg-marigold-100 px-2.5 py-1 text-[10px] font-bold text-marigold-700"
            >
              <Ruler size={11} />
              {field.min}–{field.max}
            </span>
          </div>
          {field.labelHi ? <p className="mt-0.5 text-[12.5px] font-medium text-maroon-700">{field.labelHi}</p> : null}

          {field.instruction ? (
            <div className="mt-2 rounded-xl bg-maroon-50/80 px-2.5 py-2 ring-1 ring-maroon-100">
              <p ref={textRef} className={clsx('text-[12.5px] leading-snug text-ink/80', !expanded && 'line-clamp-2')}>
                {field.instruction}
              </p>
              {overflow ? (
                <button
                  type="button"
                  onClick={() => setExpanded((open) => !open)}
                  className="mt-1 flex items-center gap-1 text-[12px] font-bold text-maroon-700"
                >
                  {expanded ? 'Kam dekhein' : 'View more'}
                  <ChevronDown size={14} className={clsx('transition-transform', expanded && 'rotate-180')} />
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex items-center gap-2">
            <div className="relative w-28">
              <input
                id={`m-${field.key}`}
                type="number"
                inputMode="decimal"
                step="0.5"
                min={field.min}
                max={field.max}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={String(Math.round((field.min + field.max) / 2))}
                className={clsx('field w-full !pr-10 text-center text-lg font-bold', error && 'border-alert')}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `err-${field.key}` : undefined}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12px] font-bold text-ink-muted">
                {unit}
              </span>
            </div>
          </div>

          {error ? (
            <p id={`err-${field.key}`} className="mt-1.5 text-[13px] font-medium text-alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
