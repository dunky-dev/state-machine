import { describe, expect, it, vi } from "vitest";
import { composeHandlers } from "../src/compose-handlers";

describe("composeHandlers", () => {
  it("overwrites props with handlers when consumer has none", () => {
    const handlers = { onClick: vi.fn() };
    const props: Record<string, unknown> = { className: "x" };

    composeHandlers(handlers, props);

    expect(props.onClick).toBe(handlers.onClick);
    expect(props.className).toBe("x");
  });

  it("composes both handlers when both sides have onClick", () => {
    const lib = vi.fn(() => "lib");
    const consumer = vi.fn(() => "consumer");
    const props: Record<string, unknown> = { onClick: consumer };

    composeHandlers({ onClick: lib }, props);

    const result = (props.onClick as () => unknown)();

    expect(lib).toHaveBeenCalled();
    expect(consumer).toHaveBeenCalled();
    expect(result).toBe("consumer");
  });

  it("library handler runs even if consumer returns undefined", () => {
    const lib = vi.fn();
    const consumer = vi.fn();
    const props: Record<string, unknown> = { onClick: consumer };

    composeHandlers({ onClick: lib }, props);
    (props.onClick as () => void)();

    expect(lib).toHaveBeenCalledTimes(1);
    expect(consumer).toHaveBeenCalledTimes(1);
  });

  it("caches composed wrappers for stable handler pairs", () => {
    const lib = vi.fn();
    const consumer = vi.fn();

    const a: Record<string, unknown> = { onClick: consumer };
    composeHandlers({ onClick: lib }, a);

    const b: Record<string, unknown> = { onClick: consumer };
    composeHandlers({ onClick: lib }, b);

    expect(a.onClick).toBe(b.onClick);
  });

  it("does not affect unrelated keys", () => {
    const handlers = { onClick: vi.fn() };
    const props: Record<string, unknown> = {
      id: "btn",
      className: "x",
      onClick: vi.fn(),
    };

    composeHandlers(handlers, props);

    expect(props.id).toBe("btn");
    expect(props.className).toBe("x");
  });

  it("mutates the props object in place", () => {
    const handlers = { onClick: vi.fn() };
    const props: Record<string, unknown> = {};

    composeHandlers(handlers, props);

    expect(props.onClick).toBe(handlers.onClick);
  });
});
