import { PmxtApiClient } from './client';
import type { UnifiedMarket, UnifiedEvent } from '../types';
import type {
    RouterOptions,
    MatchResult,
    EventMatchResult,
    PriceComparison,
    ArbitrageOpportunity,
    FetchMatchesParams,
    FetchEventMatchesParams,
    FetchArbitrageParams,
    RouterMarketSearchParams,
    RouterEventSearchParams,
} from './types';

export class Router {
    readonly name = 'Router';
    private readonly client: PmxtApiClient;

    constructor(options: RouterOptions) {
        this.client = new PmxtApiClient(options.apiKey, options.baseUrl);
    }

    // -----------------------------------------------------------------------
    // Core: Cross-exchange market matches
    // -----------------------------------------------------------------------

    async fetchMatches(params: FetchMatchesParams): Promise<MatchResult[]> {
        const response = await this.client.getMarketMatches(params);
        return response.matches ?? [];
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
            const sourceBid = sourceAsk; // Best approximation from last price
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

    // -----------------------------------------------------------------------
    // Cross-venue search
    // -----------------------------------------------------------------------

    async fetchMarkets(params?: RouterMarketSearchParams): Promise<UnifiedMarket[]> {
        const response = await this.client.searchMarkets(params);
        return response ?? [];
    }

    async fetchEvents(params?: RouterEventSearchParams): Promise<UnifiedEvent[]> {
        const response = await this.client.searchEvents(params);
        return response ?? [];
    }

    // -----------------------------------------------------------------------
    // Disabled: order routing (future)
    // -----------------------------------------------------------------------

    async createOrder(): Promise<never> {
        throw new Error('Router order routing is not yet implemented');
    }
}
