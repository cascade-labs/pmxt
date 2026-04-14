import { LimitlessExchange } from '../../../src/exchanges/limitless';

/**
 * Regression coverage for issue #85.
 *
 * fetchWatchedAddressActivity had .catch() handlers on the fetchPositions and
 * getAddressOnChainBalance promises that silently replaced errors with empty
 * arrays. This made broken API responses indistinguishable from legitimate
 * empty results.
 */
describe('LimitlessExchange: fetchWatchedAddressActivity error propagation (#85)', () => {
    let exchange: LimitlessExchange;

    beforeEach(() => {
        exchange = new LimitlessExchange();
    });

    it('propagates fetchPositions errors instead of swallowing them', async () => {
        const positionsError = new Error('Limitless API unavailable');
        (exchange as any).fetchPositions = jest.fn().mockRejectedValue(positionsError);

        await expect(
            (exchange as any).fetchWatchedAddressActivity({
                address: '0xabc',
                types: ['positions'],
            }),
        ).rejects.toThrow('Limitless API unavailable');
    });

    it('propagates getAddressOnChainBalance errors instead of swallowing them', async () => {
        const balanceError = new Error('RPC node timeout');
        (exchange as any).getAddressOnChainBalance = jest.fn().mockRejectedValue(balanceError);

        await expect(
            (exchange as any).fetchWatchedAddressActivity({
                address: '0xabc',
                types: ['balances'],
            }),
        ).rejects.toThrow('RPC node timeout');
    });

    it('propagates errors when both positions and balances fail', async () => {
        (exchange as any).fetchPositions = jest.fn().mockRejectedValue(new Error('positions fail'));
        (exchange as any).getAddressOnChainBalance = jest.fn().mockRejectedValue(new Error('balances fail'));

        await expect(
            (exchange as any).fetchWatchedAddressActivity({
                address: '0xabc',
                types: ['positions', 'balances'],
            }),
        ).rejects.toThrow();
    });

    it('returns data normally when fetches succeed', async () => {
        const mockPositions = [{ marketId: 'test', size: 10 }];
        const mockBalances = [{ currency: 'USDC', total: 100, available: 100, locked: 0 }];

        (exchange as any).fetchPositions = jest.fn().mockResolvedValue(mockPositions);
        (exchange as any).getAddressOnChainBalance = jest.fn().mockResolvedValue(mockBalances);

        const result = await (exchange as any).fetchWatchedAddressActivity({
            address: '0xabc',
            types: ['positions', 'balances'],
        });

        expect(result.positions).toEqual(mockPositions);
        expect(result.balances).toEqual(mockBalances);
        expect(result.address).toBe('0xabc');
    });
});
