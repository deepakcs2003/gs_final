import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronDown, MessageCircle, Phone, Mail, Scissors, Home } from 'lucide-react';
import clsx from 'clsx';
import { useConfig, usePage } from '../hooks/queries';
import { EmptyState } from '../components/ui';

/**
 * The pages README §52 asks to keep *off* the homepage. Plain language
 * throughout — these are the pages a worried customer reads before ordering.
 */

function Page({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-3 pt-5 sm:px-5">
      <h1 className="section-title">{title}</h1>
      {subtitle ? <p className="hint mt-1">{subtitle}</p> : null}
      <div className="mt-5 space-y-4">{children}</div>
    </div>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="card space-y-3 p-5 text-[14.5px] leading-relaxed text-ink">{children}</div>;
}

export function AboutPage() {
  return (
    <Page title="About Guddi Silai" subtitle="Hamari kahani">
      <Prose>
        <p>
          Guddi Silai ek chhota sa tailoring business hai jo blouse silai mein specialise karta hai. Humne dekha ki
          achha blouse dhoondhna aur sahi fitting karana — dono hi mushkil kaam hain. Isiliye humne yeh website banayi.
        </p>
        <p>Yahan aap teen tarah se blouse le sakti hain:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Ready to Buy</strong> — pehle se sila hua blouse, size aur color choose karein, turant delivery.
          </li>
          <li>
            <strong>Customize with Measurement</strong> — design aur fabric aap choose karein, apna naap dein, hum aapke
            liye banayenge.
          </li>
          <li>
            <strong>Showcase</strong> — naye aane wale designs, sirf dekhne ke liye. Pasand aaye to WhatsApp par batayein.
          </li>
        </ul>
        <p>
          Har blouse ko haath se check kiya jata hai. Agar kuch bhi theek na lage, humein WhatsApp par batayein — hum
          sudhaarne ki poori koshish karenge.
        </p>
      </Prose>
    </Page>
  );
}

export function ContactPage() {
  const { data: config } = useConfig();

  return (
    <Page title="Contact Us" subtitle="Koi bhi sawaal ho, seedha poochein">
      <div className="grid gap-3 sm:grid-cols-2">
        {config?.whatsappNumber ? (
          <a
            href={`https://wa.me/${config.whatsappNumber}`}
            target="_blank"
            rel="noopener noreferrer"
            className="card flex items-center gap-3 p-4 transition hover:shadow-lift"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-leaf text-white">
              <MessageCircle size={20} />
            </span>
            <span>
              <span className="block text-[15px] font-bold text-ink">WhatsApp</span>
              <span className="block text-[13px] text-ink-muted">Sabse tez jawab</span>
            </span>
          </a>
        ) : null}

        {config?.callNumber ? (
          <a href={`tel:+${config.callNumber}`} className="card flex items-center gap-3 p-4 transition hover:shadow-lift">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-maroon-600 text-white">
              <Phone size={20} />
            </span>
            <span>
              <span className="block text-[15px] font-bold text-ink">Call karein</span>
              <span className="block text-[13px] text-ink-muted">Subah 10 se shaam 7 baje tak</span>
            </span>
          </a>
        ) : null}

        <div className="card flex items-center gap-3 p-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-marigold-500 text-ink">
            <Mail size={20} />
          </span>
          <span>
            <span className="block text-[15px] font-bold text-ink">Email</span>
            <span className="block text-[13px] text-ink-muted">support@guddisilai.com</span>
          </span>
        </div>
      </div>

      <Prose>
        <p>
          Order se juda koi bhi sawaal — measurement, fabric, delivery, ya return — WhatsApp par poochein. Agar aap order
          ke baare mein baat kar rahi hain to apna <strong>Order ID</strong> zaroor batayein, isse jaldi help mil jayegi.
        </p>
      </Prose>
    </Page>
  );
}

const FAQS = [
  {
    q: 'Order kaise karein?',
    a: 'Design pasand karein → Ready to Buy hai to color aur size choose karein, ya Customize hai to fabric choose karke apna measurement dein → Cart mein daalein → address bharein → payment karein. Bas!',
  },
  {
    q: 'Measurement kaise dein?',
    a: 'Customize blouse choose karne par measurement page khulega. Har naap ke saamne picture aur simple explanation hoti hai ki tape kahan rakhni hai. Darzi wali tape use karein. Agar samajh na aaye to WhatsApp par poochein.',
  },
  {
    q: 'Kaunsa fabric available hai?',
    a: 'Silk, Raw Silk, Cotton Silk, Satin, Velvet, Brocade, Net, Organza aur Designer fabric. Fabric choose karte waqt color, embroidery aur price se filter kar sakti hain.',
  },
  {
    q: 'Silai mein kitna time lagta hai?',
    a: 'Custom blouse ki silai mein lagbhag 7–10 din lagte hain, uske baad delivery. Ready-made blouse 2–5 din mein pahunch jata hai.',
  },
  {
    q: 'Kya main measurement badal sakti hoon?',
    a: 'Order place karne se pehle kabhi bhi badal sakti hain. Order ke baad turant WhatsApp karein — agar silai shuru nahi hui hai to hum badal denge.',
  },
  {
    q: 'Return hota hai kya?',
    a: 'Ready-made blouse delivery ke 7 din ke andar return ho sakta hai, agar pehna na gaya ho aur tag laga ho. Custom silai wale blouse aapke naap ke hisaab se bante hain, isliye unka return nahi hota — lekin agar silai mein galti ho to hum free mein theek karenge.',
  },
  {
    q: 'Order kaise track karein?',
    a: 'My Orders page par jayein. Login kiya hai to saare orders dikhenge. Guest order ke liye Order ID aur mobile number daalein.',
  },
  {
    q: 'Kya login zaroori hai?',
    a: 'Bilkul nahi. Bina login ke bhi aap sab designs dekh sakti hain, cart bana sakti hain aur order kar sakti hain. Login sirf tab kaam aata hai jab aap apna measurement ya address save karna chahein.',
  },
];

export function FaqPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <Page title="Aksar Poochhe Jane Wale Sawaal" subtitle="FAQ">
      <div className="space-y-2">
        {FAQS.map((faq, index) => (
          <div key={faq.q} className="card overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
              aria-expanded={openIndex === index}
              className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
            >
              <span className="text-[15px] font-bold text-ink">{faq.q}</span>
              <ChevronDown
                size={19}
                className={clsx('shrink-0 text-ink-muted transition', openIndex === index && 'rotate-180')}
              />
            </button>
            {openIndex === index ? (
              <p className="border-t border-maroon-100 px-4 py-4 text-[14.5px] leading-relaxed text-ink">{faq.a}</p>
            ) : null}
          </div>
        ))}
      </div>
    </Page>
  );
}

const POLICIES: Record<string, { title: string; body: string[] }> = {
  shipping: {
    title: 'Shipping Policy',
    body: [
      'Ready-made blouse order confirm hone ke 1–2 din mein dispatch ho jate hain aur 2–5 din mein pahunch jate hain.',
      'Custom silai wale blouse banne mein 7–10 din lagte hain, uske baad dispatch hote hain.',
      '₹1,499 se upar ke order par delivery free hai. Uske neeche ek chhota delivery charge lagta hai, jo checkout par saaf dikhta hai.',
      'India ke bahar ke orders par delivery charge payment ke samay calculate hota hai, kyunki har desh ka rate alag hota hai.',
      'Delivery se pehle courier company aapko SMS ya call karegi. Pincode checkout par check kar sakti hain.',
    ],
  },
  returns: {
    title: 'Return & Refund Policy',
    body: [
      'Ready-made blouse delivery ke 7 din ke andar return kiya ja sakta hai — blouse pehna hua na ho, tag laga ho aur original packing mein ho.',
      'Custom measurement wale blouse aapke naap par bante hain, isliye unka return nahi hota. Lekin agar silai mein hamari galti ho, to hum free mein theek karenge ya dobara banayenge.',
      'Return approve hone ke baad refund 5–7 working days mein usi payment method mein aa jata hai. COD orders ka refund bank account mein bhejte hain.',
      'Damage ya galat item mile to 48 ghante ke andar WhatsApp par photo bhejein — hum turant solution denge.',
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    body: [
      'Hum sirf wahi information lete hain jo order pura karne ke liye zaroori hai: aapka naam, mobile number, address aur measurement.',
      'Aapka mobile number sirf order updates aur delivery ke liye use hota hai. Hum ise kisi ko bechte nahi hain.',
      'Payment ki details (card ya UPI) humare paas kabhi nahi aati — woh seedha payment gateway ke paas jati hain.',
      'Website kaise use ho rahi hai yeh samajhne ke liye hum kuch basic information rakhte hain, jaise kaunsa design kitni baar dekha gaya aur kis sheher se log aaye. Aapka poora IP address save nahi hota — sirf ek aisa code banate hain jisse aapki pehchaan nahi ho sakti.',
      'Login karne par aapka measurement aur address save hota hai taki agli baar dobara na bharna pade. Aap ise kabhi bhi badal ya hata sakti hain.',
      'Kisi bhi privacy sawaal ke liye WhatsApp ya email par sampark karein.',
    ],
  },
  terms: {
    title: 'Terms & Conditions',
    body: [
      'Is website par diye gaye saare design, photo aur content Guddi Silai ke hain.',
      'Product ke color screen ke hisaab se thoda alag dikh sakte hain. Hum photo ko asli product ke jitna kareeb ho sake utna rakhte hain.',
      'Order confirm hone ke baad hi stock reserve hota hai. Payment fail hone par stock wapas available ho jata hai.',
      'Custom order ke liye jo measurement aap dengi, uske hisaab se blouse banega. Galat measurement dene par silai dobara karwane ka charge lag sakta hai.',
      'Prices bina bataye badal sakte hain, lekin jo order place ho chuka hai uski price nahi badlegi.',
      'Kisi bhi dispute ki soorat mein Indian law lagu hoga.',
    ],
  },
};

export function PolicyPage() {
  const { slug } = useParams<{ slug: string }>();
  const policy = slug ? POLICIES[slug] : undefined;

  if (!policy) {
    return (
      <EmptyState
        icon={<Scissors size={30} />}
        title="Yeh page nahi mila"
        message="Shayad link purana hai."
        action={
          <Link to="/" className="btn-primary">
            Home
          </Link>
        }
      />
    );
  }

  return (
    <Page title={policy.title}>
      <Prose>
        {policy.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </Prose>
    </Page>
  );
}

export function NotFoundPage() {
  return (
    <EmptyState
      icon={<Home size={30} />}
      title="Yeh page nahi mila"
      message="Ho sakta hai link purana ho ya galat type ho gaya ho."
      action={
        <Link to="/" className="btn-primary">
          Home par jayein
        </Link>
      }
    />
  );
}

/**
 * Admin-managed content pages (README §85.12). The About/FAQ/contact pages stay
 * hand-written (README §52 keeps them off the homepage), but anything new the
 * admin adds in the Content module gets a live `/page/:slug` route.
 */
export function ManagedPageView() {
  const { slug } = useParams<{ slug: string }>();
  const { data: page, isLoading, isError } = usePage(slug);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-3 pt-5 sm:px-5">
        <div className="skeleton h-6 w-40 rounded" />
        <div className="mt-5 space-y-4">
          <div className="skeleton h-32 rounded" />
        </div>
      </div>
    );
  }

  if (isError || !page) return <NotFoundPage />;

  const paragraphs = page.content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl px-3 pt-5 sm:px-5">
      <h1 className="section-title">{page.title}</h1>
      <div className="mt-5 space-y-4">
        {paragraphs.length > 0 ? (
          <Prose>
            {paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </Prose>
        ) : (
          <Prose>
            <p className="text-ink-muted">Yeh page abhi khali hai.</p>
          </Prose>
        )}
      </div>
    </div>
  );
}
