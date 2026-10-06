## What & why

## Checklist

- [ ] `pnpm verify` passes locally
- [ ] No secrets, `.env*` files or credentials added
- [ ] Admin mutations go through `createGuardedAction` (auth → permission → validation → audit)
- [ ] New dependencies between workspaces are in the approved matrix (`scripts/check-boundaries.mjs`) and `docs/architecture.md`
- [ ] Gateway changes keep `/v1` backward compatible (or add a new version)
