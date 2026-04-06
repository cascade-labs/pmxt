// Mock the price helpers so this test does not depend on price.ts being
// implemented yet (it is created in parallel by another agent).
jest.mock('./price', () => ({
    fromAmount: (a: { value: string } | undefined): number =>
        a ? parseFloat(a.value) : 0,
    fromLongSidePrice: (intent: string, longPrice: number): number =>
        intent.endsWith('SHORT') ? 1 - longPrice : longPrice,
    toAmount: (p: number) => ({ value: p.toFixed(2), currency: 'USD' }),
}));

import { PolymarketUSNormalizer } from './normalizer';
import type {
    MarketDetail,
    MarketBook,
    Order as SdkOrder,
    OrderState,
    UserPosition,
    UserBalance,
    OrderIntent,
} from 'polymarket-us';

function makeOrder(overrides: Partial<SdkOrder> = {}): SdkOrder {
    return {
        id: 'order-1',
        marketSlug: 'btc-100k',
        side: 'ORDER_SIDE_BUY',
        type: 'ORDER_TYPE_LIMIT',
        price: { value: '0.55', currency: 'USD' },
        quantity: 10,
        cumQuantity: 0,
        leavesQuantity: 10,
        tif: 'TIME_IN_FORCE_GOOD_TILL_CANCEL',
        intent: 'ORDER_INTENT_BUY_LONG',
        state: 'ORDER_STATE_NEW',
        createTime: '2026-01-01T00:00:00.000Z',
        ...overrides,
    } as SdkOrder;
}

describe('PolymarketUSNormalizer', () => {
    const normalizer = new PolymarketUSNormalizer();

    describe('normalizeMarket', () => {
        it('uses the slug as marketId and synthesizes long/short outcomes', () => {
            const detail: MarketDetail = {
                id: 1,
                slug: 'btc-100k',
                title: 'BTC reaches $100k',
                outcome: 'yes',
                description: 'Will BTC hit 100k by year end?',
                active: true,
                closed: false,
                liquidity: 5000,
                volume: 12345,
                eventSlug: 'btc-events',
            };

            const um = normalizer.normalizeMarket(detail);

            expect(um.marketId).toBe('btc-100k');
            expect(um.slug).toBe('btc-100k');
            expect(um.title).toBe('BTC reaches $100k');
            expect(um.description).toBe('Will BTC hit 100k by year end?');
            expect(um.outcomes).toHaveLength(2);
            expect(um.outcomes[0].outcomeId).toBe('btc-100k:long');
            expect(um.outcomes[0].label).toBe('long');
            expect(um.outcomes[1].outcomeId).toBe('btc-100k:short');
            expect(um.outcomes[1].label).toBe('short');
            expect(um.liquidity).toBe(5000);
            expect(um.volume).toBe(12345);
        });

        it('populates outcome prices from marketSides[].price and tickSize from orderPriceMinTickSize', () => {
            const detail = {
                slug: 'nfl-sf-at-kc',
                question: 'SF at KC',
                marketSides: [
                    { description: 'Kansas City Chiefs', long: true, price: '0.864' },
                    { description: 'San Francisco 49ers', long: false, price: '0.136' },
                ],
                orderPriceMinTickSize: 0.001,
            } as unknown as MarketDetail;

            const um = normalizer.normalizeMarket(detail);

            expect(um.outcomes[0].price).toBeCloseTo(0.864);
            expect(um.outcomes[0].metadata?.sideDescription).toBe('Kansas City Chiefs');
            expect(um.outcomes[1].price).toBeCloseTo(0.136);
            expect(um.outcomes[1].metadata?.sideDescription).toBe('San Francisco 49ers');
            expect(um.tickSize).toBe(0.001);
        });

        it('derives the short-side price from 1 - longPrice when only the long side is quoted', () => {
            const detail = {
                slug: 'btc-100k',
                question: 'BTC 100k',
                marketSides: [
                    { long: true, price: '0.72' },
                    { long: false },
                ],
            } as unknown as MarketDetail;

            const um = normalizer.normalizeMarket(detail);

            expect(um.outcomes[0].price).toBeCloseTo(0.72);
            expect(um.outcomes[1].price).toBeCloseTo(0.28);
        });

        it('falls back to outcomePrices[] when marketSides is missing', () => {
            const detail = {
                slug: 'eth-5k',
                question: 'ETH 5k',
                outcomePrices: ['0.30', '0.70'],
            } as unknown as MarketDetail;

            const um = normalizer.normalizeMarket(detail);

            expect(um.outcomes[0].price).toBeCloseTo(0.30);
            expect(um.outcomes[1].price).toBeCloseTo(0.70);
        });
    });

    describe('normalizeOrderBook', () => {
        it('preserves bid/offer levels with parsed numeric prices', () => {
            const book: MarketBook = {
                marketSlug: 'btc-100k',
                bids: [
                    { px: { value: '0.55', currency: 'USD' }, qty: '100' },
                    { px: { value: '0.54', currency: 'USD' }, qty: '50' },
                ],
                offers: [
                    { px: { value: '0.56', currency: 'USD' }, qty: '75' },
                    { px: { value: '0.57', currency: 'USD' }, qty: '25' },
                ],
                state: 'MARKET_STATE_OPEN',
            };

            const ob = normalizer.normalizeOrderBook(book, 'btc-100k');

            expect(ob.bids).toEqual([
                { price: 0.55, size: 100 },
                { price: 0.54, size: 50 },
            ]);
            expect(ob.asks).toEqual([
                { price: 0.56, size: 75 },
                { price: 0.57, size: 25 },
            ]);
            expect(typeof ob.timestamp).toBe('number');
        });
    });

    describe('normalizeOrder - intent mapping', () => {
        const cases: Array<{ intent: OrderIntent; expectedSide: 'buy' | 'sell'; expectedOutcomeSuffix: string }> = [
            { intent: 'ORDER_INTENT_BUY_LONG', expectedSide: 'buy', expectedOutcomeSuffix: ':long' },
            { intent: 'ORDER_INTENT_SELL_LONG', expectedSide: 'sell', expectedOutcomeSuffix: ':long' },
            { intent: 'ORDER_INTENT_BUY_SHORT', expectedSide: 'buy', expectedOutcomeSuffix: ':short' },
            { intent: 'ORDER_INTENT_SELL_SHORT', expectedSide: 'sell', expectedOutcomeSuffix: ':short' },
        ];

        for (const { intent, expectedSide, expectedOutcomeSuffix } of cases) {
            it(`maps ${intent} to side=${expectedSide} and outcomeId ending in ${expectedOutcomeSuffix}`, () => {
                const order = normalizer.normalizeOrder(makeOrder({ intent }));
                expect(order.side).toBe(expectedSide);
                expect(order.outcomeId.endsWith(expectedOutcomeSuffix)).toBe(true);
                expect(order.marketId).toBe('btc-100k');
            });
        }

        it('keeps long-side price unchanged for BUY_LONG', () => {
            const order = normalizer.normalizeOrder(makeOrder({
                intent: 'ORDER_INTENT_BUY_LONG',
                price: { value: '0.60', currency: 'USD' },
            }));
            expect(order.price).toBeCloseTo(0.60);
        });

        it('flips long-side price to short-side for BUY_SHORT', () => {
            const order = normalizer.normalizeOrder(makeOrder({
                intent: 'ORDER_INTENT_BUY_SHORT',
                price: { value: '0.60', currency: 'USD' },
            }));
            expect(order.price).toBeCloseTo(0.40);
        });
    });

    describe('normalizeOrder - state mapping', () => {
        const cases: Array<{ state: OrderState; expected: string }> = [
            { state: 'ORDER_STATE_NEW', expected: 'open' },
            { state: 'ORDER_STATE_PARTIALLY_FILLED', expected: 'open' },
            { state: 'ORDER_STATE_FILLED', expected: 'filled' },
            { state: 'ORDER_STATE_CANCELED', expected: 'cancelled' },
            { state: 'ORDER_STATE_REJECTED', expected: 'rejected' },
            { state: 'ORDER_STATE_EXPIRED', expected: 'cancelled' },
        ];

        for (const { state, expected } of cases) {
            it(`maps ${state} to ${expected}`, () => {
                const order = normalizer.normalizeOrder(makeOrder({ state }));
                expect(order.status).toBe(expected);
            });
        }
    });

    describe('normalizePositions', () => {
        it('maps positive netPosition to long and negative to short with absolute sizes', () => {
            const positions: Record<string, UserPosition> = {
                'btc-100k': {
                    netPosition: '15',
                    qtyBought: '20',
                    qtySold: '5',
                    cost: { value: '7.50', currency: 'USD' },
                    realized: { value: '0.00', currency: 'USD' },
                    bodPosition: '0',
                    expired: false,
                },
                'eth-5k': {
                    netPosition: '-8',
                    qtyBought: '2',
                    qtySold: '10',
                    cost: { value: '4.00', currency: 'USD' },
                    realized: { value: '1.25', currency: 'USD' },
                    bodPosition: '0',
                    expired: false,
                },
            };

            const result = normalizer.normalizePositions(positions);
            expect(result).toHaveLength(2);

            const btc = result.find(p => p.marketId === 'btc-100k')!;
            expect(btc.outcomeId).toBe('btc-100k:long');
            expect(btc.outcomeLabel).toBe('long');
            expect(btc.size).toBe(15);
            expect(btc.entryPrice).toBeCloseTo(0.5);

            const eth = result.find(p => p.marketId === 'eth-5k')!;
            expect(eth.outcomeId).toBe('eth-5k:short');
            expect(eth.outcomeLabel).toBe('short');
            expect(eth.size).toBe(8);
            expect(eth.entryPrice).toBeCloseTo(0.5);
            expect(eth.realizedPnL).toBeCloseTo(1.25);
        });
    });

    describe('normalizeBalance', () => {
        it('maps current/buyingPower to total/available/locked', () => {
            const balance: UserBalance = {
                currentBalance: 1000,
                currency: 'USD',
                buyingPower: 800,
            };

            const result = normalizer.normalizeBalance(balance);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                currency: 'USD',
                total: 1000,
                available: 800,
                locked: 200,
            });
        });
    });
});
