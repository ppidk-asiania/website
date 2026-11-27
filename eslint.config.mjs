// @ts-check
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
const SDK_ANY = "^mysql2(/.*)?$";
const SDK_MESSAGE = "MySQL is only accessed via @website/db/sql.";
const APPS = "^(web|admin|store|gateway)(/.*)?$|(^|/)apps/";

const CROSS_APP = {
  regex: "^(\\.\\./){2,}(apps|web|admin|store|gateway)(/|$)",
  message: "Apps must not import other apps.",
};

const APP_RULES = {
  web: [
    {
      group: ["@website/audit", "@website/apikeys", "@website/domain/store"],
      message: "The public site has no admin tooling and does not depend on the store domain.",
    },
  ],
  admin: [
    {
      group: ["@website/domain/store", "@website/apikeys"],
      message: "Not part of the admin's approved dependencies yet.",
    },
  ],
  store: [
    {
      group: [
        "@website/domain/content",
        "@website/domain/events",
        "@website/domain/organizations",
        "@website/domain/newsletter",
        "@website/domain/members",
      ],
      message: "Store depends only on @website/domain/store (extraction boundary).",
    },
    {
      group: ["@website/audit", "@website/apikeys"],
      message: "Not part of the store's approved dependencies.",
    },
  ],
};

const SERVER_ONLY_INFRA = {
  group: ["@website/db", "@website/db/*", "@website/email"],
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
          regex: SDK_ANY,
          message: SDK_MESSAGE,
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
          regex: SDK_ANY,
          message: SDK_MESSAGE,
        },
      ]),
    },
  ]);
}

const restrict = (patterns) => ({
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
      ...restrict([
        {
          regex: SDK_ANY,
          message: SDK_MESSAGE,
        },
      ]),
    },
  },
  {
    files: ["scripts/**/*.mjs", "infrastructure/scripts/**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    rules: { ...tseslint.configs.disableTypeChecked.rules, "no-console": "off" },
  },

  {
    files: ["packages/db/src/sql/store.ts"],
    rules: restrict([{ regex: APPS, message: "Packages must never import apps." }]),
  },

  {
    files: ["packages/**/*.{ts,tsx}"],
    ignores: ["packages/db/src/sql/store.ts"],
    rules: restrict([
      { regex: APPS, message: "Packages must never import apps." },
      {
        regex: SDK_ANY,
        message: SDK_MESSAGE,
      },
    ]),
  },

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
        { regex: SDK_ANY, message: "This package must not depend on MySQL." },
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
          regex: SDK_ANY,
          message: "Domain must not depend on MySQL — declare a port instead.",
        },
        {
          regex: "^@website/(?!security/validation$)",
          message:
            "Domain is the innermost layer; it imports no other workspace package (except @website/security/validation).",
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
    files: ["packages/domain/src/store/**/*.ts"],
    rules: restrict([
      {
        group: ["../content*", "../events*", "../organizations*", "../newsletter*", "../members*"],
        message: "domain/store must stay self-contained (extraction boundary).",
      },
      {
        regex: "^@website/(?!security/validation$)",
        message: "Domain imports no other workspace package (except @website/security/validation).",
      },
      { group: FRAMEWORKS, message: "Domain must not depend on frameworks." },
      { regex: SDK_ANY, message: "Domain must not depend on MySQL." },
      { regex: APPS, message: "Packages must never import apps." },
    ]),
  },
  {
    files: ["packages/domain/src/{content,events,organizations,newsletter,members,shared}/**/*.ts"],
    rules: restrict([
      { group: ["../store*"], message: "Only the store app may depend on domain/store." },
      {
        regex: "^@website/(?!security/validation$)",
        message: "Domain imports no other workspace package (except @website/security/validation).",
      },
      { group: FRAMEWORKS, message: "Domain must not depend on frameworks." },
      { regex: SDK_ANY, message: "Domain must not depend on MySQL." },
      { regex: APPS, message: "Packages must never import apps." },
    ]),
  },

  {
    files: ["apps/{web,admin,store}/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    settings: { next: { rootDir: "apps/*/" } },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
      "@next/next/no-html-link-for-pages": "off",
    },
  },

  ...appBoundaryBlocks(),

  {
    files: ["apps/gateway/**/*.ts"],
    rules: restrict([
      {
        group: [
          "@website/auth",
          "@website/auth/*",
          "@website/permissions",
          "@website/audit",
          "@website/ui",
          "@website/email",
        ],
        message:
          "The gateway must not import staff auth/session, admin authorization, admin audit or UI.",
      },
      {
        group: ["@website/domain/members", "@website/domain/store"],
        message: "Personal data and store internals never leave through the third-party API.",
      },
      {
        group: ["react", "react-dom", "next", "next/*"],
        message: "The gateway is not a Next.js/React app.",
      },
      CROSS_APP,
      { regex: SDK_ANY, message: "Use @website/db." },
    ]),
  },

  {
    files: ["tests/**/*.ts"],
    rules: { "no-restricted-imports": "off", "@typescript-eslint/no-non-null-assertion": "off" },
  },
);
