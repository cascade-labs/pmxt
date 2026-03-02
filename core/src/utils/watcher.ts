import { WatchedAddressActivity, WatchedAddressOption, Position, Balance } from '../types';

interface QueuedResolver {
    resolve: (value: WatchedAddressActivity) => void;
    reject: (reason?: any) => void;
}

type FetchFn = (address: string, types: WatchedAddressOption[]) => Promise<WatchedAddressActivity>;

/**
 * Partial activity constructed from a watched event's on-chain data.
 * Only the types that could be fully derived from the event are present.
 */
export type WatchedEventActivity = Partial<Omit<WatchedAddressActivity, 'address' | 'timestamp'>>;

/**
 * Tries to build a partial WatchedAddressActivity from raw watched event data.
 *
 * Data is the raw GraphQL payload, the watched address, the requested types,
 * and the last known activity snapshot.
 *
 * Return an `WatchedEventActivity` object containing only the types you can fully
 * populate from the event — the watcher will fetch the remaining types via
 * REST/RPC. Return `null` to fall back to a full REST/RPC fetch for all options.
 */
export type ActivityBuilder = (
    data: unknown,
    address: string,
    types: WatchedAddressOption[],
    lastActivity?: WatchedAddressActivity | null,
) => WatchedEventActivity | null;

// ----------------------------------------------------------------------------
// AddressSubscriber interface
// ----------------------------------------------------------------------------

/**
 * Optional subscription that notifies the watcher of on-chain activity for a
 * watched address.
 */
export interface AddressSubscriber {
    /**
     * Start receiving notifications for `address`.
     * Resolves once the subscription is active, or throws if the watcher
     * cannot be set up (the watcher will fall back to polling-only on error).
     */
    subscribe(address: string, onEvent: (data: unknown) => void): Promise<void>;
    /** Stop receiving notifications for `address`. */
    unsubscribe(address: string): void;
    /** Tear down all subscriptions and close underlying connections. */
    close(): void;
}

// ----------------------------------------------------------------------------
// Options
// ----------------------------------------------------------------------------

export interface AddressWatcherOptions {
    /**
     * Polling interval when no GraphQl subscription is configured.
     * @default 3000
     */
    pollMs?: number;
    /**
     * Optional subscriber. When provided, the watcher stops polling at
     * `pollMs` intervals and calls `subscriber.subscribe()` for each address so
     * that on-chain events can be delivered immediately.
     */
    subscriber?: AddressSubscriber;
    /**
     * Optional function to extract partial activity from raw subscribed event
     * data. It should be provided with `subscriber` to take effects.
     * When provided, the watcher calls this before falling back to a
     * full REST/RPC fetch.
     *
     * - Return an `WatchedEventActivity` with only the types you can fully populate
     *   from the event data — the watcher will fetch the remaining types via
     *   REST/RPC.
     * - Return `null` to fall back to a full fetch for all requested types.
     */
    buildActivity?: ActivityBuilder;
}

// ----------------------------------------------------------------------------
// WatcherManager Class
// ----------------------------------------------------------------------------

/**
 * Subscribes to address-level activity or polls an exchange's REST endpoints when a
 * subscriber is not available. And it resolves waiting promises whenever a change is
 * detected.
 *
 * When an `AddressSubscriber` is supplied the watcher is push-driven:
 * - The subscription fires immediately on on-chain events, bypassing the poll interval.
 * - If a `buildActivity` function is also supplied, the watcher first tries to
 *   construct a partial `WatchedAddressActivity` from the raw event data. Only the
 *   types that cannot be derived from the event are fetched via REST/RPC.
 *
 * Without a subscriber, the watcher polls every `pollMs` milliseconds.
 *
 * Both modes follow the CCXT Pro streaming pattern:
 * - First `watch()` call → initial snapshot returned immediately.
 * - Subsequent calls → block until the next detected change.
 */
export class WatcherManager {
    private pollTimers = new Map<string, ReturnType<typeof setInterval>>();
    private resolvers = new Map<string, QueuedResolver[]>();
    private lastState = new Map<string, WatchedAddressActivity>();
    private watchedTypes = new Map<string, WatchedAddressOption[]>();
    private pollingInFlight = new Set<string>();

    private readonly pollMs: number;
    private readonly fetchFn: FetchFn;
    private readonly subscriber?: AddressSubscriber;
    private readonly buildActivity?: ActivityBuilder;

    constructor(fetchFn: FetchFn, options: AddressWatcherOptions = {}) {
        this.fetchFn = fetchFn;
        this.pollMs = options.pollMs ?? 3000;
        this.subscriber = options.subscriber;
        this.buildActivity = options.buildActivity;
    }

    /**
     * Watch an address for activity changes.
     *
     * @param address - Public wallet address to watch
     * @param types - Subset of activity to watch
     * @returns Promise that resolves with the latest WatchedAddressActivity snapshot
     */
    async watch(address: string, types: WatchedAddressOption[]): Promise<WatchedAddressActivity> {
        const key = address.toLowerCase();

        if (!this.watchedTypes.has(key)) {
            this.watchedTypes.set(key, types);

            let needTimer = true;
            if (this.subscriber) {
                try {
                    await this.subscriber.subscribe(address, (data) => this.handleSubscriptionData(address, data));
                    needTimer = false;
                } catch (err: any) {
                    console.warn(
                        `[AddressSubscriber] Address subscription failed for ${address}, ` +
                        `falling back to polling only with interval ${this.pollMs}: ${err?.message ?? err}`,
                    );
                }
            }

            const initial = await this.fetchFn(address, types);
            this.lastState.set(key, initial);

            if (needTimer) {
                const timer = setInterval(() => this.poll(address), this.pollMs);
                this.pollTimers.set(key, timer);
            }
            return initial;
        }

        // Refresh the set of watched types on each call as it might change across requests
        this.watchedTypes.set(key, types);

        return new Promise<WatchedAddressActivity>((resolve, reject) => {
            if (!this.resolvers.has(key)) {
                this.resolvers.set(key, []);
            }
            this.resolvers.get(key)!.push({ resolve, reject });
        });
    }

    /**
     * Handle raw event data from the subscriber.
     *
     * @param address - Public wallet address to watch
     * @param data - Subset of activity to watch
     *
     * Calls `buildActivity` to attempt constructing a partial result from the
     * event payload. Fetches only the types that are missing from the partial,
     * then resolves any waiting promises if a change is detected.
     *
     * Falls back to a full `poll()` when no `buildActivity` is configured or
     * when it returns `null`.
     */
    private async handleSubscriptionData(address: string, data: unknown): Promise<void> {
        const key = address.toLowerCase();
        const types = this.watchedTypes.get(key);
        if (!types || this.pollingInFlight.has(key)) return;

        const lastActivity = this.lastState.get(key);
        const partial = this.buildActivity
            ? this.buildActivity(data, address, types, lastActivity)
            : null;

        if (partial === null) {
            return this.poll(address);
        }

        // Have a partial — fetch only the types not covered by the event data
        this.pollingInFlight.add(key);
        try {
            const missingTypes = types.filter(t => !(t in partial)) as WatchedAddressOption[];
            let merged: WatchedAddressActivity;

            if (missingTypes.length > 0) {
                const fetched = await this.fetchFn(address, missingTypes);
                merged = { ...fetched, ...partial, address, timestamp: Date.now() };
            } else {
                // All types derived from event — no REST/RPC call needed
                merged = { address, timestamp: Date.now(), ...partial };
            }

            const last = this.lastState.get(key);
            if (!last || this.activitiesChanged(last, merged)) {
                this.lastState.set(key, merged);
                const resolvers = this.resolvers.get(key);
                if (resolvers?.length) {
                    resolvers.forEach(r => r.resolve(merged));
                    this.resolvers.set(key, []);
                }
            }
        } catch {
        } finally {
            this.pollingInFlight.delete(key);
        }
    }

    /**
     * Fetch current state.
     *
     * @param address - Public wallet address to watch
     *
     * Protected against concurrent execution for the same address.
     */
    private async poll(address: string): Promise<void> {
        const key = address.toLowerCase();
        const types = this.watchedTypes.get(key);
        if (!types) return;

        if (this.pollingInFlight.has(key)) return;
        this.pollingInFlight.add(key);

        try {
            const current = await this.fetchFn(address, types);
            const last = this.lastState.get(key);

            if (!last || this.activitiesChanged(last, current)) {
                this.lastState.set(key, current);
                const resolvers = this.resolvers.get(key);
                if (resolvers && resolvers.length > 0) {
                    resolvers.forEach(r => r.resolve(current));
                    this.resolvers.set(key, []);
                }
            }
        } catch {
        } finally {
            this.pollingInFlight.delete(key);
        }
    }

    private activitiesChanged(prev: WatchedAddressActivity, curr: WatchedAddressActivity): boolean {
        // Trades: count or most-recent ID changed
        if (prev.trades !== undefined && curr.trades !== undefined) {
            if (prev.trades.length !== curr.trades.length) return true;
            if (prev.trades.length > 0 && prev.trades[0].id !== curr.trades[0].id) return true;
        } else if (prev.trades !== undefined || curr.trades !== undefined) {
            return true;
        }

        // Positions: count or any (marketId, size) pair changed
        if (prev.positions !== undefined && curr.positions !== undefined) {
            if (prev.positions.length !== curr.positions.length) return true;
            const sort = (ps: Position[]) =>
                [...ps].sort((a, b) => a.marketId.localeCompare(b.marketId));
            const sp = sort(prev.positions);
            const sc = sort(curr.positions);
            for (let i = 0; i < sp.length; i++) {
                if (sp[i].marketId !== sc[i].marketId || sp[i].size !== sc[i].size) return true;
            }
        } else if (prev.positions !== undefined || curr.positions !== undefined) {
            return true;
        }

        // Balances: count or any total changed
        if (prev.balances !== undefined && curr.balances !== undefined) {
            if (prev.balances.length !== curr.balances.length) return true;
            const sort = (bs: Balance[]) =>
                [...bs].sort((a, b) => a.currency.localeCompare(b.currency));
            const sb = sort(prev.balances);
            const cb = sort(curr.balances);
            for (let i = 0; i < sb.length; i++) {
                if (sb[i].total !== cb[i].total) return true;
            }
        } else if (prev.balances !== undefined || curr.balances !== undefined) {
            return true;
        }

        return false;
    }

    /**
     * Stop watching an address, cancel its poll timer, unsubscribe from the
     * subscriber, and reject any pending callers.
     *
     * @param address - Public wallet address to unwatch
     */
    unwatch(address: string): void {
        const key = address.toLowerCase();

        const timer = this.pollTimers.get(key);
        if (timer) {
            clearInterval(timer);
            this.pollTimers.delete(key);
        }

        this.subscriber?.unsubscribe(address);

        const resolvers = this.resolvers.get(key);
        if (resolvers) {
            resolvers.forEach(r => r.reject(new Error(`Stopped watching ${address}`)));
            this.resolvers.delete(key);
        }

        this.lastState.delete(key);
        this.watchedTypes.delete(key);
        this.pollingInFlight.delete(key);
    }

    /** Stop all active watchers and close the underlying trigger. */
    close(): void {
        for (const address of [...this.pollTimers.keys()]) {
            this.unwatch(address);
        }
        this.subscriber?.close();
    }
}
