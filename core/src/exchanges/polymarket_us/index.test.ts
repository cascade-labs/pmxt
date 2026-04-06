/**
 * Integration tests for PolymarketUSExchange.
 *
 * The `polymarket-us` SDK is fully mocked here so the tests run without
 * touching the network. Each test instantiates a fresh exchange (and
 * therefore a fresh mock client) so per-test mock setup is independent.
 */

jest.mock('polymarket-us', () => {
    class PolymarketUSError extends Error {}
    class APIError extends PolymarketUSError {
        status: number;
        constructor(status: number, message: string) {
            super(message);
            this.status = status;
        }
    }
    class AuthenticationError extends APIError {
        constructor(m = 'auth') { super(401, m); }
    }
    class BadRequestError extends APIError {
        constructor(m = 'bad request') { super(400, m); }
    }
    class NotFoundError extends APIError {
        constructor(m = 'not found') { super(404, m); }
    }
    class RateLimitError extends APIError {
        constructor(m = 'rate limit') { super(429, m); }
    }
    class InternalServerError extends APIError {
        constructor(m = 'server') { super(500, m); }
    }

    const PolymarketUS = jest.fn().mockImplementation(() => ({
        markets: {
            list: jest.fn(),
            book: jest.fn(),
            retrieveBySlug: jest.fn(),
        },
        events: {
            list: jest.fn(),
            retrieveBySlug: jest.fn(),
        },
        orders: {
            list: jest.fn(),
            retrieve: jest.fn(),
            create: jest.fn(),
            cancel: jest.fn(),
        },
        portfolio: {
            positions: jest.fn(),
            activities: jest.fn(),
        },
        account: {
            balances: jest.fn(),
        },
    }));

    return {
        PolymarketUS,
        PolymarketUSError,
        APIError,
        AuthenticationError,
        BadRequestError,
        NotFoundError,
        RateLimitError,
        InternalServerError,
    };
});

import { PolymarketUSExchange } from './index';
import { AuthenticationError as PmxtAuthError } from '../../errors';
import { AuthenticationError as SdkAuthError } from 'polymarket-us';

const CREDS = { apiKey: 'k1', privateKey: 's1' };

function getClient(exchange: PolymarketUSExchange): any {
    return (exchange as any).client;
}

function makeMarketDetail(slug = 'btc-100k') {
    return {
        id: 1,
        slug,
        title: `Market ${slug}`,
        outcome: 'binary',
        description: 'desc',
        active: true,
        closed: false,
        liquidity: 100,
        volume: 1000,
        eventSlug: 'evt-1',
    };
}

function makeSdkOrder(overrides: any = {}) {
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
        ...overrides,
    };
}

describe('PolymarketUSExchange', () => {
    describe('construction', () => {
        it('constructs without credentials but rejects auth-required calls', async () => {
            const ex = new PolymarketUSExchange();
            await expect(ex.fetchBalance()).rejects.toBeInstanceOf(PmxtAuthError);
        });

        it('constructs with credentials and exposes the unified name', () => {
            const ex = new PolymarketUSExchange(CREDS);
            expect(ex.name).toBe('PolymarketUS');
        });
    });

    describe('fetchMarkets', () => {
        it('returns normalized markets from markets.list', async () => {
            const ex = new PolymarketUSExchange(CREDS);
            const client = getClient(ex);
            client.markets.list.mockResolvedValue({
                markets: [makeMarketDetail('btc-100k'), makeMarketDetail('eth-5k')],
            });

            const result = await ex.fetchMarkets();

            expect(client.markets.list).toHaveBeenCalledWith({
                active: true,
                limit: 250,
                offset: 0,
            });
            expect(result).toHaveLength(2);
            expect(result[0].marketId).toBe('btc-100k');
            expect(result[1].marketId).toBe('eth-5k');
        });

        it('uses retrieveBySlug for direct slug lookup', async () => {
            const ex = new PolymarketUSExchange(CREDS);
            const client = getClient(ex);
            client.markets.retrieveBySlug.mockResolvedValue({
                market: makeMarketDetail('btc-100k'),
            });

            const result = await ex.fetchMarkets({ slug: 'btc-100k' });

            expect(client.markets.retrieveBySlug).toHaveBeenCalledWith('btc-100k');
            expect(result).toHaveLength(1);
            expect(result[0].marketId).toBe('btc-100k');
        });
    });

    describe('fetchOrderBook', () => {
        it('normalizes a market book', async () => {
            const ex = new PolymarketUSExchange(CREDS);
            const client = getClient(ex);
            client.markets.book.mockResolvedValue({
                marketSlug: 'btc-100k',
                bids: [{ px: { value: '0.55', currency: 'USD' }, qty: '10' }],
                offers: [{ px: { value: '0.57', currency: 'USD' }, qty: '5' }],
                state: 'MARKET_STATE_OPEN',
                transactTime: '2024-01-01T00:00:00Z',
            });

            const book = await ex.fetchOrderBook('btc-100k');

            expect(client.markets.book).toHaveBeenCalledWith('btc-100k');
            expect(book.bids).toEqual([{ price: 0.55, size: 10 }]);
            expect(book.asks).toEqual([{ price: 0.57, size: 5 }]);
        });
    });

    describe('buildOrder', () => {
        it('builds a BUY LONG limit order at the user price', async () => {
            const ex = new PolymarketUSExchange(CREDS);
            const built = await ex.buildOrder({
                marketId: 'btc-100k',
                outcomeId: 'btc-100k:long',
                side: 'buy',
                type: 'limit',
                amount: 10,
                price: 0.55,
            });

            const raw = built.raw as any;
            expect(raw.intent).toBe('ORDER_INTENT_BUY_LONG');
            expect(raw.type).toBe('ORDER_TYPE_LIMIT');
            expect(raw.marketSlug).toBe('btc-100k');
            expect(raw.quantity).toBe(10);
            expect(raw.price.value).toBe('0.550');
        });

        it('builds a BUY SHORT limit order using long-side price conversion', async () => {
            const ex = new PolymarketUSExchange(CREDS);
            const built = await ex.buildOrder({
                marketId: 'btc-100k',
                outcomeId: 'btc-100k:short',
                side: 'buy',
                type: 'limit',
                amount: 10,
                price: 0.40,
            });

            const raw = built.raw as any;
            expect(raw.intent).toBe('ORDER_INTENT_BUY_SHORT');
            expect(raw.price.value).toBe('0.600');
        });
    });

    describe('cancelOrder', () => {
        it('uses cached marketSlug when available', async () => {
            const ex = new PolymarketUSExchange(CREDS);
            const client = getClient(ex);

            // Pre-populate cache by listing open orders
            client.orders.list.mockResolvedValue({
                orders: [makeSdkOrder({ id: 'order-123', marketSlug: 'btc-100k' })],
            });
            await ex.fetchOpenOrders();

            client.orders.cancel.mockResolvedValue(undefined);
            client.orders.retrieve.mockResolvedValue({
                order: makeSdkOrder({ id: 'order-123', state: 'ORDER_STATE_CANCELED' }),
            });

            await ex.cancelOrder('order-123');

            expect(client.orders.cancel).toHaveBeenCalledWith('order-123', {
                marketSlug: 'btc-100k',
            });
        });

        it('fetches the order first when slug is not cached', async () => {
            const ex = new PolymarketUSExchange(CREDS);
            const client = getClient(ex);

            client.orders.retrieve.mockResolvedValue({
                order: makeSdkOrder({ id: 'order-456', marketSlug: 'eth-5k' }),
            });
            client.orders.cancel.mockResolvedValue(undefined);

            await ex.cancelOrder('order-456');

            expect(client.orders.retrieve).toHaveBeenCalledWith('order-456');
            expect(client.orders.cancel).toHaveBeenCalledWith('order-456', {
                marketSlug: 'eth-5k',
            });
        });
    });

    describe('error mapping', () => {
        it('translates SDK AuthenticationError into PMXT AuthenticationError', async () => {
            const ex = new PolymarketUSExchange(CREDS);
            const client = getClient(ex);
            client.account.balances.mockRejectedValue(new SdkAuthError('bad creds'));

            await expect(ex.fetchBalance()).rejects.toBeInstanceOf(PmxtAuthError);
        });
    });
});
