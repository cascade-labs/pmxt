/**
 * Polymarket US runtime configuration.
 *
 * Hand-authored single source of truth for base URLs and config factory
 * for the Polymarket US exchange adapter (wraps the polymarket-us SDK).
 */

// -- Base URL constants -------------------------------------------------------

export const POLYMARKET_US_API_BASE_URL = "https://api.polymarket.us";
export const POLYMARKET_US_GATEWAY_BASE_URL = "https://gateway.polymarket.us";

// -- Config interface & factory -----------------------------------------------

export interface PolymarketUSConfig {
    /** Base REST API URL */
    apiUrl: string;
    /** Gateway URL (used by the SDK for order signing / submission) */
    gatewayUrl: string;
}

/**
 * Return a typed config object for the Polymarket US API.
 */
export function getPolymarketUSConfig(): PolymarketUSConfig {
    return {
        apiUrl: POLYMARKET_US_API_BASE_URL,
        gatewayUrl: POLYMARKET_US_GATEWAY_BASE_URL,
    };
}
