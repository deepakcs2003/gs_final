import { useLocation } from 'react-router-dom';
import { MessageCircle, Phone } from 'lucide-react';
import { useConfig } from '../../hooks/queries';
import { whatsappEnquiryUrl } from '../../lib/format';
import { track } from '../../lib/analytics';
import { api } from '../../lib/api';
import type { ProductDetail } from '../../lib/types';

/**
 * Floating WhatsApp and call buttons (README §70–71).
 *
 * On a product page the WhatsApp message is pre-filled with that design's name,
 * ID and link, so the shop owner receives a message they can act on instead of
 * a bare "hi".
 */

interface FloatingActionsProps {
  /** Set on the product page so the enquiry can name the design. */
  product?: ProductDetail;
}

export function FloatingActions({ product }: FloatingActionsProps) {
  const { data: config } = useConfig();
  const location = useLocation();

  if (!config?.whatsappNumber) return null;

  // Hidden where a sticky action bar already occupies the same corner.
  const hidden = ['/cart', '/checkout'].some((path) => location.pathname.startsWith(path));
  if (hidden) return null;

  const href = whatsappEnquiryUrl({
    number: config.whatsappNumber,
    ...(product
      ? {
          productName: product.name,
          designId: product.designId,
          category: product.category?.name ?? '',
          url: `${window.location.origin}/blouse/${product.slug}`,
        }
      : {}),
  });

  const onWhatsApp = () => {
    track('WHATSAPP_CLICK', { productId: product?.id ?? null });
    void api('/enquiries', {
      method: 'POST',
      body: { productId: product?.id ?? null, channel: 'WHATSAPP', message: product?.designId ?? '' },
      quiet: true,
    }).catch(() => undefined);
  };

  return (
    <div
      className="fixed right-3 z-30 flex flex-col gap-2.5"
      style={{ bottom: 'calc(var(--bottomnav-h) + var(--safe-bottom) + 14px)' }}
    >
      {config.callNumber ? (
        <a
          href={`tel:+${config.callNumber}`}
          aria-label="Call karein"
          className="grid h-12 w-12 place-items-center rounded-full bg-maroon-600 text-white shadow-lift transition active:scale-95 lg:hidden"
        >
          <Phone size={21} />
        </a>
      ) : null}

      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onWhatsApp}
        aria-label="WhatsApp par enquiry karein"
        className="flex h-14 items-center gap-2 rounded-full bg-leaf px-4 text-white shadow-lift transition active:scale-95"
      >
        <MessageCircle size={23} />
        <span className="hidden text-sm font-bold sm:inline">WhatsApp</span>
      </a>
    </div>
  );
}
