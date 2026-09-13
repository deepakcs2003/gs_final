import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shouldBlockOrderStatusMutation } from './admin';

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
