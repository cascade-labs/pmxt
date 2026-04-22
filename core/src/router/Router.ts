import {
    PredictionMarketExchange,
    type ExchangeCredentials,
    type MarketFetchParams,
    type EventFetchParams,
} from '../BaseExchange';
import type { UnifiedMarket, UnifiedEvent } from '../types';
import { PmxtApiClient } from './client';
import type {
    RouterOptions,
    MatchResult,
    EventMatchResult,
    PriceComparison,
    ArbitrageOpportunity,
    FetchMatchesParams,
    FetchEventMatchesParams,
    FetchArbitrageParams,
} from './types';

export class Router extends PredictionMarketExchange {
    private readonly client: PmxtApiClient;

    constructor(options: RouterOptions) {
        super({ apiKey: options.apiKey } as ExchangeCredentials);
        this.client = new PmxtApiClient(options.apiKey, options.baseUrl);
        this.rateLimit = 100;
    }

    get name(): string {
        return 'Router';
    }

    // -----------------------------------------------------------------------
    // BaseExchange implementation delegates
    // -----------------------------------------------------------------------

    protected async fetchMarketsImpl(params?: MarketFetchParams): Promise<UnifiedMarket[]> {
        const response = await this.client.searchMarkets({
            query: params?.query,
            category: params?.category,
            limit: params?.limit,
            offset: params?.offset,
            closed: params?.status === 'closed' || params?.status === 'inactive',
        });
        return response ?? [];
    }

    protected async fetchEventsImpl(params?: EventFetchParams): Promise<UnifiedEvent[]> {
        const response = await this.client.searchEvents({
            query: params?.query,
            category: params?.category,
            limit: params?.limit,
            offset: params?.offset,
        });
        return response ?? [];
    }

    // -----------------------------------------------------------------------
    // Cross-exchange market matches
    // -----------------------------------------------------------------------

    async fetchMatches(params: FetchMatchesParams): Promise<MatchResult[]> {
        const response = await this.client.getMarketMatches(params);
        const matches = response.matches ?? [];
        return matches.map((m: any) => ({
            market: m.market,
            relation: m.relation,
            confidence: m.confidence,
            reasoning: m.reasoning ?? null,
            bestBid: m.market?.bestBid ?? null,
            bestAsk: m.market?.bestAsk ?? null,
        }));
    }

    // -----------------------------------------------------------------------
    // Cross-exchange event matches
    // -----------------------------------------------------------------------

    async fetchEventMatches(params: FetchEventMatchesParams): Promise<EventMatchResult[]> {
        const response = await this.client.getEventMatches(params);
        return response.matches ?? [];
    }

    // -----------------------------------------------------------------------
    // Price comparison: identity matches with live prices
    // -----------------------------------------------------------------------

    async compareMarketPrices(params: FetchMatchesParams): Promise<PriceComparison[]> {
        const matches = await this.fetchMatches({
            ...params,
            relation: 'identity',
            includePrices: true,
        });

        return matches.map((m) => ({
            market: m.market,
            relation: m.relation,
            confidence: m.confidence,
            reasoning: m.reasoning,
            bestBid: m.bestBid,
            bestAsk: m.bestAsk,
            venue: (m.market as any).sourceExchange ?? '',
        }));
    }

    // -----------------------------------------------------------------------
    // Hedging: subset/superset matches with live prices
    // -----------------------------------------------------------------------

    async fetchHedges(params: FetchMatchesParams): Promise<PriceComparison[]> {
        const matches = await this.fetchMatches({
            ...params,
            includePrices: true,
        });

        return matches
            .filter((m) => m.relation === 'subset' || m.relation === 'superset')
            .map((m) => ({
                market: m.market,
                relation: m.relation,
                confidence: m.confidence,
                reasoning: m.reasoning,
                bestBid: m.bestBid,
                bestAsk: m.bestAsk,
                venue: (m.market as any).sourceExchange ?? '',
            }));
    }

    // -----------------------------------------------------------------------
    // Arbitrage: scan identity matches for price spreads
    // -----------------------------------------------------------------------

    async fetchArbitrage(params?: FetchArbitrageParams): Promise<ArbitrageOpportunity[]> {
        const minSpread = params?.minSpread ?? 0;
        const limit = params?.limit ?? 50;

        const markets = await this.fetchMarkets({
            category: params?.category,
            limit,
        });

        const opportunities: ArbitrageOpportunity[] = [];

        for (const market of markets) {
            const matches = await this.fetchMatches({
                marketId: market.marketId,
                relation: 'identity',
                includePrices: true,
            });
            if (matches.length === 0) continue;

            const sourceAsk = market.outcomes[0]?.price ?? null;
            const sourceBid = sourceAsk;
            const sourceVenue = (market as any).sourceExchange ?? '';

            for (const match of matches) {
                const matchBid = match.bestBid;
                const matchAsk = match.bestAsk;
                const matchVenue = (match.market as any).sourceExchange ?? '';

                if (sourceAsk !== null && matchBid !== null) {
                    const spread = matchBid - sourceAsk;
                    if (spread >= minSpread) {
                        opportunities.push({
                            marketA: market,
                            marketB: match.market,
                            spread,
                            buyVenue: sourceVenue,
                            sellVenue: matchVenue,
                            buyPrice: sourceAsk,
                            sellPrice: matchBid,
                        });
                    }
                }

                if (matchAsk !== null && sourceBid !== null) {
                    const spread = sourceBid - matchAsk;
                    if (spread >= minSpread) {
                        opportunities.push({
                            marketA: match.market,
                            marketB: market,
                            spread,
                            buyVenue: matchVenue,
                            sellVenue: sourceVenue,
                            buyPrice: matchAsk,
                            sellPrice: sourceBid,
                        });
                    }
                }
            }
        }

        opportunities.sort((a, b) => b.spread - a.spread);
        return opportunities;
    }
}
