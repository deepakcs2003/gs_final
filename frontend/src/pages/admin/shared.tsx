import { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Search, Check, Star, RefreshCw, Upload, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { ApiError, uploadImages } from '../../lib/api';
import { cloudinarySrc } from '../../lib/image';

/** Admin-scoped money formatter (INR, whole rupees). */
export function inr(minor: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(minor / 100);
}

/** Simple slugifier for design ids, slugs, etc. */
export function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* -------------------------------------------------------------------------- */
/* Modal — shared bottom-sheet / centred dialog for every admin form           */
/* -------------------------------------------------------------------------- */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}

export function Modal({ open, onClose, title, subtitle, children, footer, maxWidth = 'sm:max-w-2xl' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = 'auto';
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button type="button" aria-label="Band karein" className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        className={clsx('relative max-h-[92vh] w-full rounded-t-3xl bg-white shadow-sheet sm:rounded-2xl flex flex-col', maxWidth)}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-ink-light/30 sm:hidden" />
        <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <h3 className="font-display text-xl font-bold text-ink">{title}</h3>
            {subtitle ? <p className="hint mt-0.5">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Band karein"
            className="-mr-1 -mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-maroon-50">
            <X size={20} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer ? <div className="border-t border-ink-light/15 bg-white px-5 pb-5 pt-3 sm:rounded-b-2xl">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------------------- */
/* Form primitives                                                             */
/* -------------------------------------------------------------------------- */

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('label block w-full', className)}>
      <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-muted">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx('field mt-1', props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx('field mt-1 min-h-[96px]', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx('field mt-1', props.className)} />;
}

export function Checkbox({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 rounded border-ink-light/40 text-maroon-600 focus:ring-maroon-500" />
      <span>
        <span className="text-sm font-semibold text-ink">{label}</span>
        {hint ? <span className="block text-xs text-ink-muted mt-0.5">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-2 text-sm font-semibold text-ink">
      <span className={clsx('relative inline-flex h-6 w-11 items-center rounded-full transition', checked ? 'bg-leaf' : 'bg-ink-light/30')}>
        <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white shadow transition', checked ? 'translate-x-6' : 'translate-x-1')} />
      </span>
      {label}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                      */
/* -------------------------------------------------------------------------- */

export function BtnPrimary({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={clsx('btn-primary min-h-10 px-4 text-sm', props.className)}>{children}</button>;
}
export function BtnOutline({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={clsx('btn-outline min-h-10 px-4 text-sm', props.className)}>{children}</button>;
}
export function BtnGhost({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={clsx('btn-ghost min-h-10 px-4 text-sm', props.className)}>{children}</button>;
}

/* -------------------------------------------------------------------------- */
/* Search box                                                                   */
/* -------------------------------------------------------------------------- */

export function SearchInput({ value, onChange, placeholder = 'Search...' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="relative block w-full sm:w-72">
      <Search className="absolute left-3 top-3.5 text-ink-light" size={17} />
      <input className="field min-h-[46px] pl-10" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Status badge + badges                                                        */
/* -------------------------------------------------------------------------- */

const statusTones: Record<string, string> = {
  PLACED: 'bg-maroon-100 text-maroon-700',
  CONFIRMED: 'bg-marigold-100 text-ink',
  PROCESSING: 'bg-maroon-100 text-maroon-700',
  STITCHING: 'bg-purple-100 text-purple-700',
  QUALITY_CHECK: 'bg-purple-100 text-purple-700',
  PACKED: 'bg-cyan-100 text-cyan-700',
  SHIPPED: 'bg-blue-100 text-blue-700',
  DELIVERED: 'bg-leaf/15 text-leaf',
  CANCELLED: 'bg-alert/10 text-alert',
  RETURNED: 'bg-alert/10 text-alert',
  FAILED: 'bg-alert/10 text-alert',
  PENDING: 'bg-marigold-100 text-ink',
  APPROVED: 'bg-leaf/15 text-leaf',
  REJECTED: 'bg-alert/10 text-alert',
  PAID: 'bg-leaf/15 text-leaf',
  COD_PENDING: 'bg-marigold-100 text-ink',
  REFUNDED: 'bg-blue-100 text-blue-700',
};

export function Badge({ label, tone }: { label: string; tone?: string }) {
  return <span className={clsx('rounded-full px-2 py-1 text-[11px] font-bold whitespace-nowrap', tone ?? statusTones[label] ?? 'bg-maroon-50 text-maroon-700')}>{label.replace(/_/g, ' ')}</span>;
}

/* -------------------------------------------------------------------------- */
/* Page toolbars / empty states                                                 */
/* -------------------------------------------------------------------------- */

export function Toolbar({ title, count, searchPlaceholder, query, onQuery, onAdd, addLabel }: {
  title: string; count?: number; searchPlaceholder?: string; query?: string; onQuery?: (v: string) => void; onAdd?: () => void; addLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-maroon-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div>
        <h3 className="section-title">{title} {count !== undefined ? <span className="text-base font-normal text-ink-muted">({count})</span> : null}</h3>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        {onQuery ? <SearchInput value={query ?? ''} onChange={onQuery} placeholder={searchPlaceholder} /> : null}
        {onAdd ? <BtnPrimary onClick={onAdd} className="w-full sm:w-auto"><Plus size={16} />{addLabel ?? 'Add'}</BtnPrimary> : null}
      </div>
    </div>
  );
}

export function Empty({ message = 'Kuch nahi mila.' }: { message?: string }) {
  return <p className="p-6 text-center text-sm text-ink-muted">{message}</p>;
}

/* -------------------------------------------------------------------------- */
/* ColorPaletteSelect — colour picker from the Admin colour collection         */
/* -------------------------------------------------------------------------- */

export interface PaletteColor {
  name: string;
  hex: string;
}

/**
 * Dropdown that lists every colour created in Admin → Catalog → Colour and lets
 * the user pick one or many. Used by product, fabric, lace and latkan forms so
 * swatches stay consistent with the central palette. `value` may contain
 * colours that no longer exist in the palette (old records) — they still render.
 */
export function ColorPaletteSelect({
  palette,
  value,
  onChange,
  multiple = true,
  hint,
}: {
  palette: PaletteColor[];
  value: PaletteColor[];
  onChange: (value: PaletteColor[]) => void;
  multiple?: boolean;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (option: PaletteColor) => {
    const selected = value.some((c) => c.name === option.name);
    if (multiple) {
      onChange(selected ? value.filter((c) => c.name !== option.name) : [...value, option]);
    } else {
      onChange(selected && value.length === 1 ? [] : [option]);
    }
  };

  const remove = (name: string) => onChange(value.filter((c) => c.name !== name));

  return (
    <div className="relative mt-1" ref={rootRef}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="field flex min-h-[42px] w-full flex-wrap items-center gap-1.5 px-3 py-1.5 text-left">
        {value.length === 0 ? <span className="text-sm text-ink-light">Colour select karein...</span> : value.map((color) => (
          <span key={color.name} className="inline-flex items-center gap-1.5 rounded-full bg-maroon-50 px-2.5 py-1 text-xs font-semibold text-maroon-700">
            <span className="h-3 w-3 rounded-full border border-ink-light/40" style={{ backgroundColor: color.hex }} />
            {color.name}
            <button type="button" onClick={(e) => { e.stopPropagation(); remove(color.name); }} aria-label={`Remove ${color.name}`}><X size={11} /></button>
          </span>
        ))}
        <ChevronDown size={15} className={clsx('ml-auto shrink-0 text-ink-light transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-ink-light/30 bg-white p-1.5 shadow-sheet">
          {palette.length === 0 ? (
            <p className="p-3 text-center text-xs text-ink-muted">Pehle Admin → Catalog → Colour mein colours banayein.</p>
          ) : palette.map((option) => {
            const selected = value.some((c) => c.name === option.name);
            return (
              <button type="button" key={option.name} onClick={() => toggle(option)}
                className={clsx('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-ink hover:bg-maroon-50', selected && 'bg-maroon-50')}>
                <span className="h-4 w-4 shrink-0 rounded-full border border-ink-light/40" style={{ backgroundColor: option.hex }} />
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                {selected ? <Check size={14} className="text-maroon-600" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Key-value array editor (for product variants, size-price, etc.)              */
/* -------------------------------------------------------------------------- */

export function StringListEditor({ values, onChange, placeholder = 'Add...' }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('');
  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) onChange([...values, trimmed]);
    setInput('');
  };
  return (
    <div className="mt-1 rounded-xl border border-ink-light/30 p-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span key={value} className="inline-flex items-center gap-1 rounded-full bg-maroon-50 px-2.5 py-1 text-xs font-semibold text-maroon-700">
            {value}
            <button type="button" onClick={() => onChange(values.filter((v) => v !== value))} aria-label={`Remove ${value}`}><X size={12} /></button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input className="field min-h-[38px] flex-1 px-3 py-1.5 text-sm" placeholder={placeholder} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" onClick={add} className="btn-outline min-h-[38px] px-3 text-sm"><Plus size={14} /></button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Key-value array editor (for product variants, size-price, etc.)              */
/* -------------------------------------------------------------------------- */

export function KvEditor({ rows, onChange, keyLabel = 'Key', valueLabel = 'Value' }: {
  rows: Array<{ key: string; value: string | number }>;
  onChange: (rows: Array<{ key: string; value: string | number }>) => void;
  keyLabel?: string;
  valueLabel?: string;
}) {
  const update = (index: number, patch: Partial<{ key: string; value: string | number }>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  return (
    <div className="mt-1 space-y-2">
      {rows.map((row, index) => (
        <div className="flex gap-2" key={index}>
          <input className="field min-h-[40px] flex-1 px-3 py-1.5 text-sm" placeholder={keyLabel} value={row.key} onChange={(e) => update(index, { key: e.target.value })} />
          <input className="field min-h-[40px] w-24 px-3 py-1.5 text-sm" placeholder={valueLabel} value={row.value} onChange={(e) => update(index, { value: e.target.value })} />
          <button type="button" onClick={() => onChange(rows.filter((_, i) => i !== index))} className="btn-ghost min-h-[40px] px-3"><X size={15} /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { key: '', value: 0 }])} className="btn-outline min-h-[40px] w-full text-sm"><Plus size={14} />Add row</button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Save button row used inside form footers                                     */
/* -------------------------------------------------------------------------- */

export function SaveRow({ busy, label = 'Save changes' }: { busy: boolean; label?: string }) {
  return (
    <div className="flex justify-end gap-2">
      <BtnPrimary type="submit" disabled={busy}>{busy ? 'Saving...' : <><Check size={16} />{label}</>}</BtnPrimary>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Image lightbox — full-screen preview                                        */
/* -------------------------------------------------------------------------- */

export function ImageLightbox({ url, alt = '', onClose }: { url: string; alt?: string; onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = 'auto';
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/80 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Image preview">
      <button type="button" aria-label="Band karein" onClick={onClose}
        className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20">
        <X size={20} />
      </button>
      <img src={url} alt={alt} onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] max-w-full rounded-2xl bg-white object-contain shadow-2xl" />
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------------------- */
/* ImagePicker — upload / URL / preview / remove / reorder / lightbox          */
/* -------------------------------------------------------------------------- */

interface ImagePickerProps {
  value: string[];
  onChange: (urls: string[]) => void;
  max?: number;
  hint?: string;
  /** File types the picker offers in the file dialog. */
  accept?: string;
}

export function ImagePicker({ value, onChange, max = 10, hint, accept = 'image/jpeg,image/png,image/webp' }: ImagePickerProps) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addUrl = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) { setMsg('Yeh image pehle se add hai.'); return; }
    onChange([...value, trimmed]);
    setDraft('');
    setMsg('');
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setMsg('');
    try {
      const uploaded = await uploadImages(Array.from(files));
      const added = uploaded.map((u) => u.url).filter((url) => !value.includes(url));
      onChange([...value, ...added].slice(0, max));
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Upload fail hua.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const makeMain = (index: number) => {
    const url = value[index];
    onChange([url, ...value.filter((_, j) => j !== index)]);
  };

  const full = value.length >= max;

  return (
    <div className="mt-1">
      {preview ? <ImageLightbox url={preview} onClose={() => setPreview(null)} /> : null}
      <div className="flex flex-wrap gap-2">
        {value.map((url, index) => (
          <div key={url} className="group relative h-20 w-20 overflow-hidden rounded-xl border border-ink-light/30 bg-maroon-50">
            <button type="button" onClick={() => setPreview(url)} title="Image preview" className="h-full w-full">
              <img src={cloudinarySrc(url, 128)} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
            {max !== 1 && index === 0 ? <span className="absolute left-1 top-1 rounded bg-maroon-600 px-1 text-[9px] font-bold text-white">MAIN</span> : null}
            <div className="absolute inset-x-0 bottom-0 hidden justify-between bg-ink/60 p-0.5 group-hover:flex">
              {max !== 1 ? (
                <button type="button" onClick={() => makeMain(index)} title="Main image banayein" className="grid h-6 w-6 place-items-center text-white hover:bg-ink/40">
                  <Star size={12} />
                </button>
              ) : null}
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== index))} title="Remove image" className="grid h-6 w-6 place-items-center text-white hover:bg-alert">
                <X size={12} />
              </button>
            </div>
          </div>
        ))}
        {full ? null : (
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} title="Computer se upload karein"
            className="grid h-20 w-20 place-items-center rounded-xl border-2 border-dashed border-ink-light/40 text-ink-light hover:border-maroon-500 hover:text-maroon-600">
            {busy ? <RefreshCw size={18} className="animate-spin" /> : <Upload size={18} />}
          </button>
        )}
        <input ref={fileRef} type="file" accept={accept} multiple className="hidden"
          onChange={(e) => void pickFiles(e.target.files)} />
      </div>
      <div className="mt-2 flex gap-2">
        <input className="field min-h-[38px] flex-1 px-3 py-1.5 text-sm" placeholder="Image URL add karein..." value={draft}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } }} />
        <button type="button" onClick={addUrl} className="btn-outline min-h-[38px] px-3 text-sm">Add</button>
      </div>
      {msg ? <p className="mt-1 text-xs font-medium text-alert">{msg}</p> : null}
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}