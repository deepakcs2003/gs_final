import fs from 'node:fs';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Order } from '../models/commerce.js';

/**
 * Launch-prep cleanup ("npm run clean:test-data --workspace backend").
 *
 * Removes artifacts left behind by automated E2E / UI testing from the
 * database, so a fresh deployment does not ship with fake orders or reviews.
 * The real catalogue, coupons, offers and banners are never touched.
 *
 * Safeguards:
 *  - prints a manifest of what it WOULD delete and requires --confirm to act
 *  - writes a JSON backup of every deleted document next to the script
 *  - dry-run by default: `npm run clean:test-data` just reports
 *
 * Run:
 *   npm run clean:test-data --workspace backend           # dry run
 *   npm run clean:test-data --workspace backend --confirm # delete + backup
 */
const CONFIRM = process.argv.includes('--confirm');

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
  const db = mongoose.connection.db;
  if (!db) {
    console.error('No database connection.');
    process.exit(1);
  }

  // Orders the automation generated. A whitelist so no real order is caught.
  const testOrders = await Order.find({ orderNumber: /^(GSMTU|GSMTV|GS-MT)/ }).lean();

  // Reviews the harness wrote (always rejected by the moderation flow).
  const testReviews = await db.collection('reviews').find({ name: /^guest aaa$|^guest bbb$|e2e/i }).toArray();

  const manifest = [
    ...testOrders.map((o) => ({ collection: 'orders', _id: o._id, label: String(o.orderNumber) })),
    ...testReviews.map((r) => ({ collection: 'reviews', _id: r._id, label: String((r as { name?: string }).name) })),
  ];

  console.log(`Found ${manifest.length} test artifact(s).`);

  if (manifest.length === 0) {
    console.log('Kuch nahi mila — kuch delete nahi hua.');
    await mongoose.disconnect();
    return;
  }

  for (const m of manifest) {
    console.log(`  delete [${m.collection}] ${m.label}`);
  }

  if (!CONFIRM) {
    console.log('\nDry run. Pass --confirm to delete (a JSON backup is written first).');
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = new URL(`./deleted-test-data-${stamp}.json`, import.meta.url);
  fs.writeFileSync(backupPath, JSON.stringify(manifest, null, 2), 'utf8');

  const byCollection = new Map<string, mongoose.Types.ObjectId[]>();
  for (const m of manifest) {
    const list = byCollection.get(m.collection) ?? [];
    list.push(m._id as mongoose.Types.ObjectId);
    byCollection.set(m.collection, list);
  }

  for (const [collection, ids] of byCollection) {
    const res = await db.collection(collection).deleteMany({ _id: { $in: ids } });
    console.log(`  removed ${res.deletedCount} from ${collection}`);
  }

  console.log(`Backup written: ${backupPath.pathname}`);
  await mongoose.disconnect();
}

main().catch((err: unknown) => {
  console.error('clean failed:', err);
  process.exit(1);
});