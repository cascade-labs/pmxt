import type { OrderIntent } from 'polymarket-us';
import {
  POLYMARKET_US_MAX_PRICE,
  POLYMARKET_US_MIN_PRICE,
  fromAmount,
  fromLongSidePrice,
  roundToTickSize,
  toAmount,
  toLongSidePrice,
  validatePriceBounds,
} from './price';

describe('roundToTickSize', () => {
  it('is idempotent for 0.123 at the default 0.001 tick', () => {
    expect(roundToTickSize(0.123)).toBe(0.123);
  });

  it('rounds 0.1234 down to 0.123 at default tick', () => {
    expect(roundToTickSize(0.1234)).toBe(0.123);
  });

  it('rounds 0.1235 up to 0.124 (Math.round half-away-from-zero)', () => {
    expect(roundToTickSize(0.1235)).toBe(0.124);
  });

  it('rounds 0.9999 up to 1.000 (out of bounds, validation is separate)', () => {
    expect(roundToTickSize(0.9999)).toBe(1.0);
  });

  it('is idempotent for 0.55', () => {
    expect(roundToTickSize(0.55)).toBe(0.55);
  });

  it('handles floating-point drift cleanly', () => {
    // 0.1 + 0.2 = 0.30000000000000004
    expect(roundToTickSize(0.1 + 0.2)).toBe(0.3);
  });

  it('honours an explicit tick-size override (0.01)', () => {
    expect(roundToTickSize(0.123, 0.01)).toBe(0.12);
    expect(roundToTickSize(0.125, 0.01)).toBe(0.13);
  });
});

describe('validatePriceBounds', () => {
  it.each([
    POLYMARKET_US_MIN_PRICE,
    0.5,
    POLYMARKET_US_MAX_PRICE,
  ])('accepts %s', (price) => {
    expect(() => validatePriceBounds(price)).not.toThrow();
  });

  it.each([
    0.0,
    0.001,
    1.0,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('throws RangeError for %s', (price) => {
    expect(() => validatePriceBounds(price)).toThrow(RangeError);
  });
});

describe('toLongSidePrice', () => {
  it('returns user price unchanged for BUY_LONG', () => {
    expect(toLongSidePrice('ORDER_INTENT_BUY_LONG', 0.55)).toBe(0.55);
  });

  it('returns user price unchanged for SELL_LONG', () => {
    expect(toLongSidePrice('ORDER_INTENT_SELL_LONG', 0.55)).toBe(0.55);
  });

  it('inverts user price for BUY_SHORT', () => {
    expect(toLongSidePrice('ORDER_INTENT_BUY_SHORT', 0.4)).toBeCloseTo(0.6, 10);
  });

  it('inverts user price for SELL_SHORT', () => {
    expect(toLongSidePrice('ORDER_INTENT_SELL_SHORT', 0.4)).toBeCloseTo(0.6, 10);
  });

  it('throws on out-of-bounds input (LONG)', () => {
    expect(() => toLongSidePrice('ORDER_INTENT_BUY_LONG', 1.5)).toThrow(RangeError);
    expect(() => toLongSidePrice('ORDER_INTENT_BUY_LONG', 0)).toThrow(RangeError);
  });

  it('throws on out-of-bounds input (SHORT)', () => {
    expect(() => toLongSidePrice('ORDER_INTENT_BUY_SHORT', 1.5)).toThrow(RangeError);
    expect(() => toLongSidePrice('ORDER_INTENT_SELL_SHORT', 0)).toThrow(RangeError);
  });

  it('throws on NaN', () => {
    expect(() => toLongSidePrice('ORDER_INTENT_BUY_LONG', Number.NaN)).toThrow(
      RangeError,
    );
  });
});

describe('fromLongSidePrice (round trip)', () => {
  const intents: OrderIntent[] = [
    'ORDER_INTENT_BUY_LONG',
    'ORDER_INTENT_SELL_LONG',
    'ORDER_INTENT_BUY_SHORT',
    'ORDER_INTENT_SELL_SHORT',
  ];
  const prices = [0.01, 0.25, 0.5, 0.75, 0.99];

  for (const intent of intents) {
    for (const price of prices) {
      it(`round-trips ${price} for ${intent}`, () => {
        const longPrice = toLongSidePrice(intent, price);
        const userPrice = fromLongSidePrice(intent, longPrice);
        expect(userPrice).toBeCloseTo(price, 10);
      });
    }
  }

  it('throws on out-of-bounds input', () => {
    expect(() => fromLongSidePrice('ORDER_INTENT_BUY_LONG', 1.5)).toThrow(
      RangeError,
    );
  });
});

describe('toAmount', () => {
  it('formats 0.55 to { value: "0.550", currency: "USD" } at 3-decimal precision', () => {
    expect(toAmount(0.55)).toEqual({ value: '0.550', currency: 'USD' });
  });

  it('keeps 0.123 as "0.123" at the default 0.001 tick', () => {
    expect(toAmount(0.123)).toEqual({ value: '0.123', currency: 'USD' });
  });

  it('rounds 0.1234 down to "0.123"', () => {
    expect(toAmount(0.1234)).toEqual({ value: '0.123', currency: 'USD' });
  });

  it('honours an explicit 0.01 tick override', () => {
    expect(toAmount(0.123, 0.01)).toEqual({ value: '0.120', currency: 'USD' });
  });

  it('throws for 0.0 (below min)', () => {
    expect(() => toAmount(0.0)).toThrow(RangeError);
  });

  it('throws for 1.0 (above max)', () => {
    expect(() => toAmount(1.0)).toThrow(RangeError);
  });

  it('throws for NaN', () => {
    expect(() => toAmount(Number.NaN)).toThrow(RangeError);
  });

  it('throws for Infinity', () => {
    expect(() => toAmount(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('fromAmount', () => {
  it('parses { value: "0.550" } to 0.55', () => {
    expect(fromAmount({ value: '0.550', currency: 'USD' })).toBe(0.55);
  });

  it('returns 0 for undefined', () => {
    expect(fromAmount(undefined)).toBe(0);
  });

  it('returns 0 for empty string value', () => {
    expect(fromAmount({ value: '', currency: 'USD' })).toBe(0);
  });
});
