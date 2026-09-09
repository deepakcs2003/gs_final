import { Types } from 'mongoose';

/**
 * Keyset ("cursor") pagination (README §5).
 *
 * Offset pagination degrades badly — page 40 of 1000 products makes Mongo walk
 * every skipped document, and rows shift under the reader when new products are
 * added mid-scroll. A keyset cursor is O(1) on an index and stable, which is
 * what makes infinite scroll feel instant at 1000 products.
 *
 * The cursor is opaque to the client but never trusted: it is re-validated into
 * a primitive value plus a real ObjectId before it can touch a query.
 */

export interface DecodedCursor {
  value: number | string;
  id: Types.ObjectId;
}

export function encodeCursor(value: number | string | Date, id: unknown): string {
  const serialised = value instanceof Date ? value.getTime() : value;
  return Buffer.from(JSON.stringify({ v: serialised, i: String(id) }), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | undefined): DecodedCursor | null {
  if (!raw) return null;
  // Cap the input before parsing — an unbounded base64 blob is free work for us.
  if (raw.length > 512) return null;

  try {
    const json: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof json !== 'object' || json === null) return null;

    const { v, i } = json as { v?: unknown; i?: unknown };
    if (typeof i !== 'string' || !Types.ObjectId.isValid(i)) return null;
    if (typeof v !== 'number' && typeof v !== 'string') return null;
    if (typeof v === 'string' && v.length > 120) return null;

    return { value: v, id: new Types.ObjectId(i) };
  } catch {
    return null;
  }
}

export type SortDirection = 1 | -1;

/**
 * Builds the "everything strictly after this point" filter for a compound
 * (sortField, _id) key.
 */
export function cursorFilter(
  field: string,
  direction: SortDirection,
  cursor: DecodedCursor,
): Record<string, unknown> {
  const op = direction === -1 ? '$lt' : '$gt';
  return {
    $or: [
      { [field]: { [op]: cursor.value } },
      { [field]: cursor.value, _id: { [op]: cursor.id } },
    ],
  };
}
