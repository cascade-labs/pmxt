import { resolveMyriadPrice } from "./price";

describe("myriad price helpers", () => {
  it("uses raw event.price when raw mode is requested and present", () => {
    const value = resolveMyriadPrice(
      { price: "42.5", value: 100, shares: 2 },
      { mode: "raw" },
    );
    expect(value).toBe(42.5);
  });

  it("falls back to value/shares when raw price is missing", () => {
    const value = resolveMyriadPrice(
      { value: 100, shares: 4 },
      { mode: "raw" },
    );
    expect(value).toBe(25);
  });

  it("keeps previous fallback behavior when shares are missing or zero", () => {
    expect(resolveMyriadPrice({ value: 12, shares: 0 })).toBe(12);
    expect(resolveMyriadPrice({ value: 7 })).toBe(7);
  });
});

