import React from "react";
import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ImagesPage } from "../src/pages/ImagesPage";

test("ImagesPage smoke: renders image generation form with defaults", () => {
  const html = renderToStaticMarkup(<ImagesPage />);

  assert.ok(html.includes("Images"));
  assert.ok(html.includes("OpenAI-compatible image generation"));
  assert.ok(html.includes("gpt-image-1"));
  assert.ok(html.includes("Generate"));
});
