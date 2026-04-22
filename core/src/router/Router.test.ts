import { Router } from './Router';
import { PmxtApiClient } from './client';

jest.mock('./client');

const MockedClient = PmxtApiClient as jest.MockedClass<typeof PmxtApiClient>;

describe('Router', () => {
    let router: Router;
    let clientInstance: jest.Mocked<PmxtApiClient>;

    beforeEach(() => {
        jest.clearAllMocks();
        MockedClient.mockClear();

        router = new Router({ apiKey: 'test-key' });
        clientInstance = MockedClient.mock.instances[0] as jest.Mocked<PmxtApiClient>;
    });

    describe('constructor', () => {
        it('has name "Router"', () => {
            expect(router.name).toBe('Router');
        });

        it('does not require exchanges option', () => {
            expect(() => new Router({ apiKey: 'key' })).not.toThrow();
        });
    });

    describe('fetchMatches', () => {
        it('returns matches from the API using marketId', async () => {
            const mockMatches = [
                {
                    market: { marketId: 'k1', sourceExchange: 'kalshi' },
                    relation: 'identity',
                    confidence: 0.95,
                    reasoning: 'Same resolution condition.',
                    bestBid: 0.60,
                    bestAsk: 0.65,
                },
            ];
            clientInstance.getMarketMatches = jest.fn().mockResolvedValue({ matches: mockMatches });

            const result = await router.fetchMatches({ marketId: 'm1', relation: 'identity' });
            expect(clientInstance.getMarketMatches).toHaveBeenCalledWith({ marketId: 'm1', relation: 'identity' });
            expect(result).toEqual(mockMatches);
        });

        it('accepts slug as identifier', async () => {
            clientInstance.getMarketMatches = jest.fn().mockResolvedValue({ matches: [] });

            await router.fetchMatches({ slug: 'btc-100k' });
            expect(clientInstance.getMarketMatches).toHaveBeenCalledWith({ slug: 'btc-100k' });
        });

        it('returns empty array when no matches', async () => {
            clientInstance.getMarketMatches = jest.fn().mockResolvedValue({});
            const result = await router.fetchMatches({ marketId: 'm1' });
            expect(result).toEqual([]);
        });
    });

    describe('fetchEventMatches', () => {
        it('returns event matches from the API', async () => {
            const mockMatches = [
                { event: { id: 'e2' }, marketMatches: [] },
            ];
            clientInstance.getEventMatches = jest.fn().mockResolvedValue({ matches: mockMatches });

            const result = await router.fetchEventMatches({ eventId: 'e1' });
            expect(clientInstance.getEventMatches).toHaveBeenCalledWith({ eventId: 'e1' });
            expect(result).toEqual(mockMatches);
        });
    });

    describe('compareMarketPrices', () => {
        it('fetches identity matches with includePrices and maps to PriceComparison', async () => {
            const mockMatches = [
                {
                    market: { marketId: 'k1', sourceExchange: 'kalshi', outcomes: [] },
                    relation: 'identity',
                    confidence: 0.9,
                    reasoning: 'Same market.',
                    bestBid: 0.55,
                    bestAsk: 0.62,
                },
            ];
            clientInstance.getMarketMatches = jest.fn().mockResolvedValue({ matches: mockMatches });

            const result = await router.compareMarketPrices({ marketId: 'm1' });
            expect(clientInstance.getMarketMatches).toHaveBeenCalledWith({
                marketId: 'm1',
                relation: 'identity',
                includePrices: true,
            });
            expect(result).toHaveLength(1);
            expect(result[0].bestBid).toBe(0.55);
            expect(result[0].bestAsk).toBe(0.62);
            expect(result[0].venue).toBe('kalshi');
            expect(result[0].reasoning).toBe('Same market.');
        });
    });

    describe('fetchHedges', () => {
        it('returns only subset/superset matches with reasoning', async () => {
            const mockMatches = [
                {
                    market: { marketId: 'k1', sourceExchange: 'kalshi' },
                    relation: 'identity',
                    confidence: 0.95,
                    reasoning: 'Same.',
                    bestBid: 0.60,
                    bestAsk: 0.65,
                },
                {
                    market: { marketId: 'k2', sourceExchange: 'kalshi' },
                    relation: 'subset',
                    confidence: 0.8,
                    reasoning: 'Narrower market — nomination implies candidacy.',
                    bestBid: 0.40,
                    bestAsk: 0.45,
                },
                {
                    market: { marketId: 'k3', sourceExchange: 'polymarket' },
                    relation: 'superset',
                    confidence: 0.7,
                    reasoning: 'Broader — popular vote does not guarantee election win.',
                    bestBid: 0.70,
                    bestAsk: 0.73,
                },
            ];
            clientInstance.getMarketMatches = jest.fn().mockResolvedValue({ matches: mockMatches });

            const result = await router.fetchHedges({ marketId: 'm1' });
            expect(result).toHaveLength(2);
            expect(result[0].relation).toBe('subset');
            expect(result[0].reasoning).toBe('Narrower market — nomination implies candidacy.');
            expect(result[1].relation).toBe('superset');
        });
    });

    describe('fetchMarkets', () => {
        it('returns markets from the API', async () => {
            const mockMarkets = [{ marketId: 'm1', title: 'BTC' }];
            clientInstance.searchMarkets = jest.fn().mockResolvedValue(mockMarkets);

            const result = await router.fetchMarkets({ query: 'bitcoin' });
            expect(clientInstance.searchMarkets).toHaveBeenCalledWith({ query: 'bitcoin' });
            expect(result).toEqual(mockMarkets);
        });
    });

    describe('fetchEvents', () => {
        it('returns events from the API', async () => {
            const mockEvents = [{ id: 'e1', title: 'Election' }];
            clientInstance.searchEvents = jest.fn().mockResolvedValue(mockEvents);

            const result = await router.fetchEvents({ query: 'election' });
            expect(clientInstance.searchEvents).toHaveBeenCalledWith({ query: 'election' });
            expect(result).toEqual(mockEvents);
        });
    });

    describe('createOrder', () => {
        it('throws not implemented error', async () => {
            await expect(router.createOrder()).rejects.toThrow(
                'Router order routing is not yet implemented',
            );
        });
    });
});
