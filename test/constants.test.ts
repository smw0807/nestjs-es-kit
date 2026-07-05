import { describe, expect, it } from 'vitest';

import { getIndexServiceToken } from '../src/constants.js';

describe('getIndexServiceToken', () => {
  it('returns a stable token for the same schema target', () => {
    const target = { name: 'Product' };

    expect(getIndexServiceToken(target)).toBe(getIndexServiceToken(target));
  });

  it('does not collide for different schema targets with the same name', () => {
    const first = { name: 'Product' };
    const second = { name: 'Product' };

    expect(getIndexServiceToken(first)).not.toBe(getIndexServiceToken(second));
  });
});
