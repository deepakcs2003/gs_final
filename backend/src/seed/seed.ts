import { Category, Fabric, Lace, Latkan, Product } from '../models/catalog.js';
import { MeasurementField } from '../models/user.js';
import { Coupon } from '../models/commerce.js';
import { Setting } from '../models/analytics.js';
import { User } from '../models/user.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_SIZES } from '../domain/constants.js';
import { env } from '../config/env.js';

/**
 * Demo catalogue.
 *
 * Images use the `gs-art:` scheme rather than real URLs — the frontend renders
 * a branded placeholder for those, so the site is fully browsable before a
 * single photograph has been uploaded. Replace them with Cloudinary URLs as the
 * real product shoot arrives.
 */

const COLORS = [
  { name: 'Red', slug: 'red', hex: '#C62828' },
  { name: 'Maroon', slug: 'maroon', hex: '#7B1E3B' },
  { name: 'Pink', slug: 'pink', hex: '#D81B60' },
  { name: 'Black', slug: 'black', hex: '#212121' },
  { name: 'Green', slug: 'green', hex: '#2E7D32' },
  { name: 'Blue', slug: 'blue', hex: '#1565C0' },
  { name: 'Golden', slug: 'golden', hex: '#C9A227' },
  { name: 'Purple', slug: 'purple', hex: '#6A1B9A' },
  { name: 'Cream', slug: 'cream', hex: '#E8DCC8' },
  { name: 'Orange', slug: 'orange', hex: '#EF6C00' },
] as const;

const CATEGORIES = [
  { name: 'Designer', nameHi: 'डिज़ाइनर', slug: 'designer', order: 1 },
  { name: 'Bridal', nameHi: 'ब्राइडल', slug: 'bridal', order: 2 },
  { name: 'Silk', nameHi: 'सिल्क', slug: 'silk', order: 3 },
  { name: 'Party Wear', nameHi: 'पार्टी वेयर', slug: 'party-wear', order: 4 },
  { name: 'Simple', nameHi: 'सिंपल', slug: 'simple', order: 5 },
  { name: 'Embroidery', nameHi: 'कढ़ाई', slug: 'embroidery', order: 6 },
  { name: 'Traditional', nameHi: 'ट्रेडिशनल', slug: 'traditional', order: 7 },
  { name: 'Wedding', nameHi: 'शादी', slug: 'wedding', order: 8 },
  { name: 'Sleeveless', nameHi: 'स्लीवलेस', slug: 'sleeveless', order: 9 },
  { name: 'Full Sleeve', nameHi: 'फुल स्लीव', slug: 'full-sleeve', order: 10 },
  { name: 'Trending', nameHi: 'ट्रेंडिंग', slug: 'trending', order: 11 },
  { name: 'New Designs', nameHi: 'नए डिज़ाइन', slug: 'new-designs', order: 12 },
];

const FABRICS = [
  { name: 'Pure Silk', material: 'Silk', color: 'Red', priceInr: 449, embroidery: ['Zari'] },
  { name: 'Pure Silk', material: 'Silk', color: 'Maroon', priceInr: 449, embroidery: ['Zari', 'Thread'] },
  { name: 'Raw Silk', material: 'Raw Silk', color: 'Golden', priceInr: 399, embroidery: ['Zari'] },
  { name: 'Raw Silk', material: 'Raw Silk', color: 'Green', priceInr: 399, embroidery: ['Thread'] },
  { name: 'Cotton Silk', material: 'Cotton Silk', color: 'Cream', priceInr: 299, embroidery: [] },
  { name: 'Cotton Silk', material: 'Cotton Silk', color: 'Pink', priceInr: 299, embroidery: ['Thread'] },
  { name: 'Satin', material: 'Satin', color: 'Black', priceInr: 279, embroidery: [] },
  { name: 'Satin', material: 'Satin', color: 'Blue', priceInr: 279, embroidery: ['Sequin'] },
  { name: 'Velvet', material: 'Velvet', color: 'Maroon', priceInr: 499, embroidery: ['Stone', 'Pearl'] },
  { name: 'Velvet', material: 'Velvet', color: 'Purple', priceInr: 499, embroidery: ['Stone'] },
  { name: 'Brocade', material: 'Brocade', color: 'Golden', priceInr: 549, embroidery: ['Zari'] },
  { name: 'Net', material: 'Net', color: 'Pink', priceInr: 349, embroidery: ['Sequin', 'Mirror'] },
  { name: 'Organza', material: 'Organza', color: 'Cream', priceInr: 379, embroidery: ['Thread'] },
  { name: 'Designer Fabric', material: 'Designer', color: 'Red', priceInr: 649, embroidery: ['Aari', 'Mirror'] },
  { name: 'Designer Fabric', material: 'Designer', color: 'Green', priceInr: 649, embroidery: ['Aari', 'Stone'] },
];

const LACES = [
  {
    name: 'Golden Zari Lace',
    color: 'Golden',
    hex: '#C9A227',
    priceInr: 89,
    colors: [
      { name: 'Golden', hex: '#C9A227' },
      { name: 'Cream', hex: '#E8DCC8' },
      { name: 'Red', hex: '#C62828' },
    ],
  },
  {
    name: 'Pearl Border Lace',
    color: 'Cream',
    hex: '#E8DCC8',
    priceInr: 129,
    colors: [
      { name: 'Cream', hex: '#E8DCC8' },
      { name: 'Ivory', hex: '#F5F0E6' },
      { name: 'Coral', hex: '#FF7F50' },
    ],
  },
  {
    name: 'Mirror Work Lace',
    color: 'Golden',
    hex: '#D4AF37',
    priceInr: 149,
    colors: [
      { name: 'Golden', hex: '#D4AF37' },
      { name: 'Blue', hex: '#1565C0' },
      { name: 'Silver', hex: '#C0C0C0' },
    ],
  },
  {
    name: 'Red Thread Lace',
    color: 'Red',
    hex: '#C62828',
    priceInr: 69,
    colors: [
      { name: 'Red', hex: '#C62828' },
      { name: 'Maroon', hex: '#7B1E3B' },
      { name: 'Pink', hex: '#EC4E8B' },
    ],
  },
  {
    name: 'Silver Sequin Lace',
    color: 'Cream',
    hex: '#C0C0C0',
    priceInr: 119,
    colors: [
      { name: 'Silver', hex: '#C0C0C0' },
      { name: 'Ivory', hex: '#F5F0E6' },
      { name: 'Teal', hex: '#00695C' },
    ],
  },
  {
    name: 'Velvet Piping Lace',
    color: 'Maroon',
    hex: '#7B1E3B',
    priceInr: 99,
    colors: [
      { name: 'Maroon', hex: '#7B1E3B' },
      { name: 'Black', hex: '#263238' },
      { name: 'Forest', hex: '#2E5D2E' },
    ],
  },
];

const LATKANS = [
  {
    name: 'Pearl Tassel Latkan',
    color: 'Cream',
    hex: '#E8DCC8',
    priceInr: 149,
    colors: [
      { name: 'Cream', hex: '#E8DCC8' },
      { name: 'Ivory', hex: '#F5F0E6' },
      { name: 'Coral', hex: '#FF7F50' },
    ],
  },
  {
    name: 'Golden Bell Latkan',
    color: 'Golden',
    hex: '#C9A227',
    priceInr: 179,
    colors: [
      { name: 'Golden', hex: '#C9A227' },
      { name: 'Red', hex: '#C62828' },
      { name: 'Maroon', hex: '#7B1E3B' },
    ],
  },
  {
    name: 'Mirror Dangler Latkan',
    color: 'Golden',
    hex: '#D4AF37',
    priceInr: 199,
    colors: [
      { name: 'Golden', hex: '#D4AF37' },
      { name: 'Silver', hex: '#C0C0C0' },
      { name: 'Blue', hex: '#1565C0' },
    ],
  },
  {
    name: 'Maroon Silk Latkan',
    color: 'Maroon',
    hex: '#7B1E3B',
    priceInr: 129,
    colors: [
      { name: 'Maroon', hex: '#7B1E3B' },
      { name: 'Black', hex: '#263238' },
      { name: 'Pink', hex: '#EC4E8B' },
    ],
  },
  {
    name: 'Silver Jhumka Latkan',
    color: 'Silver',
    hex: '#C0C0C0',
    priceInr: 219,
    colors: [
      { name: 'Silver', hex: '#C0C0C0' },
      { name: 'Ivory', hex: '#F5F0E6' },
      { name: 'Teal', hex: '#00695C' },
    ],
  },
  {
    name: 'Zari Pendant Latkan',
    color: 'Red',
    hex: '#C62828',
    priceInr: 169,
    colors: [
      { name: 'Red', hex: '#C62828' },
      { name: 'Golden', hex: '#C9A227' },
      { name: 'Maroon', hex: '#7B1E3B' },
    ],
  },
];

/** README §19–20 — every field is admin-editable; these are sane starters. */
const MEASUREMENT_FIELDS = [
  {
    key: 'bust',
    label: 'Bust',
    labelHi: 'Chaati ka sabse chauda part',
    instruction: 'Measuring tape ko bust ke fullest part ke around comfortably rakhein. Tape na zyada tight ho, na dheela.',
    minInch: 24,
    maxInch: 60,
    order: 1,
  },
  {
    key: 'under_bust',
    label: 'Under Bust',
    labelHi: 'Bust ke theek neeche',
    instruction: 'Bust ke theek neeche, ribcage ke around tape ghumayein.',
    minInch: 22,
    maxInch: 56,
    order: 2,
  },
  {
    key: 'waist',
    label: 'Waist',
    labelHi: 'Kamar ka sabse patla part',
    instruction: 'Kamar ke sabse patle hisse par tape rakhein. Saans normal rakhein.',
    minInch: 20,
    maxInch: 56,
    order: 3,
  },
  {
    key: 'shoulder',
    label: 'Shoulder',
    labelHi: 'Ek kandhe se dusre kandhe tak',
    instruction: 'Peeche ki taraf se ek shoulder ke end se dusre shoulder ke end tak measure karein.',
    minInch: 10,
    maxInch: 22,
    order: 4,
  },
  {
    key: 'blouse_length',
    label: 'Blouse Length',
    labelHi: 'Blouse ki lambai',
    instruction: 'Shoulder ke highest point se neeche jitni length chahiye wahan tak measure karein.',
    minInch: 10,
    maxInch: 30,
    order: 5,
  },
  {
    key: 'sleeve_length',
    label: 'Sleeve Length',
    labelHi: 'Baazu ki lambai',
    instruction: 'Shoulder se sleeve ke end tak measure karein.',
    minInch: 2,
    maxInch: 26,
    order: 6,
  },
  {
    key: 'armhole',
    label: 'Armhole',
    labelHi: 'Baazu ka ghera',
    instruction: 'Baazu ke around, armpit se upar hoke poora ghera measure karein.',
    minInch: 10,
    maxInch: 26,
    order: 7,
  },
  {
    key: 'upper_arm',
    label: 'Upper Arm',
    labelHi: 'Baazu ka sabse mota hissa',
    instruction: 'Upper arm ke sabse mote hisse ka ghera lein.',
    minInch: 8,
    maxInch: 24,
    order: 8,
  },
  {
    key: 'sleeve_opening',
    label: 'Sleeve Opening',
    labelHi: 'Sleeve ka khula hissa',
    instruction: 'Sleeve jahan khatam hoti hai wahan ka ghera measure karein.',
    minInch: 6,
    maxInch: 20,
    order: 9,
    required: false,
  },
  {
    key: 'front_neck_depth',
    label: 'Front Neck Depth',
    labelHi: 'Aage ka gala kitna gehra',
    instruction: 'Kandhe ki line se aage ke gale ki gehrai tak measure karein.',
    minInch: 3,
    maxInch: 16,
    order: 10,
  },
  {
    key: 'back_neck_depth',
    label: 'Back Neck Depth',
    labelHi: 'Peeche ka gala kitna gehra',
    instruction: 'Kandhe ki line se peeche ke gale ki gehrai tak measure karein.',
    minInch: 3,
    maxInch: 20,
    order: 11,
  },
];

interface DesignSpec {
  name: string;
  category: string;
  type: 'READY_MADE' | 'CUSTOMIZE' | 'SHOWCASE';
  mrp: number;
  price: number;
  colors: string[];
  embroidery: string[];
  fabricInfo: string;
  tags: string[];
}

const DESIGNS: DesignSpec[] = [
  { name: 'Zari Border Designer Blouse', category: 'designer', type: 'READY_MADE', mrp: 1199, price: 899, colors: ['red', 'maroon', 'black'], embroidery: ['Zari'], fabricInfo: 'Art silk with zari border', tags: ['designer', 'zari', 'silk'] },
  { name: 'Elbow Sleeve Silk Blouse', category: 'silk', type: 'READY_MADE', mrp: 999, price: 749, colors: ['green', 'blue', 'maroon'], embroidery: [], fabricInfo: 'Pure silk, soft finish', tags: ['silk', 'simple'] },
  { name: 'Mirror Work Party Blouse', category: 'party-wear', type: 'READY_MADE', mrp: 1599, price: 1149, colors: ['black', 'pink', 'blue'], embroidery: ['Mirror', 'Sequin'], fabricInfo: 'Net with mirror work', tags: ['party-wear', 'mirror', 'net'] },
  { name: 'Simple Cotton Daily Blouse', category: 'simple', type: 'READY_MADE', mrp: 599, price: 399, colors: ['cream', 'pink', 'green'], embroidery: [], fabricInfo: 'Soft cotton, daily wear', tags: ['simple', 'cotton'] },
  { name: 'Golden Brocade Blouse', category: 'traditional', type: 'READY_MADE', mrp: 1799, price: 1349, colors: ['golden', 'maroon'], embroidery: ['Zari'], fabricInfo: 'Brocade with woven zari', tags: ['traditional', 'brocade', 'golden'] },
  { name: 'Sleeveless Satin Blouse', category: 'sleeveless', type: 'READY_MADE', mrp: 899, price: 649, colors: ['black', 'blue', 'purple'], embroidery: [], fabricInfo: 'Satin, smooth finish', tags: ['sleeveless', 'satin'] },
  { name: 'Thread Work Full Sleeve Blouse', category: 'full-sleeve', type: 'READY_MADE', mrp: 1299, price: 949, colors: ['maroon', 'green', 'cream'], embroidery: ['Thread'], fabricInfo: 'Cotton silk with thread work', tags: ['full-sleeve', 'thread'] },
  { name: 'Peacock Motif Silk Blouse', category: 'silk', type: 'READY_MADE', mrp: 1499, price: 1099, colors: ['blue', 'green', 'purple'], embroidery: ['Zari', 'Thread'], fabricInfo: 'Kanjeevaram style silk', tags: ['silk', 'designer'] },
  { name: 'Pearl Neck Designer Blouse', category: 'designer', type: 'READY_MADE', mrp: 1699, price: 1249, colors: ['cream', 'pink', 'maroon'], embroidery: ['Pearl', 'Stone'], fabricInfo: 'Raw silk with pearl neckline', tags: ['designer', 'pearl'] },
  { name: 'Velvet Wedding Blouse', category: 'wedding', type: 'READY_MADE', mrp: 2199, price: 1699, colors: ['maroon', 'purple', 'red'], embroidery: ['Stone', 'Zari'], fabricInfo: 'Velvet with heavy zari', tags: ['wedding', 'velvet'] },
  { name: 'Boat Neck Cotton Blouse', category: 'simple', type: 'READY_MADE', mrp: 649, price: 449, colors: ['cream', 'blue', 'orange'], embroidery: [], fabricInfo: 'Cotton, boat neck', tags: ['simple', 'cotton'] },
  { name: 'Aari Work Bridal Blouse', category: 'bridal', type: 'READY_MADE', mrp: 3499, price: 2799, colors: ['red', 'maroon'], embroidery: ['Aari', 'Stone', 'Pearl'], fabricInfo: 'Heavy aari embroidery on silk', tags: ['bridal', 'aari', 'heavy'] },

  { name: 'Custom Bridal Aari Blouse', category: 'bridal', type: 'CUSTOMIZE', mrp: 3999, price: 2999, colors: ['red', 'maroon', 'pink'], embroidery: ['Aari', 'Stone'], fabricInfo: 'Aapka fabric, hamari silai', tags: ['bridal', 'custom', 'aari'] },
  { name: 'Custom Designer Zari Blouse', category: 'designer', type: 'CUSTOMIZE', mrp: 1999, price: 1499, colors: ['golden', 'maroon', 'green'], embroidery: ['Zari'], fabricInfo: 'Fabric choose karein, measurement dein', tags: ['designer', 'custom'] },
  { name: 'Custom Silk Princess Cut Blouse', category: 'silk', type: 'CUSTOMIZE', mrp: 1799, price: 1299, colors: ['blue', 'green', 'purple'], embroidery: ['Thread'], fabricInfo: 'Princess cut, perfect fitting', tags: ['silk', 'custom'] },
  { name: 'Custom Party Wear Blouse', category: 'party-wear', type: 'CUSTOMIZE', mrp: 1899, price: 1399, colors: ['black', 'pink', 'blue'], embroidery: ['Sequin', 'Mirror'], fabricInfo: 'Party ke liye special', tags: ['party-wear', 'custom'] },
  { name: 'Custom Simple Daily Blouse', category: 'simple', type: 'CUSTOMIZE', mrp: 899, price: 649, colors: ['cream', 'pink', 'green'], embroidery: [], fabricInfo: 'Roz pehnne ke liye aaramdayak', tags: ['simple', 'custom'] },
  { name: 'Custom Wedding Velvet Blouse', category: 'wedding', type: 'CUSTOMIZE', mrp: 2999, price: 2249, colors: ['maroon', 'purple', 'red'], embroidery: ['Stone', 'Zari'], fabricInfo: 'Velvet, shaadi ke liye', tags: ['wedding', 'custom', 'velvet'] },
  { name: 'Custom Embroidery Puff Sleeve Blouse', category: 'embroidery', type: 'CUSTOMIZE', mrp: 1699, price: 1249, colors: ['pink', 'cream', 'blue'], embroidery: ['Thread', 'Pearl'], fabricInfo: 'Puff sleeve, trending design', tags: ['embroidery', 'custom', 'trending'] },
  { name: 'Custom Traditional Kanjeevaram Blouse', category: 'traditional', type: 'CUSTOMIZE', mrp: 2199, price: 1649, colors: ['golden', 'red', 'green'], embroidery: ['Zari'], fabricInfo: 'Traditional South Indian style', tags: ['traditional', 'custom'] },
  { name: 'Custom Full Sleeve Formal Blouse', category: 'full-sleeve', type: 'CUSTOMIZE', mrp: 1399, price: 999, colors: ['black', 'maroon', 'cream'], embroidery: [], fabricInfo: 'Full sleeve, formal look', tags: ['full-sleeve', 'custom'] },

  { name: 'Upcoming Peacock Bridal Blouse', category: 'new-designs', type: 'SHOWCASE', mrp: 4499, price: 3599, colors: ['green', 'blue', 'golden'], embroidery: ['Aari', 'Stone', 'Pearl'], fabricInfo: 'Heavy peacock motif, hand embroidery', tags: ['upcoming', 'bridal'] },
  { name: 'Upcoming Floral Organza Blouse', category: 'new-designs', type: 'SHOWCASE', mrp: 1999, price: 1599, colors: ['pink', 'cream'], embroidery: ['Thread'], fabricInfo: 'Organza with floral thread work', tags: ['upcoming', 'organza'] },
  { name: 'Upcoming Mirror Cape Blouse', category: 'trending', type: 'SHOWCASE', mrp: 2799, price: 2199, colors: ['black', 'red'], embroidery: ['Mirror', 'Sequin'], fabricInfo: 'Cape style with mirror work', tags: ['upcoming', 'trending'] },
  { name: 'Upcoming Kundan Neck Blouse', category: 'trending', type: 'SHOWCASE', mrp: 3299, price: 2599, colors: ['maroon', 'golden'], embroidery: ['Stone', 'Pearl'], fabricInfo: 'Kundan style neckline', tags: ['upcoming', 'trending'] },
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Deterministic pseudo-random so reseeding gives a stable-looking catalogue. */
function seededInt(seed: number, min: number, max: number): number {
  const x = Math.sin(seed * 9973) * 10_000;
  const fraction = x - Math.floor(x);
  return Math.floor(fraction * (max - min + 1)) + min;
}

/** Assumes an open Mongoose connection; the caller owns its lifecycle. */
export async function seedDatabase(): Promise<void> {
  logger.info('seeding — existing catalogue will be replaced');

  await Promise.all([
    Category.deleteMany({}),
    Fabric.deleteMany({}),
    Lace.deleteMany({}),
    Latkan.deleteMany({}),
    Product.deleteMany({}),
    MeasurementField.deleteMany({}),
    Coupon.deleteMany({}),
  ]);

  const categories = await Category.insertMany(
    CATEGORIES.map((c) => ({ ...c, types: ['READY_MADE', 'CUSTOMIZE', 'SHOWCASE'], isActive: true })),
  );
  const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));

  const fabrics = await Fabric.insertMany(
    FABRICS.map((f, index) => {
      const color = COLORS.find((c) => c.name === f.color)!;
      return {
        name: f.name,
        slug: slugify(`${f.name}-${f.color}`),
        material: f.material,
        colorName: color.name,
        colorSlug: color.slug,
        colorHex: color.hex,
        embroidery: f.embroidery,
        priceInr: f.priceInr,
        image: `gs-art:${index % 6}:${slugify(f.name)}:fabric`,
        inStock: index !== 5, // one out-of-stock fabric so the UI state is visible
        stockMeters: index === 5 ? 0 : 40,
        order: index,
        isActive: true,
      };
    }),
  );

  const laces = await Lace.insertMany(
    LACES.map((l, index) => ({
      name: l.name,
      slug: slugify(l.name),
      colorName: l.color,
      colorHex: l.hex,
      colors: l.colors ?? [],
      priceInr: l.priceInr,
      image: `gs-art:${index % 6}:${slugify(l.name)}:lace`,
      inStock: true,
      order: index,
      isActive: true,
    })),
  );

  const latkans = await Latkan.insertMany(
    LATKANS.map((l, index) => ({
      name: l.name,
      slug: slugify(l.name),
      colorName: l.color,
      colorHex: l.hex,
      colors: l.colors ?? [],
      priceInr: l.priceInr,
      image: `gs-art:${index % 6}:${slugify(l.name)}:latkan`,
      inStock: true,
      order: index,
      isActive: true,
    })),
  );

  await MeasurementField.insertMany(
    MEASUREMENT_FIELDS.map((field) => ({
      ...field,
      required: field.required ?? true,
      gifUrl: '',
      imageUrl: `gs-art:0:${field.key}:measure`,
      isActive: true,
    })),
  );

  const imageKinds = ['front', 'back', 'side', 'sleeve', 'fabric', 'embroidery', 'model'] as const;

  const products = DESIGNS.map((design, index) => {
    const designId = `GS-${200 + index}`;
    const slug = `${slugify(design.name)}-${designId.toLowerCase()}`;
    const category = categoryBySlug.get(design.category)!;
    const colors = design.colors.map((slugName) => COLORS.find((c) => c.slug === slugName)!);
    const isReadyMade = design.type === 'READY_MADE';
    const sizes = isReadyMade ? [...DEFAULT_SIZES].slice(0, 5) : [];

    const variants = isReadyMade
      ? colors.flatMap((color, ci) =>
          sizes.map((size, si) => ({
            colorSlug: color.slug,
            size,
            // A deliberate scatter of zero and low stock so "Out of Stock" and
            // "Only 2 left" both show up in the demo data.
            stock: seededInt(index * 100 + ci * 10 + si, 0, 8),
            sku: `${designId}-${color.slug.toUpperCase().slice(0, 3)}-${size}`,
          })),
        )
      : [];

    return {
      designId,
      slug,
      name: design.name,
      description: `${design.name} — ${design.fabricInfo}. Guddi Silai ki taraf se careful stitching aur finishing ke saath. ${
        design.type === 'CUSTOMIZE'
          ? 'Apna fabric choose karein aur measurement dekar apne naap ka blouse banwayein.'
          : design.type === 'SHOWCASE'
            ? 'Yeh design jald hi available hoga. Pasand aaye to WhatsApp par batayein.'
            : 'Ready stock, turant delivery.'
      }`,
      type: design.type,
      category: category._id,
      tags: design.tags,
      mrpInr: design.mrp,
      sellingPriceInr: design.price,
      images: imageKinds.map((kind, ki) => ({
        url: `gs-art:${index % 6}:${designId}:${kind}`,
        alt: `${design.name} — ${kind} view`,
        kind,
        width: 900,
        height: 1200,
        publicId: '',
      })),
      colors: colors.map((c) => ({ name: c.name, slug: c.slug, hex: c.hex })),
      sizes,
      variants,
      fabricOptions: design.type === 'CUSTOMIZE' ? fabrics.map((f) => f._id) : [],
      laceOptions: design.type === 'CUSTOMIZE' ? laces.map((l) => l._id) : [],
      minFabricCount: 1,
      maxFabricCount: 1,
      minLaceCount: 1,
      maxLaceCount: 1,
      minLatkanCount: 1,
      maxLatkanCount: 1,
      stitchingChargeInr: design.type === 'CUSTOMIZE' ? 249 : 0,
      fabricInfo: design.fabricInfo,
      embroidery: design.embroidery,
      careInstructions: 'Dry clean recommended. Pehli baar dhone se pehle alag se dhoyein. Tez dhoop mein na sukhayein.',
      stitchingInfo:
        design.type === 'CUSTOMIZE'
          ? 'Aapke measurement ke hisaab se silai. Lagbhag 7-10 din lagenge.'
          : 'Ready stitched blouse, standard Indian sizes.',
      stitchingDays: design.type === 'CUSTOMIZE' ? 9 : 2,
      expectedAvailability: design.type === 'SHOWCASE' ? 'Agle mahine tak' : '',
      comingSoon: design.type === 'SHOWCASE',
      rating: {
        average: design.type === 'SHOWCASE' ? 0 : seededInt(index + 7, 40, 50) / 10,
        count: design.type === 'SHOWCASE' ? 0 : seededInt(index + 13, 5, 120),
      },
      stats: {
        views: seededInt(index + 3, 200, 12_000),
        uniqueViews: seededInt(index + 5, 100, 6000),
        clicks: seededInt(index + 11, 50, 3000),
        totalViewMs: seededInt(index + 17, 60_000, 900_000),
        viewSessions: seededInt(index + 19, 20, 600),
        zooms: seededInt(index + 23, 5, 400),
        wishlists: seededInt(index + 29, 10, 900),
        cartAdds: seededInt(index + 31, 5, 450),
        buyNows: seededInt(index + 37, 2, 200),
        orders: seededInt(index + 41, 0, 90),
        whatsappEnquiries: seededInt(index + 43, 3, 200),
        shares: seededInt(index + 47, 1, 120),
      },
      seo: {
        title: `${design.name} | Guddi Silai`,
        description: `${design.name} — ${design.fabricInfo}. ₹${design.price} mein online order karein.`,
        keywords: [...design.tags, 'blouse', 'blouse design', designId.toLowerCase()],
        ogImage: '',
      },
      isActive: true,
      publishedAt: new Date(Date.now() - index * 36 * 60 * 60 * 1000),
    };
  });

  await Product.insertMany(products);

  await Coupon.insertMany([
    {
      code: 'WELCOME10',
      description: 'Pehle order par 10% off',
      type: 'PERCENT',
      value: 10,
      minOrderInr: 799,
      maxDiscountInr: 300,
      isActive: true,
    },
    {
      code: 'FIRSTORDER',
      description: '₹150 off',
      type: 'FIXED',
      value: 150,
      minOrderInr: 999,
      isActive: true,
    },
    {
      code: 'BRIDAL20',
      description: 'Bridal blouses par 20% off',
      type: 'PERCENT',
      value: 20,
      minOrderInr: 1999,
      maxDiscountInr: 1000,
      isActive: true,
    },
  ]);

  // Settings rows exist so the admin panel has something to edit; each falls
  // back to its env value until changed.
  await Setting.bulkWrite(
    [
      { key: 'measurementInstructionVersion', value: 'v1' },
    ].map((doc) => ({
      updateOne: { filter: { key: doc.key }, update: { $set: doc }, upsert: true },
    })),
  );

  if (env.ADMIN_MOBILE) {
    // Older deployments may have created email/google indexes without sparse
    // options, which makes multiple OTP-only users collide on null values.
    await User.syncIndexes();
    await User.findOneAndUpdate(
      { mobile: env.ADMIN_MOBILE },
      { $set: { mobile: env.ADMIN_MOBILE, mobileVerified: true, adminRoles: ['SUPER_ADMIN'], isBlocked: false } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    logger.info({ mobile: env.ADMIN_MOBILE.slice(-4) }, 'admin account seeded');
  } else {
    logger.warn('ADMIN_MOBILE not set — no SUPER_ADMIN was created. The admin panel will be inaccessible.');
  }

  logger.info(
    {
      categories: categories.length,
      fabrics: fabrics.length,
      laces: laces.length,
      products: products.length,
      measurementFields: MEASUREMENT_FIELDS.length,
    },
    'seed complete',
  );
}
