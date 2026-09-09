import { Toolbar } from './shared';
import { Package, FileText } from 'lucide-react';
import { SettingsForm, type SettingDef } from './Settings';

const seoDefs: SettingDef[] = [
  { key: 'seoTitle', label: 'Store SEO title', hint: 'Browser tab + Google result mein dikhta hai', type: 'text' },
  { key: 'seoDescription', label: 'Store SEO description', type: 'textarea' },
  { key: 'seoKeywords', label: 'Store keywords (comma separated)', type: 'text' },
  { key: 'ogImage', label: 'Social share image URL', hint: 'WhatsApp / FB / IG par share karne par dikhega', type: 'text' },
];

export function SeoModule() {
  return (
    <div className="space-y-5">
      <section className="card overflow-hidden">
        <Toolbar title="SEO manager" count={seoDefs.length} />
        <p className="hint px-5 pb-2">Store-level meta tags yahan. Product/page-level SEO unki apni screens par hota hai — niche links dekhein.</p>
        <SettingsForm definitions={seoDefs} />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <h3 className="section-title"><Package size={16} className="inline text-maroon-600" /> Product SEO</h3>
          <p className="hint mt-1">Har product ka apna slug, SEO title, description, keywords aur ogImage hota hai — Products → Edit → SEO section se set hota hai. Slug Google ke liye sabse value rakhata hai.</p>
        </section>
        <section className="card p-5">
          <h3 className="section-title"><FileText size={16} className="inline text-maroon-600" /> Page SEO</h3>
          <p className="hint mt-1">About/FAQ/etc. har page ka apna SEO title aur description hota hai — Website content (pages) se edit hota hai.</p>
        </section>
      </div>
    </div>
  );
}