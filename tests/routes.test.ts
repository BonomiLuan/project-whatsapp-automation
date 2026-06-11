import { describe, it } from "vitest";

describe("GET /r/:code", () => {
  it.todo("valid code returns 200 HTML with og:title");
  it.todo("valid code HTML contains og:image with /img/ path");
  it.todo("valid code HTML contains meta http-equiv refresh");
  it.todo("unknown code returns 404");
  it.todo("expired link redirects to platform search URL (302)");
});

describe("GET /img/:code", () => {
  it.todo("valid code returns 200 with image content-type");
  it.todo("unknown code returns 404");
});

describe("GET /api/links", () => {
  it.todo("without auth returns 401");
  it.todo("with auth cookie returns array");
});
