import { describe, it } from "vitest";

describe("generateUniqueCode", () => {
  it.todo("generates 5-char alphanumeric codes");
  it.todo("1000 calls produce no duplicates");
});

describe("isSsrfAllowed", () => {
  it.todo("allows *.shopee.com.br");
  it.todo("allows *.mlstatic.com");
  it.todo("blocks arbitrary domain");
});

describe("buildExpiredRedirectUrl", () => {
  it.todo("shopee source builds search URL");
  it.todo("amazon source includes AMAZON_TAG");
  it.todo("ml source includes ML_PUBLISHER_ID");
});
