import { expect, it } from "vitest";
import { total } from "../src/bad";

it.only("adds", () => {
  expect(total(1, 2)).toBe(3);
});
