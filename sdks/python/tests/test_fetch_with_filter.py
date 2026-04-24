"""
Tests that the filter param on fetch_markets / fetch_events flows through
the SDK client correctly — i.e. the nested filter dict causes a POST
fallback and arrives intact in the sidecar args.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from pmxt._exchanges import Polymarket
from pmxt.models import (
    UnifiedMarket,
    MarketOutcome,
    UnifiedEvent,
    MarketFilterCriteria,
    EventFilterCriteria,
    MarketFetchParams,
    EventFetchParams,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_mock_response(data: dict) -> MagicMock:
    resp = MagicMock()
    resp.data = json.dumps(data).encode()
    resp.read = MagicMock()
    return resp


def _create_exchange(cls=Polymarket, **kwargs):
    with patch("pmxt.client.ServerManager") as MockSM:
        instance = MockSM.return_value
        instance.ensure_server_running.return_value = None
        instance.get_running_port.return_value = 3847
        instance.get_server_info.return_value = {"accessToken": "test-token"}
        exchange = cls(auto_start_server=True, **kwargs)
    exchange._server_manager = instance
    return exchange


# Raw API response fixtures (camelCase, as the sidecar returns)
RAW_POLITICS_MARKET = {
    "marketId": "1",
    "title": "Will Trump win?",
    "outcomes": [{"outcomeId": "1a", "label": "Yes", "price": 0.55}],
    "volume24h": 50000,
    "liquidity": 100000,
    "url": "https://example.com/1",
    "category": "Politics",
    "tags": ["Election"],
}

RAW_CRYPTO_MARKET = {
    "marketId": "2",
    "title": "Bitcoin above $100k?",
    "outcomes": [{"outcomeId": "2a", "label": "Yes", "price": 0.35}],
    "volume24h": 75000,
    "liquidity": 150000,
    "url": "https://example.com/2",
    "category": "Crypto",
    "tags": ["Bitcoin"],
}

RAW_POLITICS_EVENT = {
    "id": "e1",
    "title": "2024 Election",
    "description": "Election markets",
    "slug": "2024-election",
    "url": "https://example.com/event/1",
    "category": "Politics",
    "tags": ["Election"],
    "markets": [RAW_POLITICS_MARKET],
}

RAW_CRYPTO_EVENT = {
    "id": "e2",
    "title": "Crypto Prices",
    "description": "Crypto markets",
    "slug": "crypto-prices",
    "url": "https://example.com/event/2",
    "category": "Crypto",
    "tags": ["Bitcoin"],
    "markets": [RAW_CRYPTO_MARKET],
}


# ---------------------------------------------------------------------------
# Tests: fetch_markets with filter
# ---------------------------------------------------------------------------

class TestFetchMarketsFilter:
    """Verify filter dict is sent to the sidecar and results come back."""

    def test_filter_causes_post_fallback(self):
        """filter is a nested object, so _query_has_nested_object should be True."""
        from pmxt.client import Exchange
        query = {"query": "election", "filter": {"category": "Politics"}}
        assert Exchange._query_has_nested_object(query) is True

    def test_flat_query_no_post_fallback(self):
        """Without filter, query is flat — no POST fallback needed."""
        from pmxt.client import Exchange
        query = {"query": "election", "limit": 10}
        assert Exchange._query_has_nested_object(query) is False

    def test_filter_sent_in_post_args(self):
        """The filter dict should appear inside args[0] sent to the sidecar."""
        exchange = _create_exchange()
        mock_resp = _make_mock_response({
            "success": True,
            "data": [RAW_POLITICS_MARKET, RAW_CRYPTO_MARKET],
        })

        with patch.object(exchange._api_client, "call_api", return_value=mock_resp) as mock_call:
            exchange.fetch_markets({"query": "test", "filter": {"category": "Politics"}})

            # Should be a POST (due to nested filter object)
            call_kwargs = mock_call.call_args
            assert call_kwargs[1]["method"] == "POST"

            # The args in the body should contain the filter
            body = call_kwargs[1]["body"]
            if isinstance(body, str):
                body = json.loads(body)
            assert len(body["args"]) == 1
            assert body["args"][0]["filter"] == {"category": "Politics"}
            assert body["args"][0]["query"] == "test"

    def test_fetch_markets_returns_converted_markets(self):
        """Results are properly converted to UnifiedMarket dataclasses."""
        exchange = _create_exchange()
        mock_resp = _make_mock_response({
            "success": True,
            "data": [RAW_POLITICS_MARKET, RAW_CRYPTO_MARKET],
        })

        with patch.object(exchange._api_client, "call_api", return_value=mock_resp):
            markets = exchange.fetch_markets({"filter": {"category": "Crypto"}})

        assert len(markets) == 2  # filter is applied server-side, not in SDK
        assert all(isinstance(m, UnifiedMarket) for m in markets)

    def test_fetch_markets_without_filter_uses_post(self):
        """fetch_markets is a generated POST method — always uses POST."""
        exchange = _create_exchange()
        mock_resp = _make_mock_response({
            "success": True,
            "data": [RAW_POLITICS_MARKET],
        })

        with patch.object(exchange._api_client, "call_api", return_value=mock_resp) as mock_call:
            exchange.fetch_markets({"query": "trump"})

            call_kwargs = mock_call.call_args
            assert call_kwargs[1]["method"] == "POST"


# ---------------------------------------------------------------------------
# Tests: fetch_events with filter
# ---------------------------------------------------------------------------

class TestFetchEventsFilter:

    def test_filter_sent_in_post_args(self):
        exchange = _create_exchange()
        mock_resp = _make_mock_response({
            "success": True,
            "data": [RAW_POLITICS_EVENT, RAW_CRYPTO_EVENT],
        })

        with patch.object(exchange._api_client, "call_api", return_value=mock_resp) as mock_call:
            exchange.fetch_events({"query": "election", "filter": {"category": "Politics"}})

            call_kwargs = mock_call.call_args
            assert call_kwargs[1]["method"] == "POST"

            body = call_kwargs[1]["body"]
            if isinstance(body, str):
                body = json.loads(body)
            assert body["args"][0]["filter"] == {"category": "Politics"}

    def test_fetch_events_returns_converted_events(self):
        exchange = _create_exchange()
        mock_resp = _make_mock_response({
            "success": True,
            "data": [RAW_POLITICS_EVENT, RAW_CRYPTO_EVENT],
        })

        with patch.object(exchange._api_client, "call_api", return_value=mock_resp):
            events = exchange.fetch_events({"filter": {"category": "Crypto"}})

        assert len(events) == 2
        assert all(isinstance(e, UnifiedEvent) for e in events)


# ---------------------------------------------------------------------------
# Tests: type definitions are importable and usable
# ---------------------------------------------------------------------------

class TestFilterTypes:

    def test_market_fetch_params_accepts_filter(self):
        params: MarketFetchParams = {
            "query": "election",
            "limit": 10,
            "filter": {"category": "Politics"},
        }
        assert params["filter"]["category"] == "Politics"

    def test_event_fetch_params_accepts_filter(self):
        params: EventFetchParams = {
            "query": "election",
            "filter": {"category": "Crypto", "market_count": {"min": 2}},
        }
        assert params["filter"]["category"] == "Crypto"

    def test_filter_criteria_standalone(self):
        criteria: MarketFilterCriteria = {
            "category": "Politics",
            "volume_24h": {"min": 1000},
            "tags": ["Election"],
        }
        assert criteria["category"] == "Politics"

        event_criteria: EventFilterCriteria = {
            "category": "Crypto",
            "total_volume": {"min": 50000},
        }
        assert event_criteria["category"] == "Crypto"
