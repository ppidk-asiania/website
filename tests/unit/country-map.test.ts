import { describe, expect, it } from "vitest";
import { COUNTRIES, MAP_BOUNDS, MAP_FOCUS } from "../../packages/ui/src/map-countries";
import {
  approachView,
  countryBox,
  fitView,
  panView,
  zoomView,
} from "../../packages/ui/src/map-view";

describe("public map countries", () => {
  it("has one shape per Asia-Oceania country, and none outside the region", () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of ["AU", "NZ", "SG", "MY", "ID", "JP", "KR", "CN", "TW", "HK", "IN", "KZ"]) {
      expect(codes).toContain(code);
    }
    for (const code of ["SA", "TR", "RU", "US"]) expect(codes).not.toContain(code);
  });

  it("knows the box around each country's shape", () => {
    const au = countryBox("AU");
    const sg = countryBox("SG");
    expect(au && sg && au.width > 100 * sg.width).toBe(true);
    expect(au && au.x >= MAP_BOUNDS.x && au.x + au.width <= MAP_BOUNDS.x + MAP_BOUNDS.w).toBe(true);
    expect(countryBox("NL")).toBeNull();
  });
});

describe("public map pan and zoom", () => {
  it("zooms around the given point and stops at the zoom limits", () => {
    const zoomed = zoomView(MAP_FOCUS, 2, 500, 450);
    expect(zoomed).toEqual({ x: 250, y: 225, w: 500, h: 450 });
    expect(zoomView(MAP_FOCUS, 1000, 500, 450).w).toBe(MAP_FOCUS.w / 8);
    expect(zoomView(MAP_FOCUS, 0.001, 500, 450).w).toBe(MAP_FOCUS.w);
  });

  it("pans, but keeps the view centre over the map", () => {
    expect(panView(MAP_FOCUS, 10, -20)).toEqual({ ...MAP_FOCUS, x: 10, y: -20 });
    const far = panView(MAP_FOCUS, 1e6, 1e6);
    expect(far.x + far.w / 2).toBe(MAP_BOUNDS.x + MAP_BOUNDS.w);
    expect(far.y + far.h / 2).toBe(MAP_BOUNDS.y + MAP_BOUNDS.h);
  });

  it("fits a country so it takes 70% of the map, centred on it", () => {
    expect(fitView({ x: 100, y: 100, width: 70, height: 10 })).toEqual({
      x: 85,
      y: 60,
      w: 100,
      h: 90,
    });
    const tall = fitView({ x: 0, y: 0, width: 10, height: 63 });
    expect(tall.h).toBeCloseTo(90);
  });

  it("lets a small country stay zoomed in past the usual limit", () => {
    const tiny = fitView({ x: 500, y: 450, width: 7, height: 1 });
    expect(tiny.w).toBe(10);
    expect(zoomView(tiny, 2, 503.5, 450.5).w).toBe(10);
    expect(zoomView(tiny, 0.5, 503.5, 450.5).w).toBe(20);
  });

  it("eases the view towards a target a step at a time, then lands on it", () => {
    const target = { x: 100, y: 50, w: 500, h: 450 };
    const step = approachView(MAP_FOCUS, target, 0.25);
    expect(step).toEqual({ x: 25, y: 12.5, w: 875, h: 787.5 });
    expect(approachView(step, target, 1)).toEqual(target);
  });
});
