import { Link } from 'react-router-dom';
import { Facebook, Instagram, MessageCircle, Phone, Youtube } from 'lucide-react';
import { useConfig } from '../../hooks/queries';

const SHOP_LINKS = [
  { to: '/ready-to-buy', label: 'Ready to Buy' },
  { to: '/customize', label: 'Customize with Measurement' },
  { to: '/showcase', label: 'Upcoming Designs' },
  { to: '/wishlist', label: 'Wishlist' },
];

const HELP_LINKS = [
  { to: '/about', label: 'About Us' },
  { to: '/contact', label: 'Contact Us' },
  { to: '/faq', label: 'FAQ' },
  { to: '/orders', label: 'Track Order' },
];

const POLICY_LINKS = [
  { to: '/policy/shipping', label: 'Shipping Policy' },
  { to: '/policy/returns', label: 'Return Policy' },
  { to: '/policy/privacy', label: 'Privacy Policy' },
  { to: '/policy/terms', label: 'Terms & Conditions' },
];

export function Footer() {
  const { data: config } = useConfig();

  return (
    <footer className="mt-12 border-t border-maroon-100 bg-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <p className="font-display text-lg font-bold text-maroon-700">Guddi Silai</p>
          <p className="hint mt-2 max-w-xs">
            Ghar baithe blouse order karein — ready-made ya apne naap ka custom silai. Har design dhyan se banaya jata
            hai.
          </p>

          <div className="mt-4 flex gap-2">
            {config?.whatsappNumber ? (
              <a
                href={`https://wa.me/${config.whatsappNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="grid h-10 w-10 place-items-center rounded-full bg-leaf text-white"
                aria-label="WhatsApp par baat karein"
              >
                <MessageCircle size={18} />
              </a>
            ) : null}
            {config?.callNumber ? (
              <a
                href={`tel:+${config.callNumber}`}
                className="grid h-10 w-10 place-items-center rounded-full bg-maroon-600 text-white"
                aria-label="Call karein"
              >
                <Phone size={18} />
              </a>
            ) : null}
            <a
              href="https://www.instagram.com/guddi_silai/"
              target="_blank"
              rel="noopener noreferrer"
              className="grid h-10 w-10 place-items-center rounded-full bg-maroon-50 text-maroon-600"
              aria-label="Instagram"
            >
              <Instagram size={18} />
            </a>
            <a
              href="https://www.facebook.com/GuddiSilai"
              target="_blank"
              rel="noopener noreferrer"
              className="grid h-10 w-10 place-items-center rounded-full bg-maroon-50 text-maroon-600"
              aria-label="Facebook"
            >
              <Facebook size={18} />
            </a>
            <a
              href="https://www.youtube.com/@Guddi_Silai"
              target="_blank"
              rel="noopener noreferrer"
              className="grid h-10 w-10 place-items-center rounded-full bg-maroon-50 text-maroon-600"
              aria-label="YouTube"
            >
              <Youtube size={18} />
            </a>
          </div>
        </div>

        <FooterColumn title="Shop" links={SHOP_LINKS} />
        <FooterColumn title="Help" links={HELP_LINKS} />
        <FooterColumn title="Policies" links={POLICY_LINKS} />
      </div>

      <div className="border-t border-maroon-100 px-4 py-4 text-center">
        <p className="text-[13px] text-ink-muted">
          © {new Date().getFullYear()} Guddi Silai. Made with care in India.
          {config?.currency === 'USD' ? (
            <span className="ml-1">Prices shown in USD; delivery charged at checkout.</span>
          ) : null}
        </p>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: Array<{ to: string; label: string }> }) {
  return (
    <div>
      <h3 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-ink-muted">{title}</h3>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.to}>
            <Link to={link.to} className="text-[14px] text-ink hover:text-maroon-700 hover:underline">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
