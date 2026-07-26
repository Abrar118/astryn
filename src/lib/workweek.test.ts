import { describe, it, expect } from "vitest";
import { ALL_DAYS, hiddenDaysFor, parseWorkdays } from "./workweek";

describe("parseWorkdays", () => {
  it("accepts a valid day array, deduped and sorted", () => {
    expect(parseWorkdays("[4,0,1,1,3]")).toEqual([0, 1, 3, 4]);
  });

  it("falls back to all days on null, malformed JSON, non-arrays, and empty arrays", () => {
    for (const raw of [null, "not json", "{}", '"0,1"', "[]"]) {
      expect(parseWorkdays(raw)).toEqual([...ALL_DAYS]);
    }
  });

  it("drops out-of-range and non-numeric entries, falling back when nothing survives", () => {
    expect(parseWorkdays('[0,7,-1,"2",2.5,3]')).toEqual([0, 3]);
    expect(parseWorkdays('[7,"x"]')).toEqual([...ALL_DAYS]);
  });
});

describe("hiddenDaysFor", () => {
  it("returns the complement of the workdays", () => {
    expect(hiddenDaysFor([0, 1, 2, 3, 4])).toEqual([5, 6]); // Sun–Thu week hides Fri/Sat
    expect(hiddenDaysFor([...ALL_DAYS])).toEqual([]);
  });
});
