import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("test setup", () => {
  it("runs Vitest with the @/ path alias", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });
});
