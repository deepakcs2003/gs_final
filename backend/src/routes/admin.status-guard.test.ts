import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { productSchema, shouldBlockOrderStatusMutation } from './admin.js';

describe('shouldBlockOrderStatusMutation', () => {
  it('allows changes on confirmed orders even when refund status is pending', () => {
    assert.equal(
      shouldBlockOrderStatusMutation({
        status: 'CONFIRMED',
        cancellation: { refund: { status: 'PENDING' } },
      }),
      false,
    );
  });

  it('blocks changes only when the order is cancelled and refund is not completed', () => {
    assert.equal(
      shouldBlockOrderStatusMutation({
        status: 'CANCELLED',
        cancellation: { refund: { status: 'PENDING' } },
      }),
      true,
    );
  });

  it('allows status edits after refund is completed', () => {
    assert.equal(
      shouldBlockOrderStatusMutation({
        status: 'CANCELLED',
        cancellation: { refund: { status: 'COMPLETED' } },
      }),
      false,
    );
  });
});

describe('productSchema', () => {
  it('accepts lace and latkan counts of zero', () => {
    const result = productSchema.safeParse({
      name: 'Test Product',
      sellingPriceInr: 1200,
      images: [{ url: 'https://example.com/image.jpg' }],
      minFabricCount: 1,
      maxFabricCount: 2,
      minLaceCount: 0,
      maxLaceCount: 0,
      minLatkanCount: 0,
      maxLatkanCount: 0,
    });

    assert.equal(result.success, true, result.success ? 'ok' : String(result.error));
  });
});
