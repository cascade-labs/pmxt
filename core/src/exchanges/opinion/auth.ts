import { Client, type ClientConfig, DEFAULT_API_HOST } from '@opinion-labs/opinion-clob-sdk';
import { ExchangeCredentials } from '../../BaseExchange';
import { OPINION_CHAIN_ID, OPINION_DEFAULT_RPC_URL } from './config';

export class OpinionAuth {
    private readonly apiKey: string;
    private readonly privateKey?: string;
    private readonly rpcUrl: string;
    private readonly multiSigAddress?: string;
    private clobClient?: Client;
    private tradingEnabled = false;

    constructor(credentials: ExchangeCredentials) {
        if (!credentials.apiKey) {
            throw new Error('Opinion Trade requires an apiKey for authentication');
        }
        this.apiKey = credentials.apiKey;
        this.privateKey = credentials.privateKey;
        this.rpcUrl = OPINION_DEFAULT_RPC_URL;
        this.multiSigAddress = credentials.funderAddress;
    }

    getHeaders(): Record<string, string> {
        return {
            'apikey': this.apiKey,
            'Content-Type': 'application/json',
        };
    }

    getWsUrl(): string {
        return `wss://ws.opinion.trade?apikey=${encodeURIComponent(this.apiKey)}`;
    }

    hasTradeCredentials(): boolean {
        return !!this.privateKey;
    }

    getClobClient(): Client {
        if (this.clobClient) {
            return this.clobClient;
        }

        if (!this.privateKey) {
            throw new Error(
                'Trading requires a privateKey. ' +
                'Initialize OpinionExchange with credentials including privateKey.',
            );
        }

        if (!this.multiSigAddress) {
            throw new Error(
                'Trading requires a funderAddress (multiSigAddress). ' +
                'Initialize OpinionExchange with credentials including funderAddress.',
            );
        }

        const config: ClientConfig = {
            host: DEFAULT_API_HOST,
            apiKey: this.apiKey,
            chainId: OPINION_CHAIN_ID as 56,
            rpcUrl: this.rpcUrl,
            privateKey: this.privateKey as `0x${string}`,
            multiSigAddress: this.multiSigAddress as `0x${string}`,
        };

        this.clobClient = new Client(config);
        return this.clobClient;
    }

    async ensureTradingEnabled(): Promise<void> {
        if (this.tradingEnabled) {
            return;
        }
        const client = this.getClobClient();
        await client.enableTrading();
        this.tradingEnabled = true;
    }
}
