import type { UnifiedMarket, UnifiedEvent } from '../types';

// ---------------------------------------------------------------------------
// Relation types (matches the matching engine's SetRelation)
// ---------------------------------------------------------------------------

export type MatchRelation = 'identity' | 'subset' | 'superset' | 'overlap' | 'disjoint';

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface RouterOptions {
    apiKey: string;
    baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export interface MatchResult {
    market: UnifiedMarket;
    relation: MatchRelation;
    confidence: number;
    reasoning: string | null;
    bestBid: number | null;
    bestAsk: number | null;
}

export interface EventMatchResult {
    event: UnifiedEvent;
    marketMatches: MatchResult[];
}

export interface PriceComparison {
    market: UnifiedMarket;
    relation: MatchRelation;
    confidence: number;
    reasoning: string | null;
    bestBid: number | null;
    bestAsk: number | null;
    venue: string;
}

export interface ArbitrageOpportunity {
    marketA: UnifiedMarket;
    marketB: UnifiedMarket;
    spread: number;
    buyVenue: string;
    sellVenue: string;
    buyPrice: number;
    sellPrice: number;
}

// ---------------------------------------------------------------------------
// Param types
// ---------------------------------------------------------------------------

export interface FetchMatchesParams {
    marketId?: string;
    slug?: string;
    url?: string;
    relation?: MatchRelation;
    minConfidence?: number;
    limit?: number;
    includePrices?: boolean;
}

export interface FetchEventMatchesParams {
    eventId?: string;
    slug?: string;
    relation?: MatchRelation;
    minConfidence?: number;
    limit?: number;
    includePrices?: boolean;
}

export interface FetchArbitrageParams {
    minSpread?: number;
    category?: string;
    limit?: number;
}

export interface RouterMarketSearchParams {
    query?: string;
    sourceExchange?: string;
    category?: string;
    limit?: number;
    offset?: number;
    closed?: boolean;
}

export interface RouterEventSearchParams {
    query?: string;
    sourceExchange?: string;
    category?: string;
    limit?: number;
    offset?: number;
    closed?: boolean;
}
