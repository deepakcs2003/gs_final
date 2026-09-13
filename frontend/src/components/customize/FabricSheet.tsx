import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AlertTriangle, Check, X, SlidersHorizontal } from 'lucide-react';
import { Sheet } from '../ui';
import { SmartImage } from '../SmartImage';
import { useFabrics, useLaces, useLatkans, useConfig } from '../../hooks/queries';
import { moneyLabel, type Currency } from '../../lib/format';
import type { Fabric, Lace, Latkan, ProductCard } from '../../lib/types';

type Lang = 'hi' | 'en';

/** Simple inline translator — hi = the existing Hinglish copy, en = plain English. */
function tr(lang: Lang, hi: string, en: string): string {
  return lang === 'hi' ? hi : en;
}

const LANG_OPTIONS: Array<{ value: Lang; label: string }> = [
  { value: 'hi', label: 'हिंदी' },
  { value: 'en', label: 'English' },
];

/**
 * Fabric + lace + latkan picker (README §14–16).
 *
 * Opens instead of going straight to the cart, because a customised blouse
 * cannot be priced until the fabric is chosen. Selection is visual — swatches,
 * not a dropdown of names — which is what §15 asks for.
 */

/**
 * A chosen colour for one selected lace/latkan. The id must match a selection,
 * and the colour is folded into the quote / order display names server-side.
 */
export interface AccessoryPick {
  id: string;
  name: string;
  colorName: string;
  colorHex: string;
}

export type AccessoryColor = Pick<AccessoryPick, 'colorName' | 'colorHex'>;

/** How an item's colour is decided: match the fabric, or an exact pick. */
type ColorChoice = { mode: 'fabric' } | { mode: 'pick'; color: AccessoryColor };

interface FabricSheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * The admin-picked material options for this blouse. Laces/latkans are
   * limited to these when configured (READY_MADE/product-id restricted set
   * comes server-side via /fabrics?productId, see §14).
   */
  product: ProductCard & { laceOptionIds?: string[]; latkanOptionIds?: string[]; fabricOptionIds?: string[]; minFabricCount?: number; maxFabricCount?: number; minLaceCount?: number; maxLaceCount?: number; minLatkanCount?: number; maxLatkanCount?: number };
  currency: Currency;
  onConfirm: (selection: { fabrics: Fabric[]; laces: AccessoryPick[]; latkans: AccessoryPick[] }) => void;
}

const PRICE_BUCKETS = [
  { label: 'Under ₹399', value: 399 },
  { label: 'Under ₹499', value: 499 },
  { label: 'Under ₹699', value: 699 },
];

export function FabricSheet({ open, onClose, product, currency, onConfirm }: FabricSheetProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [warning, setWarning] = useState('');
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem('gs_lang') === 'en' ? 'en' : 'hi';
    } catch {
      return 'hi';
    }
  });
  const changeLang = (next: Lang) => {
    setLang(next);
    try {
      localStorage.setItem('gs_lang', next);
    } catch {
      /* private mode — ignore */
    }
  };
  const t = (hi: string, en: string) => tr(lang, hi, en);
  const [colors, setColors] = useState<string[]>([]);
  const [materials, setMaterials] = useState<string[]>([]);
  const [embroidery, setEmbroidery] = useState<string[]>([]);
  const [maxPriceInr, setMaxPriceInr] = useState<number | undefined>();

  const [fabricIds, setFabricIds] = useState<string[]>([]);
  const [laceIds, setLaceIds] = useState<string[]>([]);
  const [latkanIds, setLatkanIds] = useState<string[]>([]);
  /** Colour choice per selected lace/latkan, keyed by item id. */
  const [laceColors, setLaceColors] = useState<Record<string, ColorChoice>>({});
  const [latkanColors, setLatkanColors] = useState<Record<string, ColorChoice>>({});
  /** Small popup asking the buyer to pick a colour — opens right on card tap. */
  const [colorSheetFor, setColorSheetFor] = useState<{ kind: 'lace' | 'latkan'; itemId: string } | null>(null);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);

  const { data, isLoading } = useFabrics(
    { colors, materials, embroidery, maxPriceInr, productId: product.id },
    open,
  );
  const { data: laces } = useLaces(open);
  const { data: latkans } = useLatkans(open);
  const { data: config } = useConfig();

  // Admin toggles — off = no colour popup, the exact item is added as-is.
  const lacePickerHidden = config ? !config.laceColorPickerEnabled : true;
  const latkanPickerHidden = config ? !config.latkanColorPickerEnabled : true;

  const fabrics = data?.items ?? [];
  const facets = data?.facets;
  const selectedFabrics = fabrics.filter((f) => fabricIds.includes(f.id));
  const selectedFabric = selectedFabrics[0];

  const activeFilterCount = colors.length + materials.length + embroidery.length + (maxPriceInr ? 1 : 0);

  /**
   * Only the laces/latkans the admin attached to this blouse are selectable
   * ("Add Material", §14.1). Unconfigured blouses keep showing everything so
   * older products don't silently lose their trims.
   */
  const productLaceIds = product.laceOptionIds ?? [];
  const productLatkanIds = product.latkanOptionIds ?? [];
  const availableLaces = useMemo(
    () => (laces ?? []).filter((l) => productLaceIds.length === 0 || productLaceIds.includes(l.id)),
    [laces, productLaceIds],
  );
  const availableLatkans = useMemo(
    () => (latkans ?? []).filter((l) => productLatkanIds.length === 0 || productLatkanIds.includes(l.id)),
    [latkans, productLatkanIds],
  );

  /**
   * Lace/latkan steps are skipped entirely when the admin set that option count
   * to 0 or nothing is available — the buyer never taps through an empty step.
   */
  const productMaxLaceCount = product.maxLaceCount ?? 1;
  const productMaxLatkanCount = product.maxLatkanCount ?? 1;
  const laceStepOn = productMaxLaceCount > 0 && availableLaces.length > 0;
  const latkanStepOn = productMaxLatkanCount > 0 && availableLatkans.length > 0;
  const minFabricRequired = product.minFabricCount ?? 1;
  const minLaceRequired = product.minLaceCount ?? 0;
  const minLatkanRequired = product.minLatkanCount ?? 0;
  type StepKind = 'fabric' | 'lace' | 'latkan';
  const stepOrder = useMemo<StepKind[]>(
    () => ['fabric' as const, ...(laceStepOn ? ['lace' as const] : []), ...(latkanStepOn ? ['latkan' as const] : [])],
    [laceStepOn, latkanStepOn],
  );
  const step = stepOrder[Math.min(stepIndex, stepOrder.length - 1)] ?? 'fabric';
  const isLastStep = stepIndex >= stepOrder.length - 1;

  // Clamp so a step removed after data loads (e.g. laces turn empty) can't
  // strand the buyer on an index that no longer exists.
  useEffect(() => {
    if (stepIndex >= stepOrder.length) setStepIndex(stepOrder.length - 1);
  }, [stepIndex, stepOrder.length]);

  const toggle = (list: string[], setList: (next: string[]) => void, value: string) => {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const toggleFabric = (fabric: Fabric) => {
    if (fabricIds.includes(fabric.id)) {
      setFabricIds(fabricIds.filter((id) => id !== fabric.id));
    } else if (fabric.inStock) {
      const limit = product.maxFabricCount ?? 1;
      if (fabricIds.length >= limit) {
        setWarning(t(`Aapne maximum ${limit} fabric select kar diye hain.`, `You can select up to ${limit} fabrics.`));
        return;
      }
      setWarning('');
      setFabricIds([...fabricIds, fabric.id]);
    }
  };

  const fabricColor: AccessoryColor | null = selectedFabric
    ? { colorName: selectedFabric.colorName || selectedFabric.name, colorHex: selectedFabric.colorHex }
    : null;

  /** Resolve an item's colour: fabric mode follows the chosen fabric (or its
   *  default colour), pick mode is exact, and an untouched preselected item
   *  behaves like fabric mode. When the picker is hidden the exact item colour
   *  is always used — no fabric matching, no popup. */
  const resolveColor = (item: Lace | Latkan, map: Record<string, ColorChoice>, hidden = false) => {
    if (hidden) {
      const exact: AccessoryColor = { colorName: item.colorName || item.name, colorHex: item.colorHex || '#cccccc' };
      return { color: exact, label: exact.colorName };
    }
    const entry = map[item.id];
    if (entry?.mode === 'pick' && entry.color) {
      return { color: entry.color, label: entry.color.colorName };
    }
    if (fabricColor) {
      return { color: fabricColor, label: `Fabric jaisa (${fabricColor.colorName})` };
    }
    const fallback: AccessoryColor = { colorName: item.colorName || item.name, colorHex: item.colorHex || '#cccccc' };
    return { color: fallback, label: fallback.colorName };
  };

  const resolvePicks = (items: Array<Lace | Latkan>, map: Record<string, ColorChoice>, ids: string[], hidden: boolean): AccessoryPick[] =>
    items
      .filter((item) => ids.includes(item.id))
      .map((item) => ({ id: item.id, name: item.name, ...resolveColor(item, map, hidden).color }));

  const toggleSelection = (
    kind: 'lace' | 'latkan',
    itemId: string,
    currentlySelected: boolean,
    list: string[],
    setList: (next: string[]) => void,
    setMap: (fn: (prev: Record<string, ColorChoice>) => Record<string, ColorChoice>) => void,
  ) => {
    if (currentlySelected) {
      setList(list.filter((id) => id !== itemId));
      setMap((prev) => {
        const { [itemId]: _removed, ...rest } = prev;
        return rest;
      });
      setColorSheetFor((prev) => (prev?.itemId === itemId ? null : prev));
    } else {
      const limit = kind === 'lace' ? (product.maxLaceCount ?? 1) : (product.maxLatkanCount ?? 1);
      if (list.length >= limit) {
        setWarning(
          kind === 'lace'
            ? t(`Aapne maximum ${limit} lace select kar diye hain.`, `You can select up to ${limit} laces.`)
            : t(`Aapne maximum ${limit} latkan select kar diye hain.`, `You can select up to ${limit} latkans.`),
        );
        return;
      }
      setWarning('');
      setList([...list, itemId]);
      // New taps default to "same colour as fabric".
      setMap((prev) => ({ ...prev, [itemId]: { mode: 'fabric' } }));
      // Colour popup only when the admin toggle for this accessory is ON.
      const hidden = kind === 'lace' ? lacePickerHidden : latkanPickerHidden;
      if (!hidden) setColorSheetFor({ kind, itemId });
    }
  };

  const totalMinor =
    selectedFabrics.reduce((sum, fabric) => sum + fabric.priceMinor, 0) +
    (laces ?? []).filter((l) => laceIds.includes(l.id)).reduce((sum, l) => sum + l.priceMinor, 0) +
    (latkans ?? []).filter((l) => latkanIds.includes(l.id)).reduce((sum, l) => sum + l.priceMinor, 0);

  /** The item whose popup is currently open, if any. */
  const colorSheetItem =
    colorSheetFor === null
      ? null
      : colorSheetFor.kind === 'lace'
        ? (laces ?? []).find((l) => l.id === colorSheetFor.itemId) ?? null
        : (latkans ?? []).find((l) => l.id === colorSheetFor.itemId) ?? null;
  const colorSheetMap = colorSheetFor?.kind === 'latkan' ? latkanColors : laceColors;
  const setColorSheetMap = colorSheetFor?.kind === 'latkan' ? setLatkanColors : setLaceColors;

  const renderChosenStrip = (
    items: Array<Lace | Latkan>,
    map: Record<string, ColorChoice>,
    ids: string[],
    kind: 'lace' | 'latkan',
  ) => {
    const chosen = items.filter((item) => ids.includes(item.id));
    if (chosen.length === 0) return null;
    return (
      <div className="mt-2.5 rounded-xl bg-maroon-50/50 p-2.5">
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-muted">
          {t(
            `Chune hue ${kind === 'lace' ? 'laces' : 'latkans'} ke colours — badalne ke liye "Change" dabayen`,
            `Your chosen ${kind === 'lace' ? 'laces' : 'latkans'} colours — tap "Change" to modify`,
          )}
        </p>
        <div className="space-y-1.5">
          {chosen.map((item) => {
            const { color, label } = resolveColor(item, map);
            return (
              <div key={item.id} className="flex items-center gap-2.5 rounded-lg bg-white px-2.5 py-2">
                <span className="h-5 w-5 shrink-0 rounded-full border-2 border-white shadow" style={{ backgroundColor: color.colorHex }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-ink">{item.name}</p>
                  <p className="truncate text-[11px] text-ink-muted">Colour: {label}</p>
                </div>
                <button
                  type="button"
                  className="btn-outline min-h-8 shrink-0 px-2.5 text-[11px]"
                  onClick={() => setColorSheetFor({ kind, itemId: item.id })}
                >
                  Change
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('Fabric Choose Karein', 'Choose Your Fabric')}
      subtitle={t('Fabric, lace aur latkan alag-alag steps mein select karein', 'Pick fabric, lace and latkans step by step')}
      maxWidth="sm:max-w-2xl"
      footer={
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            {selectedFabric ? (
              <>
                <p className="truncate text-sm font-semibold text-ink">
                  {selectedFabric.colorName} {selectedFabric.name}
                </p>
                <p className="hint">+ {moneyLabel(totalMinor, currency)} fabric &amp; lace &amp; latkan</p>
              </>
            ) : (
              <p className="hint">{t('Pehle ek fabric select karein', 'Select a fabric first')}</p>
            )}
          </div>
          {stepIndex > 0 ? (
            <button
              type="button"
              className="btn-outline shrink-0"
              onClick={() => {
                setWarning('');
                setStepIndex(Math.max(0, stepIndex - 1));
              }}
            >
              {t('Back', 'Back')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn-primary btn-lg shrink-0 px-7"
            disabled={step === 'fabric' && selectedFabrics.length < minFabricRequired}
            onClick={() => {
              setWarning('');
              if (step === 'fabric' && selectedFabrics.length < minFabricRequired) {
                setWarning(t('Pehle minimum fabric select karein.', 'Please choose the minimum required fabric first.'));
                return;
              }
              if (step === 'lace' && laceStepOn && laceIds.length < minLaceRequired) {
                setWarning(t('Lace ka minimum count complete nahi hai.', 'Please select the minimum required lace count.'));
                return;
              }
              if (step === 'latkan' && latkanStepOn && latkanIds.length < minLatkanRequired) {
                setWarning(t('Latkan ka minimum count complete nahi hai.', 'Please select the minimum required latkan count.'));
                return;
              }
              if (!isLastStep) {
                setStepIndex(stepIndex + 1);
                return;
              }
              if (!selectedFabric) return;
              onConfirm({
                fabrics: selectedFabrics,
                laces: resolvePicks(laces ?? [], laceColors, laceIds, lacePickerHidden),
                latkans: resolvePicks(latkans ?? [], latkanColors, latkanIds, latkanPickerHidden),
              });
            }}
          >
            {isLastStep ? t('Done', 'Done') : t('Next', 'Next')}
          </button>
        </div>
      }
    >
      <div className="sticky top-0 z-10 -mx-5 mb-4 border-b border-maroon-100 bg-white px-5 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">
            {t('Apna blouse banane ke steps', 'Steps to build your blouse')}
          </p>
          <div
            className="flex items-center gap-1 rounded-lg border border-maroon-100 p-0.5"
            role="group"
            aria-label={t('Bhasha chunein', 'Choose language')}
          >
            {LANG_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => changeLang(option.value)}
                className={clsx(
                  'rounded-md px-2.5 py-1 text-[12px] font-bold transition',
                  lang === option.value ? 'bg-maroon-700 text-white' : 'text-ink-muted hover:text-ink',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${stepOrder.length}, minmax(0, 1fr))` }}>
          {stepOrder.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (index <= stepIndex || (index === 1 && selectedFabric)) {
                  setWarning('');
                  setStepIndex(index);
                }
              }}
              className={clsx(
                'rounded-lg px-2 py-2 text-center text-[12px] font-bold',
                step === label ? 'bg-maroon-700 text-white' : index < stepIndex ? 'bg-leaf/15 text-leaf' : 'bg-maroon-50 text-ink-muted',
              )}
            >
              <span className="mr-1">{index < stepIndex ? '✓' : index + 1}</span>
              {label === 'fabric' ? t('Fabric', 'Fabric') : label === 'lace' ? t('Laces', 'Laces') : t('Latkans', 'Latkans')}
            </button>
          ))}
        </div>
        {warning ? <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-alert"><AlertTriangle size={14} />{warning}</p> : null}
      </div>
      <div className="space-y-5 py-1">
        {step === 'fabric' ? <>
        {/* Filters (README §15) */}
        <div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={clsx('chip', activeFilterCount > 0 && 'chip-active')}
          >
            <SlidersHorizontal size={15} />
            Filter
            {activeFilterCount > 0 ? <span className="font-bold">({activeFilterCount})</span> : null}
          </button>

          {showFilters && facets ? (
            <div className="mt-3 space-y-4 rounded-xl2 bg-maroon-50/50 p-3.5">
              <FacetRow
                label="Color"
                options={facets.colors.map((c) => ({ value: c.slug, label: c.name, hex: c.hex }))}
                selected={colors}
                onToggle={(value) => toggle(colors, setColors, value)}
              />
              <FacetRow
                label="Fabric"
                options={facets.materials.map((m) => ({ value: m.toLowerCase().replace(/\s+/g, '-'), label: m }))}
                selected={materials}
                onToggle={(value) => toggle(materials, setMaterials, value)}
              />
              <FacetRow
                label="Embroidery"
                options={facets.embroidery.map((e) => ({ value: e.toLowerCase().replace(/\s+/g, '-'), label: e }))}
                selected={embroidery}
                onToggle={(value) => toggle(embroidery, setEmbroidery, value)}
              />
              <div>
                <p className="mb-1.5 text-[13px] font-bold uppercase tracking-wide text-ink-muted">Price</p>
                <div className="flex flex-wrap gap-2">
                  {PRICE_BUCKETS.map((bucket) => (
                    <button
                      key={bucket.value}
                      type="button"
                      onClick={() => setMaxPriceInr(maxPriceInr === bucket.value ? undefined : bucket.value)}
                      className={clsx('chip', maxPriceInr === bucket.value && 'chip-active')}
                    >
                      {bucket.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Fabrics (available for this blouse) */}
        {!isLoading && fabrics.length > 0 ? <h3 className="label">Fabrics ({selectedFabrics.length}/{product.minFabricCount ?? 1}-{product.maxFabricCount ?? 1})</h3> : null}
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="skeleton aspect-[4/5] rounded-xl2" />
            ))}
          </div>
        ) : fabrics.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">
            {t('Is filter mein koi fabric nahi mila. Filter hata kar dekhein.', 'No fabric matches this filter. Try removing a filter.')}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {fabrics.map((fabric) => {
              const isSelected = fabricIds.includes(fabric.id);
              const altText = `${fabric.colorName} ${fabric.name}`;
              return (
                <div
                  key={fabric.id}
                  role="button"
                  tabIndex={fabric.inStock ? 0 : -1}
                  aria-label={`Select ${altText}`}
                  onClick={() => fabric.inStock && toggleFabric(fabric)}
                  onKeyDown={(event) => {
                    if (!fabric.inStock) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleFabric(fabric);
                    }
                  }}
                  className={clsx(
                    'group relative overflow-hidden rounded-xl2 border-2 bg-white text-left transition outline-none',
                    isSelected ? 'border-maroon-600 shadow-lift' : 'border-transparent shadow-card',
                    !fabric.inStock && 'opacity-55',
                    fabric.inStock && 'cursor-pointer focus-visible:ring-2 focus-visible:ring-maroon-400',
                  )}
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden">
                    <SmartImage src={fabric.image} alt={altText} sizes="190px" />
                    {isSelected ? (
                      <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-maroon-600 text-white shadow-lift">
                        <Check size={16} strokeWidth={3} />
                      </span>
                    ) : null}
                    {!fabric.inStock ? (
                      <span className="absolute inset-x-0 bottom-0 bg-ink/80 py-1 text-center text-[11px] font-bold text-white">
                        Out of Stock
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setPreviewImage({ src: fabric.image, alt: altText });
                      }}
                      className="absolute bottom-2 right-2 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-ink shadow-card transition hover:bg-white"
                    >
                      View
                    </button>
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-[13px] font-semibold text-ink">
                      {fabric.colorName} {fabric.name}
                    </p>
                    <p className={fabric.priceMinor === 0 ? 'text-[13px] font-black uppercase tracking-wide text-leaf' : 'text-[13px] font-bold text-maroon-700'}>
                      {moneyLabel(fabric.priceMinor, currency)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </> : null}

        {/* Laces */}
        {step === 'lace' && availableLaces.length > 0 ? (
          <section>
            <h3 className="label">
              Laces ({availableLaces.length}) <span className="font-normal text-ink-muted">— {laceIds.length}/{product.maxLaceCount ?? 1} select (optional)</span>
            </h3>
            <p className="mb-2 mt-0.5 text-[11px] text-ink-muted">
              {lacePickerHidden
                ? t('Kisi bhi lace par tap karein — directly add ho jayegi.', 'Tap any lace to add it.')
                : t('Kisi bhi lace par tap karein — uska colour chunne ka option khul jayega.', 'Tap any lace to pick its colour.')}
            </p>
            <div className="vertical-rail">
              {availableLaces.map((lace) => {
                const isSelected = laceIds.includes(lace.id);
                return (
                  <div
                    key={lace.id}
                    role="button"
                    tabIndex={lace.inStock ? 0 : -1}
                    aria-label={`Select ${lace.name}`}
                    onClick={() => lace.inStock && toggleSelection('lace', lace.id, isSelected, laceIds, setLaceIds, setLaceColors)}
                    onKeyDown={(event) => {
                      if (!lace.inStock) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleSelection('lace', lace.id, isSelected, laceIds, setLaceIds, setLaceColors);
                      }
                    }}
                    className={clsx(
                      'w-full overflow-hidden rounded-xl border-2 bg-white text-left transition outline-none',
                      isSelected ? 'border-maroon-600' : 'border-ink-light/20',
                      !lace.inStock && 'opacity-50',
                      lace.inStock && 'cursor-pointer focus-visible:ring-2 focus-visible:ring-maroon-400',
                    )}
                  >
                    <div className="flex gap-3 p-2">
                      <div className="relative h-20 w-24 shrink-0 overflow-hidden rounded-lg">
                        <SmartImage src={lace.image} alt={lace.name} sizes="90px" />
                        {isSelected ? (
                          <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-maroon-600 text-white">
                            <Check size={12} strokeWidth={3} />
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setPreviewImage({ src: lace.image, alt: lace.name });
                          }}
                          className="absolute bottom-1.5 right-1.5 rounded-full bg-white/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-ink shadow-card"
                        >
                          View
                        </button>
                      </div>
                      <div className="min-w-0 flex-1 py-1">
                        <p className="truncate text-[12px] font-semibold leading-tight">{lace.name}</p>
                        <p className={lace.priceMinor === 0 ? 'mt-1 text-[11px] font-black uppercase tracking-wide text-leaf' : 'mt-1 text-[11px] font-bold text-maroon-700'}>{moneyLabel(lace.priceMinor, currency)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {!lacePickerHidden ? renderChosenStrip(availableLaces, laceColors, laceIds, 'lace') : null}
          </section>
        ) : null}

        {/* Latkans */}
        {step === 'latkan' && availableLatkans.length > 0 ? (
          <section>
            <h3 className="label">
              Latkans ({availableLatkans.length}) <span className="font-normal text-ink-muted">— {latkanIds.length}/{product.maxLatkanCount ?? 1} select (optional)</span>
            </h3>
            <p className="mb-2 mt-0.5 text-[11px] text-ink-muted">
              {latkanPickerHidden
                ? t('Kisi bhi latkan par tap karein — directly add ho jayega.', 'Tap any latkan to add it.')
                : t('Kisi bhi latkan par tap karein — uska colour chunne ka option khul jayega.', 'Tap any latkan to pick its colour.')}
            </p>
            <div className="vertical-rail">
              {availableLatkans.map((latkan) => {
                const isSelected = latkanIds.includes(latkan.id);
                return (
                  <div
                    key={latkan.id}
                    role="button"
                    tabIndex={latkan.inStock ? 0 : -1}
                    aria-label={`Select ${latkan.name}`}
                    onClick={() => latkan.inStock && toggleSelection('latkan', latkan.id, isSelected, latkanIds, setLatkanIds, setLatkanColors)}
                    onKeyDown={(event) => {
                      if (!latkan.inStock) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleSelection('latkan', latkan.id, isSelected, latkanIds, setLatkanIds, setLatkanColors);
                      }
                    }}
                    className={clsx(
                      'w-full overflow-hidden rounded-xl border-2 bg-white text-left transition outline-none',
                      isSelected ? 'border-maroon-600' : 'border-ink-light/20',
                      !latkan.inStock && 'opacity-50',
                      latkan.inStock && 'cursor-pointer focus-visible:ring-2 focus-visible:ring-maroon-400',
                    )}
                  >
                    <div className="flex gap-3 p-2">
                      <div className="relative h-20 w-24 shrink-0 overflow-hidden rounded-lg">
                        <SmartImage src={latkan.image} alt={latkan.name} sizes="90px" />
                        {isSelected ? (
                          <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-maroon-600 text-white">
                            <Check size={12} strokeWidth={3} />
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setPreviewImage({ src: latkan.image, alt: latkan.name });
                          }}
                          className="absolute bottom-1.5 right-1.5 rounded-full bg-white/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-ink shadow-card"
                        >
                          View
                        </button>
                      </div>
                      <div className="min-w-0 flex-1 py-1">
                        <p className="truncate text-[12px] font-semibold leading-tight">{latkan.name}</p>
                        <p className={latkan.priceMinor === 0 ? 'mt-1 text-[11px] font-black uppercase tracking-wide text-leaf' : 'mt-1 text-[11px] font-bold text-maroon-700'}>{moneyLabel(latkan.priceMinor, currency)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {!latkanPickerHidden ? renderChosenStrip(availableLatkans, latkanColors, latkanIds, 'latkan') : null}
          </section>
        ) : null}
      </div>

      {/* Colour popup — opens the moment a lace/latkan is tapped. Portaled
          above the sheet so transforms/overflow here can't trap it. */}
      {colorSheetFor && colorSheetItem
        ? createPortal(
            <ColorChoicePopup
              item={colorSheetItem}
              kind={colorSheetFor.kind}
              lang={lang}
              fabricColor={fabricColor}
              current={resolveColor(colorSheetItem, colorSheetMap)}
              map={colorSheetMap}
              onPick={(color) =>
                setColorSheetMap((prev) => ({ ...prev, [colorSheetFor.itemId]: { mode: 'pick', color } }))
              }
              onFabric={() =>
                setColorSheetMap((prev) => ({ ...prev, [colorSheetFor.itemId]: { mode: 'fabric' } }))
              }
              onDone={() => setColorSheetFor(null)}
            />,
            document.body,
          )
        : null}

      {previewImage
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] grid place-items-center bg-ink/70 p-4"
              role="dialog"
              aria-modal="true"
              aria-label={`${previewImage.alt} — full size preview`}
              onClick={() => setPreviewImage(null)}
            >
              <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white p-2 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                <div className="overflow-hidden rounded-xl bg-maroon-50">
                  <img src={previewImage.src} alt={previewImage.alt} className="mx-auto max-h-[75vh] w-full object-contain" />
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 px-1">
                  <p className="min-w-0 truncate text-sm font-bold text-ink">{previewImage.alt}</p>
                  <button type="button" onClick={() => setPreviewImage(null)} className="btn-outline shrink-0 px-3 py-2 text-[12px]">
                    Close
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </Sheet>
  );
}

type ColorChoicePopupProps = {
  item: Lace | Latkan;
  kind: 'lace' | 'latkan';
  lang: Lang;
  fabricColor: AccessoryColor | null;
  current: { color: AccessoryColor; label: string };
  map: Record<string, ColorChoice>;
  onPick: (color: AccessoryColor) => void;
  onFabric: () => void;
  onDone: () => void;
};

/** Small centred popup: fabric-matching option (default) + the item's colours. */
function ColorChoicePopup({
  item,
  kind,
  lang,
  fabricColor,
  current,
  map,
  onPick,
  onFabric,
  onDone,
}: ColorChoicePopupProps) {
  const entry = map[item.id];
  const isFabricMode = entry?.mode === 'fabric' || (!entry && fabricColor !== null);
  const variants: AccessoryColor[] =
    (item.colors?.length ?? 0) > 0
      ? (item.colors as Array<{ name: string; hex: string }>).map((c) => ({ colorName: c.name, colorHex: c.hex }))
      : [{ colorName: item.colorName || item.name, colorHex: item.colorHex || '#cccccc' }];

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/40 p-3 sm:items-center" onClick={onDone}>
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-maroon-100 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-ink">
              {item.name} — {kind === 'lace' ? tr(lang, 'colour chunein', 'pick a colour') : tr(lang, 'colour chunein', 'pick a colour')}
            </p>
            <p className="text-[11px] text-ink-muted">
              {kind === 'lace'
                ? tr(lang, 'Lace ke available colours neeche hain.', 'Available colours for this lace are below.')
                : tr(lang, 'Latkan ke available colours neeche hain.', 'Available colours for this latkan are below.')}
            </p>
          </div>
          <button type="button" onClick={onDone} className="btn-ghost shrink-0 p-2" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 p-4">
          {/* Fabric-matching option — default */}
          {fabricColor ? (
            <button
              type="button"
              onClick={onFabric}
              className={clsx(
                'flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition',
                isFabricMode ? 'border-maroon-600 bg-maroon-50/60' : 'border-ink-light/20',
              )}
            >
              <span
                className={clsx(
                  'grid h-5 w-5 shrink-0 place-items-center rounded-full border-2',
                  isFabricMode ? 'border-maroon-600 bg-maroon-600 text-white' : 'border-ink-light/40',
                )}
              >
                {isFabricMode ? <Check size={12} strokeWidth={3} /> : null}
              </span>
              <span className="flex h-9 w-9 shrink-0 rounded-full border border-ink-light/30" style={{ backgroundColor: fabricColor.colorHex }} />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink">{tr(lang, 'Fabric ke jaisa colour (Recommended)', 'Same colour as fabric (Recommended)')}</span>
                <span className="block truncate text-[12px] text-ink-muted">
                  {fabricColor.colorName} — {tr(lang, 'aapke chune hue fabric ka colour', "your chosen fabric's colour")}
                </span>
              </span>
            </button>
          ) : (
            <p className="rounded-xl bg-maroon-50/60 p-2.5 text-[12px] text-ink-muted">
              {tr(
                lang,
                'Pehle upar se fabric select karein — tab "Fabric ke jaisa colour" milega. Ab tak item ka default colour hi lagega.',
                'Select a fabric first to get the "Same colour as fabric" option. Until then the item\'s default colour is used.',
              )}
            </p>
          )}

          {/* Exact colour options */}
          <div>
            <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-muted">{tr(lang, 'Ya exact colour chunein:', 'Or pick an exact colour:')}</p>
            <div className="grid grid-cols-2 gap-2">
              {variants.map((variant) => {
                const active = !isFabricMode && current.color.colorName === variant.colorName;
                return (
                  <button
                    key={variant.colorName}
                    type="button"
                    onClick={() => onPick(variant)}
                    className={clsx(
                      'flex items-center gap-2.5 rounded-xl border-2 px-3 py-2 text-left transition',
                      active ? 'border-maroon-600 bg-maroon-50/60' : 'border-ink-light/20',
                    )}
                  >
                    <span className="h-6 w-6 shrink-0 rounded-full border border-ink-light/30" style={{ backgroundColor: variant.colorHex }} />
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold text-ink">{variant.colorName}</span>
                      {active ? <span className="text-[10px] font-bold text-maroon-700">{tr(lang, 'Selected', 'Selected')}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="border-t border-maroon-100 p-3">
          <button type="button" onClick={onDone} className="btn-primary btn-lg w-full">
            Done — {current.label}
          </button>
        </div>
      </div>
    </div>
  );
}

function FacetRow({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: Array<{ value: string; label: string; hex?: string }>;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  if (options.length === 0) return null;

  return (
    <div>
      <p className="mb-1.5 text-[13px] font-bold uppercase tracking-wide text-ink-muted">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onToggle(option.value)}
            className={clsx('chip', selected.includes(option.value) && 'chip-active')}
          >
            {option.hex ? (
              <span className="h-3.5 w-3.5 rounded-full border border-ink-light/40" style={{ backgroundColor: option.hex }} />
            ) : null}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}