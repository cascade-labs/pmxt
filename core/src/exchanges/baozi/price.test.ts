import {
  clampBaoziPrice,
  normalizeBaoziOutcomes,
} from "./price";
import { MarketOutcome } from "../../types";

describe("baozi price helpers", () => {
  it("clamps values in normalized mode", () => {
    expect(clampBaoziPrice(1.2)).toBe(1);
    expect(clampBaoziPrice(-0.1)).toBe(0);
    expect(clampBaoziPrice(0.3)).toBe(0.3);
  });

  it("does not clamp in raw mode", () => {
    expect(clampBaoziPrice(1.2, { mode: "raw" })).toBe(1.2);
    expect(clampBaoziPrice(-0.1, { mode: "raw" })).toBe(-0.1);
  });

  it("normalizes outcomes in normalized mode", () => {
    const outcomes: MarketOutcome[] = [
      { outcomeId: "a", marketId: "m", label: "A", price: 45 },
      { outcomeId: "b", marketId: "m", label: "B", price: 55 },
    ];

    normalizeBaoziOutcomes(outcomes);

    expect(outcomes[0].price).toBeCloseTo(0.45);
    expect(outcomes[1].price).toBeCloseTo(0.55);
  });

  it("skips normalization in raw mode", () => {
    const outcomes: MarketOutcome[] = [
      { outcomeId: "a", marketId: "m", label: "A", price: 45 },
      { outcomeId: "b", marketId: "m", label: "B", price: 55 },
    ];

    normalizeBaoziOutcomes(outcomes, { mode: "raw" });

    expect(outcomes[0].price).toBe(45);
    expect(outcomes[1].price).toBe(55);
  });
});
