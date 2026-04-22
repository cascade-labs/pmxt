import axios from 'axios';
import { PmxtApiClient } from './client';
import { AuthenticationError, NotFound, RateLimitExceeded, BadRequest } from '../errors';

jest.mock('axios', () => {
    const mockInstance = {
        request: jest.fn(),
        defaults: { headers: { common: {} } },
    };
    const actualAxios = jest.requireActual('axios');
    const mockAxios = {
        create: jest.fn(() => mockInstance),
        isAxiosError: actualAxios.isAxiosError,
    };
    return {
        __esModule: true,
        ...mockAxios,
        default: mockAxios,
    };
});

const mockAxiosInstance = axios.create() as any;

describe('PmxtApiClient', () => {
    let client: PmxtApiClient;

    beforeEach(() => {
        jest.clearAllMocks();
        (mockAxiosInstance.request as jest.Mock).mockReset();
        client = new PmxtApiClient('test-api-key');
    });

    it('creates axios instance with Bearer token and default base URL', () => {
        expect(axios.create).toHaveBeenCalledWith(
            expect.objectContaining({
                baseURL: 'https://api.pmxt.dev',
                headers: expect.objectContaining({
                    Authorization: 'Bearer test-api-key',
                }),
            }),
        );
    });

    it('accepts a custom base URL', () => {
        new PmxtApiClient('key', 'http://localhost:4111');
        expect(axios.create).toHaveBeenCalledWith(
            expect.objectContaining({
                baseURL: 'http://localhost:4111',
            }),
        );
    });

    describe('getMarketMatches', () => {
        it('calls GET /v0/markets/:id/matches with marketId', async () => {
            const mockData = { data: { market: {}, matches: [{ relation: 'identity' }] } };
            (mockAxiosInstance.request as jest.Mock).mockResolvedValue({ data: mockData });

            const result = await client.getMarketMatches({ marketId: 'abc-123' });
            expect(mockAxiosInstance.request).toHaveBeenCalledWith({
                method: 'GET',
                url: '/v0/markets/abc-123/matches',
                params: {},
            });
            expect(result).toEqual(mockData.data);
        });

        it('accepts slug as identifier', async () => {
            (mockAxiosInstance.request as jest.Mock).mockResolvedValue({
                data: { data: { matches: [] } },
            });

            await client.getMarketMatches({ slug: 'will-btc-hit-100k' });
            expect(mockAxiosInstance.request).toHaveBeenCalledWith({
                method: 'GET',
                url: '/v0/markets/will-btc-hit-100k/matches',
                params: {},
            });
        });

        it('accepts url as identifier', async () => {
            (mockAxiosInstance.request as jest.Mock).mockResolvedValue({
                data: { data: { matches: [] } },
            });

            await client.getMarketMatches({ url: 'https://polymarket.com/event/btc' });
            expect(mockAxiosInstance.request).toHaveBeenCalledWith({
                method: 'GET',
                url: '/v0/markets/https%3A%2F%2Fpolymarket.com%2Fevent%2Fbtc/matches',
                params: {},
            });
        });

        it('throws BadRequest when no identifier provided', async () => {
            await expect(client.getMarketMatches({})).rejects.toThrow(BadRequest);
        });

        it('passes query params including includePrices', async () => {
            (mockAxiosInstance.request as jest.Mock).mockResolvedValue({
                data: { data: { matches: [] } },
            });

            await client.getMarketMatches({
                marketId: 'abc',
                relation: 'identity',
                minConfidence: 0.8,
                limit: 10,
                includePrices: true,
            });

            expect(mockAxiosInstance.request).toHaveBeenCalledWith({
                method: 'GET',
                url: '/v0/markets/abc/matches',
                params: { relation: 'identity', minConfidence: '0.8', limit: '10', includePrices: 'true' },
            });
        });
    });

    describe('getEventMatches', () => {
        it('calls GET /v0/events/:id/matches with eventId', async () => {
            (mockAxiosInstance.request as jest.Mock).mockResolvedValue({
                data: { data: { event: {}, matches: [] } },
            });

            await client.getEventMatches({ eventId: 'evt-1' });
            expect(mockAxiosInstance.request).toHaveBeenCalledWith({
                method: 'GET',
                url: '/v0/events/evt-1/matches',
                params: {},
            });
        });

        it('throws BadRequest when no identifier provided', async () => {
            await expect(client.getEventMatches({})).rejects.toThrow(BadRequest);
        });
    });

    describe('searchMarkets', () => {
        it('calls GET /v0/markets with query params', async () => {
            (mockAxiosInstance.request as jest.Mock).mockResolvedValue({
                data: { data: [] },
            });

            await client.searchMarkets({
                query: 'bitcoin',
                sourceExchange: 'polymarket',
                limit: 20,
            });

            expect(mockAxiosInstance.request).toHaveBeenCalledWith({
                method: 'GET',
                url: '/v0/markets',
                params: { q: 'bitcoin', sourceExchange: 'polymarket', limit: '20' },
            });
        });
    });

    describe('searchEvents', () => {
        it('calls GET /v0/events with query params', async () => {
            (mockAxiosInstance.request as jest.Mock).mockResolvedValue({
                data: { data: [] },
            });

            await client.searchEvents({ query: 'election', category: 'politics' });
            expect(mockAxiosInstance.request).toHaveBeenCalledWith({
                method: 'GET',
                url: '/v0/events',
                params: { q: 'election', category: 'politics' },
            });
        });
    });

    describe('error mapping', () => {
        function makeAxiosError(status: number, data?: any) {
            const error = new Error('Request failed') as any;
            error.isAxiosError = true;
            error.response = { status, data: data ?? { error: `Error ${status}` }, headers: {} };
            error.config = {};
            error.toJSON = () => ({});
            Object.defineProperty(error, '__CANCEL__', { value: false });
            return error;
        }

        it('maps 401 to AuthenticationError', async () => {
            (mockAxiosInstance.request as jest.Mock).mockRejectedValue(
                makeAxiosError(401, { error: 'Invalid API key' }),
            );
            await expect(client.getMarketMatches({ marketId: 'x' })).rejects.toThrow(AuthenticationError);
        });

        it('maps 404 to NotFound', async () => {
            (mockAxiosInstance.request as jest.Mock).mockRejectedValue(
                makeAxiosError(404, { error: 'market not found' }),
            );
            await expect(client.getMarketMatches({ marketId: 'x' })).rejects.toThrow(NotFound);
        });

        it('maps 429 to RateLimitExceeded', async () => {
            const err = makeAxiosError(429, { error: 'Too many requests' });
            err.response.headers = { 'retry-after': '30' };
            (mockAxiosInstance.request as jest.Mock).mockRejectedValue(err);
            await expect(client.getMarketMatches({ marketId: 'x' })).rejects.toThrow(RateLimitExceeded);
        });

        it('maps 400 to BadRequest', async () => {
            (mockAxiosInstance.request as jest.Mock).mockRejectedValue(
                makeAxiosError(400, { error: 'Invalid relation' }),
            );
            await expect(client.getMarketMatches({ marketId: 'x' })).rejects.toThrow(BadRequest);
        });
    });
});
