import { PredictionMarketExchange, MarketFetchParams, EventFetchParams } from '../../src/BaseExchange';
import { UnifiedMarket, UnifiedEvent } from '../../src/types';

// ---------------------------------------------------------------------------
// Minimal concrete exchange for testing filter integration
// ---------------------------------------------------------------------------

class MockExchange extends PredictionMarketExchange {
    get name() { return 'FilterTestExchange'; }

    public implReceivedParams: MarketFetchParams | undefined = undefined;
    public implReceivedEventParams: EventFetchParams | undefined = undefined;

    private mockMarkets: UnifiedMarket[];
    private mockEvents: UnifiedEvent[];

    constructor(markets: UnifiedMarket[], events: UnifiedEvent[] = []) {
        super();
        this.mockMarkets = markets;
        this.mockEvents = events;
    }

    protected async fetchMarketsImpl(params?: MarketFetchParams): Promise<UnifiedMarket[]> {
        this.implReceivedParams = params;
        return this.mockMarkets;
    }

    protected async fetchEventsImpl(params: EventFetchParams): Promise<UnifiedEvent[]> {
        this.implReceivedEventParams = params;
        return this.mockEvents;
    }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const politicsMarket: UnifiedMarket = {
    marketId: '1',
    title: 'Will Trump win the 2024 election?',
    outcomes: [
        { outcomeId: '1a', label: 'Yes', price: 0.55, priceChange24h: 0.05 },
    ],
    volume24h: 50000,
    liquidity: 100000,
    url: 'https://example.com/1',
    category: 'Politics',
    tags: ['Election'],
};

const cryptoMarket: UnifiedMarket = {
    marketId: '2',
    title: 'Bitcoin above $100k?',
    outcomes: [
        { outcomeId: '2a', label: 'Yes', price: 0.35, priceChange24h: 0.02 },
    ],
    volume24h: 75000,
    liquidity: 150000,
    url: 'https://example.com/2',
    category: 'Crypto',
    tags: ['Bitcoin'],
};

const lowVolPoliticsMarket: UnifiedMarket = {
    marketId: '3',
    title: 'Will Fed Chair be Kevin Warsh?',
    outcomes: [
        { outcomeId: '3a', label: 'Yes', price: 0.15, priceChange24h: -0.10 },
    ],
    volume24h: 5000,
    liquidity: 20000,
    url: 'https://example.com/3',
    category: 'Politics',
    tags: ['Fed'],
};

const allMarkets = [politicsMarket, cryptoMarket, lowVolPoliticsMarket];

const politicsEvent: UnifiedEvent = {
    id: 'e1',
    title: '2024 Presidential Election',
    description: 'Election markets',
    slug: '2024-election',
    url: 'https://example.com/event/1',
    category: 'Politics',
    tags: ['Election'],
    markets: [politicsMarket, lowVolPoliticsMarket],
};

const cryptoEvent: UnifiedEvent = {
    id: 'e2',
    title: 'Crypto Price Predictions',
    description: 'Crypto markets',
    slug: 'crypto-prices',
    url: 'https://example.com/event/2',
    category: 'Crypto',
    tags: ['Bitcoin'],
    markets: [cryptoMarket],
};

const allEvents = [politicsEvent, cryptoEvent];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchMarkets with filter', () => {
    it('returns all markets when no filter is provided', async () => {
        const exchange = new MockExchange(allMarkets);
        const result = await exchange.fetchMarkets();
        expect(result).toHaveLength(3);
    });

    it('filters by category', async () => {
        const exchange = new MockExchange(allMarkets);
        const result = await exchange.fetchMarkets({ filter: { category: 'Politics' } });
        expect(result).toHaveLength(2);
        expect(result.map(m => m.marketId)).toEqual(['1', '3']);
    });

    it('filters by volume24h range', async () => {
        const exchange = new MockExchange(allMarkets);
        const result = await exchange.fetchMarkets({ filter: { volume24h: { min: 40000 } } });
        expect(result).toHaveLength(2);
        expect(result.map(m => m.marketId)).toEqual(['1', '2']);
    });

    it('combines fetch params with filter', async () => {
        const exchange = new MockExchange(allMarkets);
        const result = await exchange.fetchMarkets({
            query: 'election',
            filter: { category: 'Crypto' },
        });
        expect(result).toHaveLength(1);
        expect(result[0].marketId).toBe('2');
        // query should pass through to impl, filter should not
        expect(exchange.implReceivedParams).toEqual({ query: 'election' });
    });

    it('does not pass filter to fetchMarketsImpl', async () => {
        const exchange = new MockExchange(allMarkets);
        await exchange.fetchMarkets({ filter: { category: 'Politics' } });
        expect(exchange.implReceivedParams).toBeUndefined();
    });

    it('passes non-filter params (except limit/offset) to fetchMarketsImpl when filter is present', async () => {
        const exchange = new MockExchange(allMarkets);
        await exchange.fetchMarkets({ query: 'test', limit: 10, filter: { category: 'Politics' } });
        // limit/offset are held back and applied post-filter
        expect(exchange.implReceivedParams).toEqual({ query: 'test' });
    });

    it('respects limit after filtering', async () => {
        const exchange = new MockExchange(allMarkets);
        const result = await exchange.fetchMarkets({ limit: 1, filter: { category: 'Politics' } });
        expect(result).toHaveLength(1);
        expect(result[0].marketId).toBe('1');
    });

    it('respects offset after filtering', async () => {
        const exchange = new MockExchange(allMarkets);
        const result = await exchange.fetchMarkets({ offset: 1, limit: 1, filter: { category: 'Politics' } });
        expect(result).toHaveLength(1);
        expect(result[0].marketId).toBe('3');
    });

    it('returns empty array when filter matches nothing', async () => {
        const exchange = new MockExchange(allMarkets);
        const result = await exchange.fetchMarkets({ filter: { category: 'Sports' } });
        expect(result).toHaveLength(0);
    });

    it('handles empty filter object', async () => {
        const exchange = new MockExchange(allMarkets);
        const result = await exchange.fetchMarkets({ filter: {} });
        expect(result).toHaveLength(3);
    });

    it('filters by top-level category param', async () => {
        const exchange = new MockExchange(allMarkets);
        const result = await exchange.fetchMarkets({ category: 'Politics' });
        expect(result).toHaveLength(2);
        expect(result.map(m => m.marketId)).toEqual(['1', '3']);
    });

    it('filters by top-level tags param', async () => {
        const exchange = new MockExchange(allMarkets);
        const result = await exchange.fetchMarkets({ tags: ['Bitcoin'] });
        expect(result).toHaveLength(1);
        expect(result.map(m => m.marketId)).toEqual(['2']);
    });

    it('top-level category merges with filter', async () => {
        const exchange = new MockExchange(allMarkets);
        const result = await exchange.fetchMarkets({
            category: 'Politics',
            filter: { volume24h: { min: 40000 } },
        });
        expect(result).toHaveLength(1);
        expect(result[0].marketId).toBe('1');
    });

    it('top-level category overrides filter.category', async () => {
        const exchange = new MockExchange(allMarkets);
        const result = await exchange.fetchMarkets({
            category: 'Crypto',
            filter: { category: 'Politics' },
        });
        expect(result).toHaveLength(1);
        expect(result[0].marketId).toBe('2');
    });

    it('top-level category with limit applies limit post-filter', async () => {
        const exchange = new MockExchange(allMarkets);
        const result = await exchange.fetchMarkets({ category: 'Politics', limit: 1 });
        expect(result).toHaveLength(1);
    });
});

describe('fetchEvents with filter', () => {
    it('returns all events when no filter is provided', async () => {
        const exchange = new MockExchange([], allEvents);
        const result = await exchange.fetchEvents();
        expect(result).toHaveLength(2);
    });

    it('filters by category', async () => {
        const exchange = new MockExchange([], allEvents);
        const result = await exchange.fetchEvents({ filter: { category: 'Crypto' } });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('e2');
    });

    it('does not pass filter to fetchEventsImpl', async () => {
        const exchange = new MockExchange([], allEvents);
        await exchange.fetchEvents({ filter: { category: 'Politics' } });
        expect(exchange.implReceivedEventParams).toBeDefined();
        expect((exchange.implReceivedEventParams as any).filter).toBeUndefined();
    });

    it('combines fetch params with filter', async () => {
        const exchange = new MockExchange([], allEvents);
        const result = await exchange.fetchEvents({
            query: 'election',
            limit: 10,
            filter: { category: 'Politics' },
        });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('e1');
        // limit is held back for post-filter slicing
        expect(exchange.implReceivedEventParams).toEqual({ query: 'election' });
    });

    it('respects limit after filtering', async () => {
        const exchange = new MockExchange([], allEvents);
        const result = await exchange.fetchEvents({ limit: 1, filter: { category: 'Politics' } });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('e1');
    });

    it('filters by market count', async () => {
        const exchange = new MockExchange([], allEvents);
        const result = await exchange.fetchEvents({
            filter: { marketCount: { min: 2 } },
        });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('e1');
    });

    it('filters by top-level category param', async () => {
        const exchange = new MockExchange([], allEvents);
        const result = await exchange.fetchEvents({ category: 'Crypto' });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('e2');
    });

    it('top-level category with limit', async () => {
        const exchange = new MockExchange([], allEvents);
        const result = await exchange.fetchEvents({ category: 'Politics', limit: 1 });
        expect(result).toHaveLength(1);
    });
});

describe('fetchMarketsPaginated with filter', () => {
    it('applies filter to paginated results', async () => {
        const exchange = new MockExchange(allMarkets);
        const result = await exchange.fetchMarketsPaginated({
            filter: { category: 'Politics' },
        });
        expect(result.data).toHaveLength(2);
        expect(result.total).toBe(3); // total reflects unfiltered snapshot
    });

    it('applies filter with limit and cursor', async () => {
        const exchange = new MockExchange(allMarkets);

        // First page
        const page1 = await exchange.fetchMarketsPaginated({
            limit: 2,
            filter: { category: 'Politics' },
        });
        expect(page1.data).toHaveLength(1); // only 1 of the first 2 is Politics
        expect(page1.nextCursor).toBeDefined();

        // Second page
        const page2 = await exchange.fetchMarketsPaginated({
            limit: 2,
            cursor: page1.nextCursor!,
            filter: { category: 'Politics' },
        });
        expect(page2.data).toHaveLength(1); // the third market is Politics
    });
});
