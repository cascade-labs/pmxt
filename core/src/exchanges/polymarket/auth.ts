import { ClobClient } from '@polymarket/clob-client';
import type { ApiKeyCreds } from '@polymarket/clob-client';
import { Wallet } from 'ethers';
import axios from 'axios';
import { ExchangeCredentials } from '../../BaseExchange';
import { polymarketErrorMapper } from './errors';

const POLYMARKET_HOST = 'https://clob.polymarket.com';
const POLYGON_CHAIN_ID = 137;

/**
 * Manages Polymarket authentication and CLOB client initialization.
 * Handles both L1 (wallet-based) and L2 (API credentials) authentication.
 */
export class PolymarketAuth {
    private credentials: ExchangeCredentials;
    private signer?: Wallet;
    private clobClient?: ClobClient;
    private apiCreds?: ApiKeyCreds;
    private discoveredProxyAddress?: string;
    private discoveredSignatureType?: number;

    constructor(credentials: ExchangeCredentials) {
        this.credentials = credentials;

        if (!credentials.privateKey) {
            throw new Error('Polymarket requires a privateKey for authentication');
        }

        // Initialize the signer
        let privateKey = credentials.privateKey;
        // Fix for common .env issue where newlines are escaped
        if (privateKey.includes('\\n')) {
            privateKey = privateKey.replace(/\\n/g, '\n');
        }

        // Validate key format before passing to ethers. Solana wallets
        // (e.g. Phantom) export base58 ed25519 keys which are not
        // compatible with EVM. Detect early and give a clear message.
        const stripped = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
        if (!/^[0-9a-fA-F]{64}$/.test(stripped)) {
            throw new Error(
                'Invalid private key format. Polymarket requires a 32-byte hex EVM private key ' +
                '(e.g. 0xabc123...). If you exported this key from Phantom or another Solana wallet, ' +
                'note that Solana keys are not compatible with EVM. Import your recovery phrase ' +
                'into an EVM wallet (e.g. MetaMask) to obtain the correct key.'
            );
        }

        this.signer = new Wallet(privateKey);
    }

    /**
     * Get or create API credentials using L1 authentication.
     * This uses the private key to derive/create API credentials.
     */
    async getApiCredentials(): Promise<ApiKeyCreds> {
        // Return cached credentials if available
        if (this.apiCreds) {
            return this.apiCreds;
        }

        // If credentials were provided, use them
        if (this.credentials.apiKey && this.credentials.apiSecret && this.credentials.passphrase) {
            this.apiCreds = {
                key: this.credentials.apiKey,
                secret: this.credentials.apiSecret,
                passphrase: this.credentials.passphrase,
            };
            return this.apiCreds;
        }

        // Otherwise, derive/create them using L1 auth
        const l1Client = new ClobClient(
            POLYMARKET_HOST,
            POLYGON_CHAIN_ID,
            this.signer
        );

        // Robust derivation strategy:
        // 1. Try to DERIVE existing credentials first (most common case).
        // 2. If that fails (e.g. 404 or 400), try to CREATE new ones.

        let creds: ApiKeyCreds | undefined;

        try {
            // console.log('Trying to derive existing API key...');
            creds = await l1Client.deriveApiKey();
            if (!creds || !creds.key || !creds.secret || !creds.passphrase) {
                // If derived creds are missing, throw to trigger catch -> create
                throw new Error("Derived credentials are incomplete/empty");
            }
        } catch (deriveError: any) {
            console.log('[PolymarketAuth] Derivation failed:', deriveError.message || deriveError);
            console.log('[PolymarketAuth] Attempting to create new API key...');
            try {
                creds = await l1Client.createApiKey();
            } catch (createError: any) {
                throw polymarketErrorMapper.mapError(createError);
            }
        }

        if (!creds || !creds.key || !creds.secret || !creds.passphrase) {
            console.error('[PolymarketAuth] Incomplete credentials:', { hasKey: !!creds?.key, hasSecret: !!creds?.secret, hasPassphrase: !!creds?.passphrase });
            throw new Error('Authentication failed: Derived credentials are incomplete.');
        }

        // console.log(`[PolymarketAuth] Successfully obtained API credentials for key ${creds.key.substring(0, 8)}...`);
        this.apiCreds = creds;
        return creds;
    }

    /**
     * Discover the proxy address and signature type for the signer.
     */
    async discoverProxy(): Promise<{ proxyAddress: string; signatureType: number }> {
        if (this.discoveredProxyAddress) {
            return {
                proxyAddress: this.discoveredProxyAddress,
                signatureType: this.discoveredSignatureType ?? 0
            };
        }

        const address = this.signer!.address;
        try {
            // Polymarket Data API / Profiles endpoint
            // Path-based: https://data-api.polymarket.com/profiles/0x...
            const response = await axios.get(`https://data-api.polymarket.com/profiles/${address}`, {
                headers: { 'User-Agent': 'pmxt (https://github.com/pmxt-dev/pmxt)' }
            });
            const profile = response.data;
            // console.log(`[PolymarketAuth] Profile for ${address}:`, JSON.stringify(profile));

            if (profile && profile.proxyAddress) {
                this.discoveredProxyAddress = profile.proxyAddress;
                // Determine signature type. 
                // Polymarket usually uses 1 for their own proxy and 2 for Gnosis Safe (which is what their new profiles use).
                // If it's a proxy address but we don't know the type, 1 is a safe default for Polymarket.
                this.discoveredSignatureType = profile.isGnosisSafe ? 2 : 1;

                // console.log(`[PolymarketAuth] Auto-discovered proxy for ${address}: ${this.discoveredProxyAddress} (Type: ${this.discoveredSignatureType})`);
                return {
                    proxyAddress: this.discoveredProxyAddress as string,
                    signatureType: this.discoveredSignatureType as number
                };
            }
        } catch (error: any) {
            // console.warn(`[PolymarketAuth] Could not auto-discover proxy for ${address}:`, error instanceof Error ? error.message : error);
        }

        // Fallback to EOA if discovery fails
        return {
            proxyAddress: address,
            signatureType: 0
        };
    }

    /**
     * Maps human-readable signature type names to their numeric values.
     */
    private mapSignatureType(type: number | string | undefined | null): number {
        if (type === undefined || type === null) return 0;
        if (typeof type === 'number') return type;

        const normalized = type.toLowerCase().replace(/[^a-z0-9]/g, '');
        switch (normalized) {
            case 'eoa':
                return 0;
            case 'polyproxy':
            case 'polymarketproxy':
                return 1;
            case 'gnosissafe':
            case 'safe':
                return 2;
            default:
                // If it's a numeric string, parse it
                const parsed = parseInt(normalized);
                return isNaN(parsed) ? 0 : parsed;
        }
    }

    /**
     * Get an authenticated CLOB client for L2 operations (trading).
     * This client can place orders, cancel orders, query positions, etc.
     */
    async getClobClient(): Promise<ClobClient> {
        // Return cached client if available
        if (this.clobClient) {
            return this.clobClient;
        }

        // 1. Determine proxy and signature type early.
        //
        // Important: if signatureType is not provided we MUST run discovery
        // even when funderAddress is provided. Previously this branch was
        // skipped whenever funderAddress was set, which silently defaulted
        // signatureType to 0 (EOA). For wallets whose funds live on a Gnosis
        // Safe (the modern Polymarket onboarding default) the CLOB then
        // reports balance "0" instead of the real value, with no error.
        const sigTypeProvided =
            this.credentials.signatureType !== undefined && this.credentials.signatureType !== null;
        let proxyAddress = this.credentials.funderAddress || undefined;
        let signatureType: number | undefined = sigTypeProvided
            ? this.mapSignatureType(this.credentials.signatureType)
            : undefined;

        // Run discovery if either piece is missing. Note: discoverProxy()
        // returns a synthetic { proxyAddress: signerEOA, signatureType: 0 }
        // fallback when its HTTP call fails — that fallback should NOT be
        // used to populate signatureType when funderAddress is already set,
        // because it would silently assign EOA semantics to a Gnosis Safe.
        let discoverySucceeded = false;
        if (!proxyAddress || signatureType === undefined) {
            try {
                const discovered = await this.discoverProxy();
                discoverySucceeded =
                    !!this.discoveredProxyAddress &&
                    this.discoveredSignatureType !== undefined;
                if (!proxyAddress) {
                    proxyAddress = discovered.proxyAddress;
                }
                if (signatureType === undefined && discoverySucceeded) {
                    signatureType = discovered.signatureType;
                }
            } catch {
                // Discovery failure is handled by the heuristic below.
            }
        }

        // Get API credentials (L1 auth)
        const apiCreds = await this.getApiCredentials();

        // 3. Defaults
        const signerAddress = this.signer!.address;
        const finalProxyAddress: string = (proxyAddress || signerAddress) as string;
        // If signature type is still unknown, infer from address relationship:
        // when the funder differs from the signer EOA, the funder must be a
        // proxy/safe — default to Gnosis Safe (2), which is what Polymarket
        // has created for new accounts since 2023. Users on the legacy
        // Polymarket Proxy (1) need to set signatureType explicitly.
        if (signatureType === undefined) {
            signatureType =
                finalProxyAddress.toLowerCase() !== signerAddress.toLowerCase() ? 2 : 0;
        }
        const finalSignatureType: number = signatureType;

        // Create L2-authenticated client
        // console.log(`[PolymarketAuth] Initializing ClobClient | Signer: ${signerAddress} | Funder: ${finalProxyAddress} | SigType: ${finalSignatureType}`);

        this.clobClient = new ClobClient(
            POLYMARKET_HOST,
            POLYGON_CHAIN_ID,
            this.signer,
            apiCreds,
            finalSignatureType,
            finalProxyAddress
        );

        return this.clobClient;
    }

    /**
     * Get the funder address (Proxy) if available.
     * Note: This is an async-safe getter if discovery is needed.
     */
    async getEffectiveFunderAddress(): Promise<string> {
        if (this.credentials.funderAddress) {
            return this.credentials.funderAddress;
        }
        const discovered = await this.discoverProxy();
        return discovered.proxyAddress;
    }

    /**
     * Synchronous getter for credentials funder address.
     */
    getFunderAddress(): string {
        return this.credentials.funderAddress || this.signer!.address;
    }

    /**
     * Get the signer's address.
     */
    getAddress(): string {
        return this.signer!.address;
    }

    /**
     * Reset cached credentials and client (useful for testing or credential rotation).
     */
    reset(): void {
        this.apiCreds = undefined;
        this.clobClient = undefined;
    }
}
