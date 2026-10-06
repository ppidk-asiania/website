import { expect, test } from "@playwright/test";

test("gateway health endpoints expose nothing but status", async ({ request }) => {
  for (const path of ["/health", "/v1/health"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  }
});

test("gateway rejects unauthenticated API calls with RFC 9457", async ({ request }) => {
  const response = await request.get("/v1/events");
  expect(response.status()).toBe(401);
  expect(response.headers()["content-type"]).toContain("application/problem+json");
});
