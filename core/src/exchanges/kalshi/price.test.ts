import {
  getKalshiPriceContext,
  fromKalshiCents,
  invertKalshiCents,
  invertKalshiUnified,
} from "./price";

describe("kalshi price helpers", () => {
  it("returns normalized context by default", () => {
    const context = getKalshiPriceContext();

    expect(context.isRaw).toBe(false);
    expect(context.scale).toBe(100);
    expect(context.unit).toBe(1);
    expect(context.defaultPrice).toBe(0.5);
  });

  it("returns raw context when mode is raw", () => {
    const context = getKalshiPriceContext({ mode: "raw" });

    expect(context.isRaw).toBe(true);
    expect(context.scale).toBe(1);
    expect(context.unit).toBe(100);
    expect(context.defaultPrice).toBe(50);
  });

  it("converts cents to unified normalized prices", () => {
    const context = getKalshiPriceContext();

    expect(fromKalshiCents(55, context)).toBe(0.55);
    expect(invertKalshiCents(45, context)).toBe(0.55);
    expect(invertKalshiUnified(0.45, context)).toBe(0.55);
  });

  it("converts cents to raw prices without scaling", () => {
    const context = getKalshiPriceContext({ mode: "raw" });

    expect(fromKalshiCents(55, context)).toBe(55);
    expect(invertKalshiCents(45, context)).toBe(55);
    expect(invertKalshiUnified(45, context)).toBe(55);
  });
});
