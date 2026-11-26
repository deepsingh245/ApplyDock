import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button loading", () => {
  it("shows a spinner, announces busy and blocks clicks while loading", () => {
    const html = renderToStaticMarkup(<Button loading>Save version</Button>);
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/ disabled(=|>| )/);
    expect(html).toContain("animate-spin");
    expect(html).toContain("Save version");
  });

  it("is a normal button otherwise", () => {
    const html = renderToStaticMarkup(<Button>Save version</Button>);
    expect(html).not.toContain("aria-busy");
    expect(html).not.toMatch(/ disabled(=|>| )/);
    expect(html).not.toContain("animate-spin");
  });
});
