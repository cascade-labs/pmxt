/**
 * Unit tests for PolymarketUSWebSocket.
 *
 * The polymarket-us SDK is fully stubbed here so the tests run without
 * touching the network. A fake MarketsWebSocket captures subscriptions
 * and lets each test fire synthetic messages through a listener map.
 */

import { PolymarketUSWebSocket } from './websocket';
import { PolymarketUSNormalizer } from './normalizer';

type Listener = (arg: any) => void;

class FakeMarketsWebSocket {
    listeners: Map<string, Listener[]> = new Map();
    connectCalls = 0;
    closeCalls = 0;
    subscribeMarketDataCalls: Array<{ requestId: string; slugs: string[] }> = [];
    subscribeTradesCalls: Array<{ requestId: string; slugs: string[] }> = [];

    on(event: string, listener: Listener): this {
        const arr = this.listeners.get(event) ?? [];
        arr.push(listener);
        this.listeners.set(event, arr);
        return this;
    }

    async connect(): Promise<void> {
        this.connectCalls += 1;
    }

    close(): void {
        this.closeCalls += 1;
    }

    subscribeMarketData(requestId: string, slugs: string[]): void {
        this.subscribeMarketDataCalls.push({ requestId, slugs });
    }

    subscribeTrades(requestId: string, slugs: string[]): void {
        this.subscribeTradesCalls.push({ requestId, slugs });
    }

    emit(event: string, arg: any): void {
        const arr = this.listeners.get(event) ?? [];
        for (const listener of arr) listener(arg);
    }
}

function makeClient(fakeSocket: FakeMarketsWebSocket) {
    return {
        ws: {
            markets: () => fakeSocket,
        },
    } as any;
}

describe('PolymarketUSWebSocket', () => {
    let fake: FakeMarketsWebSocket;
    let ws: PolymarketUSWebSocket;

    beforeEach(() => {
        fake = new FakeMarketsWebSocket();
        ws = new PolymarketUSWebSocket(makeClient(fake), new PolymarketUSNormalizer());
    });

    describe('watchOrderBook', () => {
        it('connects lazily, subscribes once per slug, and resolves on marketData', async () => {
            const pending = ws.watchOrderBook('btc-100k');
            // Let the ensureInitialized microtask run so connect resolves
            await new Promise(r => setImmediate(r));

            expect(fake.connectCalls).toBe(1);
            expect(fake.subscribeMarketDataCalls).toEqual([
                { requestId: 'book:btc-100k', slugs: ['btc-100k'] },
            ]);

            fake.emit('marketData', {
                requestId: 'book:btc-100k',
                subscriptionType: 'SUBSCRIPTION_TYPE_MARKET_DATA',
                marketData: {
                    marketSlug: 'btc-100k',
                    bids: [{ px: { value: '0.55', currency: 'USD' }, qty: '10' }],
                    offers: [{ px: { value: '0.57', currency: 'USD' }, qty: '5' }],
                    state: 'MARKET_STATE_OPEN',
                    transactTime: '2026-04-06T00:00:00Z',
                },
            });

            const book = await pending;
            expect(book.bids).toEqual([{ price: 0.55, size: 10 }]);
            expect(book.asks).toEqual([{ price: 0.57, size: 5 }]);
        });

        it('strips :long suffix before subscribing', async () => {
            const pending = ws.watchOrderBook('btc-100k:long');
            await new Promise(r => setImmediate(r));

            expect(fake.subscribeMarketDataCalls).toEqual([
                { requestId: 'book:btc-100k', slugs: ['btc-100k'] },
            ]);

            fake.emit('marketData', {
                marketData: {
                    marketSlug: 'btc-100k',
                    bids: [],
                    offers: [],
                    state: 'MARKET_STATE_OPEN',
                },
            });
            await pending;
        });

        it('does not re-subscribe when called twice for the same slug', async () => {
            const p1 = ws.watchOrderBook('btc-100k');
            await new Promise(r => setImmediate(r));
            const p2 = ws.watchOrderBook('btc-100k');
            await new Promise(r => setImmediate(r));

            expect(fake.subscribeMarketDataCalls).toHaveLength(1);

            fake.emit('marketData', {
                marketData: {
                    marketSlug: 'btc-100k',
                    bids: [],
                    offers: [],
                    state: 'MARKET_STATE_OPEN',
                },
            });

            const [b1, b2] = await Promise.all([p1, p2]);
            expect(b1.bids).toEqual([]);
            expect(b2.bids).toEqual([]);
        });
    });

    describe('watchTrades', () => {
        it('resolves with a PMXT Trade on the next trade message', async () => {
            const pending = ws.watchTrades('btc-100k');
            await new Promise(r => setImmediate(r));

            expect(fake.subscribeTradesCalls).toEqual([
                { requestId: 'trade:btc-100k', slugs: ['btc-100k'] },
            ]);

            fake.emit('trade', {
                requestId: 'trade:btc-100k',
                subscriptionType: 'SUBSCRIPTION_TYPE_TRADE',
                trade: {
                    marketSlug: 'btc-100k',
                    price: { value: '0.55', currency: 'USD' },
                    quantity: { value: '10', currency: 'USD' },
                    tradeTime: '2026-04-06T00:00:00Z',
                    maker: { side: 'ORDER_SIDE_SELL', intent: 'ORDER_INTENT_SELL_LONG' },
                    taker: { side: 'ORDER_SIDE_BUY', intent: 'ORDER_INTENT_BUY_LONG' },
                },
            });

            const trades = await pending;
            expect(trades).toHaveLength(1);
            expect(trades[0].price).toBeCloseTo(0.55);
            expect(trades[0].amount).toBeCloseTo(10);
            expect(trades[0].side).toBe('buy');
            expect(trades[0].timestamp).toBe(new Date('2026-04-06T00:00:00Z').getTime());
        });
    });

    describe('close', () => {
        it('rejects pending watchers and closes the socket', async () => {
            const pending = ws.watchOrderBook('btc-100k');
            await new Promise(r => setImmediate(r));
            const pendingTrade = ws.watchTrades('btc-100k');
            await new Promise(r => setImmediate(r));

            await ws.close();

            await expect(pending).rejects.toThrow('PolymarketUS WebSocket closed');
            await expect(pendingTrade).rejects.toThrow('PolymarketUS WebSocket closed');
            expect(fake.closeCalls).toBe(1);
        });
    });

    describe('error handling', () => {
        it('rejects pending watchers when the socket emits an error', async () => {
            const pending = ws.watchOrderBook('btc-100k');
            await new Promise(r => setImmediate(r));

            fake.emit('error', new Error('boom'));

            await expect(pending).rejects.toThrow('boom');
        });
    });
});
