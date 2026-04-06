import { PolymarketUSErrorMapper } from './errors';
import {
    AuthenticationError as SdkAuthError,
    BadRequestError,
    NotFoundError,
    RateLimitError,
    InternalServerError,
} from 'polymarket-us';
import {
    AuthenticationError,
    BaseError,
    ExchangeNotAvailable,
    InsufficientFunds,
    InvalidOrder,
    MarketNotFound,
    OrderNotFound,
    RateLimitExceeded,
} from '../../errors';

describe('PolymarketUSErrorMapper', () => {
    const mapper = new PolymarketUSErrorMapper();

    test('maps SDK AuthenticationError -> PMXT AuthenticationError', () => {
        const mapped = mapper.mapError(new SdkAuthError('bad token'));
        expect(mapped).toBeInstanceOf(AuthenticationError);
        expect((mapped as AuthenticationError).exchange).toBe('PolymarketUS');
    });

    test('maps BadRequestError("Insufficient buying power") -> InsufficientFunds', () => {
        const mapped = mapper.mapError(
            new BadRequestError('Insufficient buying power')
        );
        expect(mapped).toBeInstanceOf(InsufficientFunds);
    });

    test('maps BadRequestError("Invalid price tick") -> InvalidOrder', () => {
        const mapped = mapper.mapError(
            new BadRequestError('Invalid price tick')
        );
        expect(mapped).toBeInstanceOf(InvalidOrder);
    });

    test('maps BadRequestError("Self-match prevented") -> InvalidOrder', () => {
        const mapped = mapper.mapError(
            new BadRequestError('Self-match prevented')
        );
        expect(mapped).toBeInstanceOf(InvalidOrder);
    });

    test('maps NotFoundError("Order not found") -> OrderNotFound', () => {
        const mapped = mapper.mapError(new NotFoundError('Order not found'));
        expect(mapped).toBeInstanceOf(OrderNotFound);
    });

    test('maps NotFoundError("Market not found") -> MarketNotFound', () => {
        const mapped = mapper.mapError(new NotFoundError('Market not found'));
        expect(mapped).toBeInstanceOf(MarketNotFound);
    });

    test('maps RateLimitError -> RateLimitExceeded', () => {
        const mapped = mapper.mapError(new RateLimitError('slow down'));
        expect(mapped).toBeInstanceOf(RateLimitExceeded);
    });

    test('maps InternalServerError -> ExchangeNotAvailable', () => {
        const mapped = mapper.mapError(new InternalServerError('boom'));
        expect(mapped).toBeInstanceOf(ExchangeNotAvailable);
    });

    test('maps generic Error -> generic exchange BaseError', () => {
        const mapped = mapper.mapError(new Error('something failed'));
        expect(mapped).toBeInstanceOf(BaseError);
        expect((mapped as BaseError).exchange).toBe('PolymarketUS');
        expect((mapped as BaseError).code).toBe('EXCHANGE_ERROR');
        expect(mapped.message).toBe('something failed');
    });

    test('maps plain object -> generic exchange BaseError', () => {
        const mapped = mapper.mapError({ message: 'plain object error' });
        expect(mapped).toBeInstanceOf(BaseError);
        expect((mapped as BaseError).exchange).toBe('PolymarketUS');
        expect(mapped.message).toBe('plain object error');
    });
});
