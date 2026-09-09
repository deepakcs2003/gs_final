import fs from 'node:fs';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Order } from '../models/commerce.js';

/**
 * One-off maintenance script: finds order documents that are missing required
 * subdocuments (contact / items / amounts / payment) — the ones that crashed
 * the admin Orders and Payments pages — and removes them. A JSON backup is
 * written locally before deletion.
 * Run: npm run fix-orders --workspace backend
 */
async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
  const total = await Order.countDocuments();

  const malformed = await Order.find({
    $or: [
      { contact: { $exists: false } },
      { contact: null },
      { items: { $exists: false } },
      { items: { $size: 0 } },
      { amounts: { $exists: false } },
      { amounts: null },
      { payment: { $exists: false } },
      { payment: null },
      { status: { $exists: false } },
    ],
  })
    .lean();

  console.log(`Total orders in DB: ${total}`);
  if (malformed.length === 0) {
    console.log('Koi malformed order nahi mila — kuch delete nahi hua.');
    await mongoose.disconnect();
    return;
  }

  const summary = malformed.map((o) => ({
    _id: String(o._id),
    orderNumber: o.orderNumber ?? null,
    placedAt: o.placedAt ?? null,
    status: o.status ?? null,
    hasContact: Boolean(o.contact),
    items: Array.isArray(o.items) ? o.items.length : null,
    hasAmounts: Boolean(o.amounts),
    hasPayment: Boolean(o.payment),
  }));

  console.log(`Malformed orders: ${summary.length}`);
  console.table(summary);

  const backupPath =
    process.env.BACKUP_PATH ?? (process.cwd().endsWith('backend') ? 'deleted-orders-backup.json' : 'backend/deleted-orders-backup.json');
  fs.writeFileSync(backupPath, JSON.stringify(malformed, null, 2));
  console.log(`Backup saved: ${backupPath}`);

  const ids = malformed.map((o) => o._id);
  const result = await Order.deleteMany({ _id: { $in: ids } });
  console.log(`Deleted: ${result.deletedCount}`);
  console.log(`Remaining orders: ${await Order.countDocuments()}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});