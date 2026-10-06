// @ts-check
/**
 * Single flat config for the whole monorepo. Architecture boundaries are enforced
 * here (import rules) AND by scripts/check-boundaries.mjs (package dependency graph).
 * See docs/architecture.md → "Dependency rules".
 */
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const FRAMEWORKS = [
  "react",
  "react-dom",
  "react/*",
  "next",
  "next/*",
  "hono",
  "hono/*",
  "@hono/*",
  "@vercel/*",
];
// Regexes (not gitignore globs) so "@platform/auth/firebase-admin" is not mistaken for "firebase-admin".
const FIREBASE_ANY = "^firebase(-admin)?(/.*)?$";
const APPS = "^(web|admin|shop|gateway)(/.*)?$|(^|/)apps/";

/** Relative imports that climb into another app (e.g. "../../admin/src/..."). */
const CROSS_APP = {
  regex: "^(\\.\\./){2,}(apps|web|admin|shop|gateway)(/|$)",
  message: "Apps must not import other apps.",
};

/** Per-app import rules (approved dependency surface). */
const APP_RULES = {
  web: [
    {
      group: [
        "@platform/permissions",
        "@platform/audit",
        "@platform/apikeys",
        "@platform/auth/firebase-admin",
        "@platform/domain/shop",
      ],
      message:
        "The public site has no staff/admin capabilities and does not depend on the shop domain.",
    },
  ],
  admin: [
    {
      group: ["@platform/domain/shop", "@platform/apikeys"],
      message: "Not part of the admin's approved dependencies yet.",
    },
    {
      group: ["firebase/firestore", "firebase/database", "firebase/storage"],
      message: "Admin data is never read/written from the browser.",
    },
  ],
  shop: [
    {
      group: [
        "@platform/domain/content",
        "@platform/domain/events",
        "@platform/domain/organizations",
        "@platform/domain/newsletter",
      ],
      message: "Shop depends only on @platform/domain/shop (extraction boundary).",
    },
    {
      group: ["@platform/audit", "@platform/apikeys"],
      message: "Not part of the shop's approved dependencies.",
    },
  ],
};

/** Outside src/server/**, app code may not touch server-only infrastructure. */
const SERVER_ONLY_INFRA = {
  group: ["@platform/db", "@platform/db/*", "@platform/auth/firebase-admin", "@platform/email"],
  message:
    'Infrastructure is only reachable from src/server/** (modules that import "server-only").',
};

function appBoundaryBlocks() {
  return Object.entries(APP_RULES).flatMap(([app, rules]) => [
    {
      files: [`apps/${app}/**/*.{ts,tsx}`],
      rules: restrict([
        ...rules,
        CROSS_APP,
        {
          regex: FIREBASE_ANY,
          message: "Firebase is only accessed via @platform/db or @platform/auth adapters.",
        },
      ]),
    },
    {
      files: [`apps/${app}/src/**/*.{ts,tsx}`],
      ignores: [`apps/${app}/src/server/**`],
      rules: restrict([
        ...rules,
        CROSS_APP,
        SERVER_ONLY_INFRA,
        {
          regex: FIREBASE_ANY,
          message: "Firebase is only accessed via @platform/db or @platform/auth adapters.",
        },
      ]),
    },
  ]);
}

/** Helper: build a no-restricted-imports rule from package-name groups. */
const restrict = (
  /** @type {Array<{group?: string[], regex?: string, message: string}>} */ patterns,
) => ({
  "no-restricted-imports": ["error", { patterns }],
});

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/next-env.d.ts",
      "**/*.config.*",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-floating-promises": "error",
      eqeqeq: ["error", "always"],
      "no-console": ["error", { allow: ["warn", "error"] }],
      // No package or app may touch Firebase except the two sanctioned adapters below.
      // Client SDK data APIs are banned outright: admin data is never written from the browser.
      ...restrict([
        {
          regex: FIREBASE_ANY,
          message:
            "Firebase is only accessed via @platform/db/firestore or @platform/auth/firebase-admin.",
        },
      ]),
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    rules: { ...tseslint.configs.disableTypeChecked.rules, "no-console": "off" },
  },

  // ── Sanctioned Firebase adapters ──────────────────────────────────────────
  {
    files: ["packages/auth/src/firebase-admin.ts", "packages/db/src/firestore/**/*.ts"],
    rules: restrict([
      { group: ["firebase", "firebase/*"], message: "Server adapters use firebase-admin only." },
      { regex: APPS, message: "Packages must never import apps." },
    ]),
  },

  // ── Packages: never import apps ───────────────────────────────────────────
  {
    files: ["packages/**/*.{ts,tsx}"],
    ignores: ["packages/auth/src/firebase-admin.ts", "packages/db/src/firestore/**"],
    rules: restrict([
      { regex: APPS, message: "Packages must never import apps." },
      {
        regex: FIREBASE_ANY,
        message:
          "Firebase is only accessed via @platform/db/firestore or @platform/auth/firebase-admin.",
      },
    ]),
  },

  // ── Framework-free packages (domain, contracts, permissions, audit, apikeys, email, config) ──
  {
    files: [
      "packages/{domain,contracts,permissions,audit,apikeys,email,config,observability}/**/*.ts",
    ],
    rules: {
      ...restrict([
        {
          group: FRAMEWORKS,
          message: "This package must stay framework-independent (no React/Next/Hono/Vercel).",
        },
        { regex: FIREBASE_ANY, message: "This package must not depend on Firebase." },
        { regex: APPS, message: "Packages must never import apps." },
      ]),
    },
  },
  {
    files: ["packages/domain/**/*.ts"],
    rules: {
      ...restrict([
        { group: FRAMEWORKS, message: "Domain must not depend on React/Next/Hono/Vercel." },
        {
          regex: FIREBASE_ANY,
          message: "Domain must not depend on Firebase — declare a port instead.",
        },
        {
          group: ["@platform/*"],
          message: "Domain is the innermost layer; it imports no other workspace package.",
        },
        { regex: APPS, message: "Packages must never import apps." },
      ]),
      "no-restricted-globals": [
        "error",
        ...[
          "window",
          "document",
          "localStorage",
          "sessionStorage",
          "navigator",
          "fetch",
          "process",
        ].map((name) => ({
          name,
          message: "Domain code must not use browser/runtime APIs. Inject a port.",
        })),
      ],
    },
  },
  {
    // Shop stays extractable: no imports from sibling domain modules.
    files: ["packages/domain/src/shop/**/*.ts"],
    rules: restrict([
      {
        group: ["../content*", "../events*", "../organizations*", "../newsletter*"],
        message: "domain/shop must stay self-contained (extraction boundary).",
      },
      { group: ["@platform/*"], message: "Domain imports no other workspace package." },
      { group: FRAMEWORKS, message: "Domain must not depend on frameworks." },
      { regex: FIREBASE_ANY, message: "Domain must not depend on Firebase." },
      { regex: APPS, message: "Packages must never import apps." },
    ]),
  },
  {
    files: ["packages/domain/src/{content,events,organizations,newsletter,shared}/**/*.ts"],
    rules: restrict([
      { group: ["../shop*"], message: "Only the shop app may depend on domain/shop." },
      { group: ["@platform/*"], message: "Domain imports no other workspace package." },
      { group: FRAMEWORKS, message: "Domain must not depend on frameworks." },
      { regex: FIREBASE_ANY, message: "Domain must not depend on Firebase." },
      { regex: APPS, message: "Packages must never import apps." },
    ]),
  },

  // ── Next.js apps ──────────────────────────────────────────────────────────
  {
    files: ["apps/{web,admin,shop}/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    settings: { next: { rootDir: "apps/*/" } },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
      "@next/next/no-html-link-for-pages": "off", // App Router only
    },
  },

  // NOTE: in flat config a later `no-restricted-imports` REPLACES an earlier one for the
  // same file, so each block below carries the complete pattern list for its files.
  ...appBoundaryBlocks(),

  // ── Gateway ───────────────────────────────────────────────────────────────
  {
    files: ["apps/gateway/**/*.ts"],
    rules: restrict([
      {
        group: [
          "@platform/auth",
          "@platform/auth/*",
          "@platform/permissions",
          "@platform/audit",
          "@platform/ui",
          "@platform/email",
        ],
        message:
          "The gateway must not import staff auth/session, admin authorization, admin audit or UI.",
      },
      {
        group: ["react", "react-dom", "next", "next/*"],
        message: "The gateway is not a Next.js/React app.",
      },
      CROSS_APP,
      { regex: FIREBASE_ANY, message: "Use @platform/db." },
    ]),
  },

  // ── Tests ─────────────────────────────────────────────────────────────────
  {
    files: ["tests/**/*.ts"],
    rules: { "no-restricted-imports": "off", "@typescript-eslint/no-non-null-assertion": "off" },
  },
);
