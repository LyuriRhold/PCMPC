import { expect, it } from "vitest";
import { total } from "../src/good";

it("adds", () => {
  expect(total(1n, 2n)).toBe(3n);
});
