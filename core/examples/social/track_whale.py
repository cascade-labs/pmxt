import json
import os
import signal
import sys
from datetime import datetime

from pmxt_internal import ApiClient, Configuration, ApiException
from pmxt_internal.api.default_api import DefaultApi
from pmxt_internal.models import (
    WatchAddressRequest,
    WatchAddressRequestArgsInner,
    UnwatchAddressRequest,
)

URL = "http://localhost:3847"
EXCHANGE = "polymarket"


def fmt(address: str) -> str:
    if len(address) > 10:
        return f"{address[:6]}...{address[-4:]}"
    return address


def call_api(api_client: ApiClient, operation_id: str, params: dict = None):
    """Call an exchange implicit API method by operationId."""
    url = f"{URL}/api/{EXCHANGE}/callApi"
    body = {"args": [operation_id, params]}
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "x-pmxt-access-token": os.environ["PMXT_ACCESS_TOKEN"]
    }
    response = api_client.call_api(method="POST", url=url, body=body, header_params=headers)
    response.read()
    result = json.loads(response.data)
    if not result.get("success"):
        raise Exception(f"API error: {result.get('error')}")
    return result["data"]


def run():
    configuration = Configuration(host=URL)

    with ApiClient(configuration) as api_client:
        api = DefaultApi(api_client)

        # ── Step 1: Define and find whales ────────────────────────────────────
        # For simplicity, here I assume the trader with the largest volume is a "whale"
        print("Fetching top volume traders in all time...\n")
        whales = call_api(api_client, "getV1Leaderboard", {
            "category": "OVERALL",
            "timePeriod": "ALL",
            "orderBy": "VOL",
            "limit": 10,
        })

        print("Rank  Name                           Address        Volume (USDC)   PnL (USDC)")
        print("─" * 82)
        for w in whales:
            rank = str(w.get("rank", "")).rjust(2)
            name = fmt(w.get("userName", "")).ljust(30)
            addr = fmt(w.get("proxyWallet", "")).ljust(14)
            vol  = f"${w.get('vol', 0) / 1_000_000:.1f}M".rjust(14)
            pnl  = f"${w.get('pnl', 0) / 1_000:.1f}K".rjust(12)
            print(f"  {rank}  {name} {addr} {vol} {pnl}")

        # ── Step 2: Watch the top whale ───────────────────────────────────────
        whale = whales[0]
        label = whale.get("userName")
        address = whale.get("proxyWallet")
        print(f"\nWatching {label} ({address}) ...")
        print("Press Ctrl+C to stop.\n")

        running = True

        def handle_sigint(sig, frame):
            nonlocal running
            print("\nStopping...")
            running = False
            try:
                api.unwatch_address(
                    exchange=EXCHANGE,
                    unwatch_address_request=UnwatchAddressRequest(args=[address]),
                    _headers={"x-pmxt-access-token": os.environ["PMXT_ACCESS_TOKEN"]},
                )
            except Exception:
                pass
            finally:
                sys.exit(0)

        signal.signal(signal.SIGINT, handle_sigint)

        try:
            while running:
                response = api.watch_address(
                    exchange=EXCHANGE,
                    watch_address_request=WatchAddressRequest(
                        args=[WatchAddressRequestArgsInner(address)],
                    ),
                    _headers={"x-pmxt-access-token": os.environ["PMXT_ACCESS_TOKEN"]},
                )
                if not response.success:
                    raise Exception(f"Watch error: {response.error}")
                print(f"\n[Update @ {datetime.now().strftime('%H:%M:%S')}]")
                print(response.data)
        except ApiException as e:
            print(f"Error: {e}")


if __name__ == "__main__":
    run()