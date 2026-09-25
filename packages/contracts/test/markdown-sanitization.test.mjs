import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeMarkdownPreview } from "../src/markdown-sanitization.mjs";

test("Markdown preview removes HTML and script content and replaces remote embeds", () => {
  const input = "before <b>bold</b> <ScRiPt>alert('x')</SCRIPT> ![remote](https://example.com/a.png)";
  assert.equal(sanitizeMarkdownPreview(input), "before bold  [remote embed omitted]");
});

test("Markdown preview drops malformed tags without losing prior text", () => {
  assert.equal(sanitizeMarkdownPreview("visible<script>hidden"), "visible");
  assert.equal(sanitizeMarkdownPreview("visible<unclosed"), "visible");
});

test("Markdown preview handles dense markup within the bounded upload size", () => {
  const visibleTags = 50_000;
  assert.equal(sanitizeMarkdownPreview("<b>x</b>".repeat(visibleTags)), "x".repeat(visibleTags));
});
