# @website/ui

Shared presentational React components.

## Responsibilities

- Layout and small UI building blocks used by web, admin and store

## Structure

| Export                  | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppShell`              | Page layout with title                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `StatusBadge`           | Small status label                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ErrorPage`             | Generic 401/403/404/500 page ([docs](docs/error-pages.md))                                                                                                                                                                                                                                                                                                                                                                                        |
| `NavigationProgress`    | Top loading bar while a link loads its page; an app passes its current path as `route` (see `RouteProgress` in web and admin)                                                                                                                                                                                                                                                                                                                     |
| `CountryMap`            | Draggable, zoomable map of the Asia–Oceania countries (pinch, wheel, + − ⟲); a click or Enter chooses a country, `fitTo(code)` zooms it to 70%. Zoom buttons, reset and `fitTo` glide (off with reduced motion); hover outlines the country; an invisible 16 px hit area around each country (small ones on top) makes islands easy to click. Used by web `/map` and the admin chapter form; shapes in `map-countries.ts`, maths in `map-view.ts` |
| `initials`, `shortName` | Avatar initials ("NK") and a name cut to 13 characters + "..." when over 16                                                                                                                                                                                                                                                                                                                                                                       |
| `./styles.css`          | Design tokens and base styles ([docs](docs/design-tokens.md))                                                                                                                                                                                                                                                                                                                                                                                     |

## Rules

- Components never fetch data, read env or make authorization decisions.
- Colours, type, spacing, radius and shadows come from `styles.css` tokens — no hardcoded values.

## Commands

```bash
pnpm --filter @website/ui lint
pnpm --filter @website/ui typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
