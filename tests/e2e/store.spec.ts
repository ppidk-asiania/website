import { expect, test } from "@playwright/test";

test("store home responds with security headers", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-powered-by"]).toBeUndefined();
  expect(await response.text()).toContain("store: ok");
});
