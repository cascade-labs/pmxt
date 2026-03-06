import pmxt from '../../src';

function fmt(address: string) {
    if (address.length > 10) {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }
    return address;
}

async function run() {
    const exchange = new pmxt.Polymarket();

    // ── Step 1: Define and find whales ────────────────────────────────────────────────
    // For simplicity, here I assume the trader with the largest volume is a "whale"
    console.log(`Fetching top volume traders in all time...\n`);
    const whales = await exchange.getV1Leaderboard({ category: 'OVERALL', timePeriod: 'ALL', orderBy: 'VOL' });

    console.log('Rank  Name                           Address        Volume (USDC)   PnL (USDC)');
    console.log('─'.repeat(82));
    for (const w of whales) {
        const name = (fmt(w.userName)).padEnd(30);
        const addr = fmt(w.proxyWallet).padEnd(14);
        const vol = `$${(w.vol / 1_000_000).toFixed(1)}M`.padStart(14);
        const pnl = `$${(w.pnl / 1_000).toFixed(1)}K`.padStart(12);
        console.log(`  ${w.rank.padStart(2)}  ${name} ${addr} ${vol} ${pnl}`);
    }

    // ── Step 2: watch the top whale ────────────────────────────────────────────
    const whale = whales[0];
    const label = whale.userName;
    console.log(`Watching ${label} (${whale.proxyWallet} ...`);
    console.log('Press Ctrl+C to stop.\n');

    // Graceful shutdown
    let running = true;
    process.on('SIGINT', async () => {
        console.log('Stopping...');
        running = false;
        await exchange.unwatchAddress(whale.proxyWallet);
        process.exit(0);
    });

    try {
        while (running) {
            const update = await exchange.watchAddress(whale.proxyWallet);
            console.log(`\n[Update @ ${new Date().toLocaleTimeString()}]`);
            console.log(update);
        }
    } catch (err) {
        console.error(err);
    }
}

run().catch(console.error);
