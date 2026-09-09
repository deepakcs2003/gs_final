import { NavLink } from 'react-router-dom';
import { ShoppingBag, Scissors, Sparkles } from 'lucide-react';
import clsx from 'clsx';

/**
 * The three top-level sections (README §3), pinned below the header on every
 * section page so switching between them is always one tap — never a trip back
 * to the homepage.
 *
 * Height is fixed at `--tabs-h` because the filter bar and the desktop sidebar
 * both stick underneath it and need to know how far down to sit.
 */

const SECTIONS = [
  { to: '/ready-to-buy', label: 'Ready to Buy', short: 'Ready', icon: ShoppingBag },
  { to: '/customize', label: 'Customize', short: 'Customize', icon: Scissors },
  { to: '/showcase', label: 'New Designs', short: 'New', icon: Sparkles },
] as const;

export function SectionTabs() {
  return (
    <nav
      aria-label="Sections"
      // Full-bleed background like the header, with the control itself aligned
      // to the same content column.
      className="sticky top-[var(--header-h)] z-30 border-b border-maroon-100 bg-cream/95 backdrop-blur"
    >
      <div className="mx-auto flex h-[var(--tabs-h)] max-w-7xl items-center px-3 sm:px-5">
        {/* Full width on phones where it is the primary way to switch section;
            capped on desktop so it does not stretch across the whole page. */}
        <div className="grid w-full grid-cols-3 gap-1 rounded-xl bg-maroon-50 p-1 lg:max-w-lg">
          {SECTIONS.map((section) => (
            <NavLink
              key={section.to}
              to={section.to}
              // `end` is off on purpose: /ready-to-buy/bridal should keep the
              // Ready to Buy tab lit.
              className={({ isActive }) =>
                clsx(
                  'flex h-9 items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-bold transition no-tap-highlight sm:h-10 sm:text-[14px]',
                  isActive ? 'bg-maroon-600 text-white shadow-card' : 'text-ink-muted active:bg-maroon-100',
                )
              }
            >
              <section.icon className="h-4 w-4 shrink-0 sm:h-[18px] sm:w-[18px]" />
              <span className="truncate sm:hidden">{section.short}</span>
              <span className="hidden truncate sm:inline">{section.label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}
