# Aliyun Auth Abstraction Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor Kibana Aliyun IAM/OAuth authentication to share the same state/authentication pattern as built-in providers (basic/token/oidc), eliminate heuristic behavior, and make future auth-method extensions low-risk.

**Architecture:** Keep provider lifecycle (`login`/`authenticate`/`logout`) in Kibana’s existing `BaseAuthenticationProvider` model, but introduce a typed credential/state abstraction for Aliyun. Move all token-to-header logic into one helper and make routes responsible only for obtaining initial credentials (OAuth code exchange or IAM signed token), not for repeated auth behavior.

**Tech Stack:** Kibana security plugin (`x-pack/platform/plugins/shared/security`), TypeScript, Jest.

---

## Findings Summary (Validated Against Current Code)

- Shared lifecycle pattern exists and should be reused:
  - `basic.ts` persists auth header state and reuses it in `authenticateViaState`.
  - `token.ts` persists token pair and refreshes via `Tokens`.
- Aliyun diverges from this pattern:
  - Token/header construction duplicated between `login` and `authenticate`.
  - `authenticate` uses heuristic token-type detection (`authorization.includes('.') || startsWith('ey')`) for legacy state.
  - OAuth route chooses provider from raw config object traversal instead of sorted provider chain.
  - IAM route calls ES `_authenticate` redundantly before `getAuthenticationService().login(...)`.

---

### Task 1: Introduce Typed Aliyun Credential + Session State (No Behavior Change Yet)

**Files:**
- Create: `x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun_state.ts`
- Modify: `x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts`
- Test: `x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.test.ts`

**Step 1: Write failing tests for v2 state contract**
- Add tests asserting provider persists and consumes typed state:
  - `state: { version: 2, mode: 'oauth' | 'iam', authHeaders: {...} }`
  - No heuristic fallback for v2 state.

**Step 2: Run targeted tests and verify failures**
Run:
```bash
node scripts/jest --runInBand x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.test.ts --config x-pack/platform/plugins/shared/security/jest.config.js
```
Expected: failures for missing v2 contract.

**Step 3: Implement state type + conversion helper**
- Add `AliyunCredential` and `AliyunProviderStateV2`.
- Add helper:
  - `buildAliyunAuthHeaders(credential)`
  - `migrateLegacyAliyunState(state)` for backward compatibility.

**Step 4: Verify tests pass**
Run same test command; expected PASS.

**Step 5: Commit**
```bash
git add x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts \
        x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun_state.ts \
        x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.test.ts
git commit -m "refactor(security): add typed aliyun auth state and header builder"
```

---

### Task 2: Remove Heuristic Auth Mode Detection in Provider

**Files:**
- Modify: `x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts`
- Test: `x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.test.ts`

**Step 1: Add failing tests for deterministic auth-mode handling**
- For legacy state with unknown mode, test deterministic strategy:
  - Try explicit mode if present.
  - For legacy (no mode), try strict fallback order (`oauth` then `iam`) instead of string heuristics.

**Step 2: Run test and verify failure**
Run:
```bash
node scripts/jest --runInBand x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.test.ts --config x-pack/platform/plugins/shared/security/jest.config.js
```

**Step 3: Implement deterministic fallback path**
- Remove `includes('.')/startsWith('ey')` logic.
- Route legacy state through a single migration/fallback function.

**Step 4: Re-run tests**
Expected: PASS.

**Step 5: Commit**
```bash
git add x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts \
        x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.test.ts
git commit -m "fix(security): remove aliyun token heuristic and use deterministic fallback"
```

---

### Task 3: Align OAuth Provider Selection With Sorted Provider Chain

**Files:**
- Modify: `x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.ts`
- Test: `x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.test.ts`

**Step 1: Add failing tests for provider selection semantics**
- Add cases where config object order differs from `sortedProviders` order.
- Ensure selected provider is the first enabled Aliyun provider in `sortedProviders` that has `oauth.clientId`.

**Step 2: Run test and verify failure**
Run:
```bash
node scripts/jest --runInBand x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.test.ts --config x-pack/platform/plugins/shared/security/jest.config.js
```

**Step 3: Implement sorted-provider based selector**
- Replace raw `Object.entries(config.authc.providers.aliyun)` traversal with `config.authc.sortedProviders`.

**Step 4: Re-run tests**
Expected: PASS.

**Step 5: Commit**
```bash
git add x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.ts \
        x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.test.ts
git commit -m "refactor(security): select aliyun oauth provider from sorted provider chain"
```

---

### Task 4: Remove Redundant Pre-Authentication Call in IAM Route

**Files:**
- Modify: `x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun.ts`
- Test: `x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun.test.ts`

**Step 1: Add failing test that login route does not call ES authenticate directly**
- Assert route only delegates to `getAuthenticationService().login(...)` with `signedToken`.

**Step 2: Run test and verify failure**
Run:
```bash
node scripts/jest --runInBand x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun.test.ts --config x-pack/platform/plugins/shared/security/jest.config.js
```

**Step 3: Remove redundant ES call and unused `authResponse` payload**
- Keep route responsibility limited to:
  - parse redirect
  - call authentication service
  - return response.

**Step 4: Re-run tests**
Expected: PASS.

**Step 5: Commit**
```bash
git add x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun.ts \
        x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun.test.ts
git commit -m "refactor(security): simplify aliyun iam route and remove duplicate auth call"
```

---

### Task 5: Harden OAuth Callback Error/Network Handling

**Files:**
- Modify: `x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.ts`
- Test: `x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.test.ts`

**Step 1: Add failing tests for token endpoint failure resilience**
- Timeout/abort scenario returns deterministic auth-error redirect.
- Non-JSON token response returns deterministic auth-error redirect.

**Step 2: Run test and verify failure**
Run:
```bash
node scripts/jest --runInBand x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.test.ts --config x-pack/platform/plugins/shared/security/jest.config.js
```

**Step 3: Add timeout + typed parse guard**
- Use `AbortController` timeout for token exchange.
- Validate token response payload shape before use.
- Keep current redirect contract unchanged.

**Step 4: Re-run tests**
Expected: PASS.

**Step 5: Commit**
```bash
git add x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.ts \
        x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.test.ts
git commit -m "fix(security): harden aliyun oauth callback token exchange handling"
```

---

### Task 6: Optional Extension Point for ES Token Exchange Strategy

**Files:**
- Modify: `x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts`
- Modify: `x-pack/platform/plugins/shared/security/server/config.ts`
- Test: `x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.test.ts`

**Step 1: Add config-gated strategy tests**
- `mode: passthrough` (current behavior) uses external token/IAM header directly.
- `mode: es_token_exchange` (future) stores token pair and refreshes like token provider.

**Step 2: Implement strategy interface**
- Add internal strategy object in Aliyun provider:
  - `toAuthHeadersAndState(...)`
  - `authenticateFromState(...)`

**Step 3: Keep default as passthrough**
- No behavior change unless explicitly configured.

**Step 4: Run tests**
Expected: existing behavior still passes.

**Step 5: Commit**
```bash
git add x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts \
        x-pack/platform/plugins/shared/security/server/config.ts \
        x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.test.ts
git commit -m "feat(security): add aliyun auth strategy abstraction for future token exchange"
```

---

### Task 7: Regression Verification and Documentation

**Files:**
- Modify: `reg_validation_guide.md`
- Modify: `OAUTH-IMPLEMENTATION-COMPLETE.md` (remove stale “in-memory verifier” statement)

**Step 1: Extend regression guide**
- Add deterministic legacy-session migration test.
- Add OAuth callback timeout/failure contract test.
- Add provider-order selection test.

**Step 2: Run verification**
Run:
```bash
node scripts/jest --runInBand \
  x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.test.ts \
  x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun.test.ts \
  x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.test.ts \
  --config x-pack/platform/plugins/shared/security/jest.config.js
```

**Step 3: Manual smoke checks**
- Login with Aliyun OAuth from clean session.
- Logout/login cycles.
- Verify basic auth path still works.

**Step 4: Commit**
```bash
git add reg_validation_guide.md OAUTH-IMPLEMENTATION-COMPLETE.md
git commit -m "docs(security): add aliyun auth abstraction regression coverage"
```

---

## Risk Controls

- Keep backward-compatible legacy state migration for at least one release.
- Do not change external route paths.
- Keep default behavior as passthrough mode.
- Add debug logs with provider name + mode + state version (without token content).

## Rollback Plan

- Revert Aliyun provider and route commits in reverse order.
- Keep config default unchanged; disable strategy flag if introduced.
- Existing basic/token providers remain unaffected.

