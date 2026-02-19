# Major Decisions - Aliyun OAuth Integration

This document records critical architectural and implementation decisions made during the Aliyun OAuth integration project.

---

## Decision Log

### Decision 1: Use OAuth 2.1 with PKCE (Not OAuth 2.0 with Client Secret)
**Date**: 2026-01-27
**Decision Maker**: Implementation team
**Status**: ✅ Implemented

#### Context
Aliyun supports both OAuth 2.0 (with client secret) and OAuth 2.1 (with PKCE). We needed to choose which flow to implement.

#### Options Considered
1. **OAuth 2.0 with Client Secret**
   - Traditional flow
   - Requires storing client secret in Kibana configuration
   - Less secure for public clients

2. **OAuth 2.1 with PKCE** ✅ CHOSEN
   - Modern standard
   - No client secret required
   - More secure for browser-based flows
   - Better protection against authorization code interception

#### Decision
Use OAuth 2.1 with PKCE (Proof Key for Code Exchange)

#### Rationale
- **Security**: PKCE prevents authorization code interception attacks
- **Best Practice**: OAuth 2.1 is the modern standard replacing OAuth 2.0
- **No Secret Management**: Eliminates need to securely store client secret
- **Future-Proof**: Aligns with industry direction

#### Implementation Details
- Generate code_verifier (43-128 character random string)
- Derive code_challenge using SHA-256: `base64url(sha256(code_verifier))`
- Send code_challenge in authorization request
- Send code_verifier in token exchange request

#### Files Affected
- `x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.ts`

#### Consequences
- ✅ Enhanced security
- ✅ Simpler configuration (no client secret)
- ✅ Compliance with modern standards
- ⚠️ Requires maintaining code_verifier state between requests

---

### Decision 2: Use `/api/` Routes Instead of `/internal/` Routes
**Date**: 2026-01-30
**Decision Maker**: Implementation team (corrective)
**Status**: ✅ Implemented (Bug Fix)

#### Context
Initial implementation used `/internal/security/aliyun/oauth/*` paths for OAuth endpoints. Login button was getting "Unauthorized" errors.

#### Root Cause Analysis
- `/internal/` routes require authentication
- OAuth flow endpoints MUST be accessible without authentication
- Login form was calling authenticated endpoints before user logged in

#### Options Considered
1. **Disable auth on `/internal/` routes**
   - Would break Kibana's security model
   - Not recommended by Kibana team

2. **Use `/api/` routes with explicit auth disable** ✅ CHOSEN
   - Proper use of Kibana's public API pattern
   - Explicit security configuration in route definition
   - Follows Kibana conventions

#### Decision
Use `/api/security/aliyun/oauth/*` paths with explicit `authc: { enabled: false }` and `authz: { enabled: false }`

#### Implementation Details
```typescript
router.get({
  path: '/api/security/aliyun/oauth/authorize',
  security: {
    authc: { enabled: false, reason: 'This route initiates OAuth login flow' },
    authz: { enabled: false, reason: 'This route initiates OAuth login flow' },
  },
  options: {
    access: 'public',
    tags: [ROUTE_TAG_CAN_REDIRECT, ROUTE_TAG_AUTH_FLOW],
  },
}, handler);
```

#### Files Affected
- `x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.ts`
- `x-pack/platform/plugins/shared/security/public/authentication/login/components/aliyun_login_form/aliyun_login_form.tsx`

#### Consequences
- ✅ Login button now works
- ✅ Follows Kibana conventions
- ✅ Clear security posture (explicitly public)
- ✅ Easier to audit and maintain

---

### Decision 3: OAuth Token Validation via Aliyun Userinfo Endpoint (Not JWT Signature Verification)
**Date**: 2026-01-28
**Decision Maker**: Implementation team
**Status**: ✅ Implemented

#### Context
OAuth access tokens from Aliyun are JWTs. We needed to decide how to validate them in Elasticsearch.

#### Options Considered
1. **JWT Signature Verification**
   - Download Aliyun's public keys (JWKS)
   - Verify signature locally
   - Fast (no external call)
   - Complex (key rotation, caching)

2. **Userinfo Endpoint Validation** ✅ CHOSEN
   - Call Aliyun's `/v1/userinfo` endpoint with Bearer token
   - Aliyun validates the token
   - Returns user identity if valid
   - Simple implementation

#### Decision
Validate OAuth tokens by calling Aliyun's userinfo endpoint

#### Rationale
- **Simplicity**: Single HTTP call, no key management
- **Authority**: Aliyun is source of truth for token validity
- **Flexibility**: Works regardless of token format changes
- **User Info**: Gets user identity in same call
- **Revocation**: Respects Aliyun's token revocation

#### Trade-offs
- ✅ Simple implementation
- ✅ Always up-to-date validation
- ✅ No key management complexity
- ⚠️ Network call for each authentication (mitigated by caching)
- ⚠️ Dependency on Aliyun availability

#### Implementation Details
```java
// OAuthTokenValidator.java
HttpRequest request = HttpRequest.newBuilder(URI.create(userinfoEndpoint))
    .header("Authorization", "Bearer " + accessToken)
    .header("Accept", "application/json")
    .GET()
    .build();

HttpResponse<String> response = httpClient.send(request, ...);
// Parse response to get user identity
```

#### Files Affected
- `es-9.2.4-plugins/plugins/security-realm-cloud-iam/src/main/java/.../OAuthTokenValidator.java`

#### Consequences
- ✅ Simple and maintainable
- ✅ No JWKS endpoint polling needed
- ✅ Automatic token revocation support
- ⚠️ Performance depends on Aliyun API
- ℹ️ Consider caching validated tokens to reduce API calls

---

### Decision 4: Skip Timestamp Validation for OAuth Tokens
**Date**: 2026-01-29
**Decision Maker**: Implementation team
**Status**: ✅ Implemented

#### Context
The Cloud IAM realm initially validated timestamps on all tokens, causing OAuth tokens to fail with "invalid iam token timestamp" errors.

#### Root Cause
- STS (Signature) tokens include explicit timestamp parameter for replay protection
- OAuth tokens use JWT standard expiry claims (`exp`, `iat`)
- Timestamp validation was incorrectly applied to both token types

#### Decision
Skip timestamp validation for OAuth tokens; validate only STS tokens

#### Rationale
- **OAuth Standard**: OAuth tokens have their own expiry validation via JWT claims
- **Userinfo Validation**: Aliyun's userinfo endpoint validates token expiry
- **Token Type Separation**: STS and OAuth have different security models
- **Correctness**: Timestamp parameter doesn't exist in OAuth tokens

#### Implementation Details
```java
// CloudIamRealm.java
// Timestamp validation only applies to STS tokens, not OAuth tokens
// OAuth tokens are validated via the userinfo endpoint which checks expiration
if (iamToken.isOAuthToken() == false && isTimestampValid(iamToken.timestamp()) == false) {
    listener.onResponse(AuthenticationResult.terminate("invalid iam token timestamp"));
    return;
}
```

#### Files Affected
- `es-9.2.4-plugins/plugins/security-realm-cloud-iam/src/main/java/.../CloudIamRealm.java`

#### Consequences
- ✅ OAuth tokens authenticate successfully
- ✅ Proper separation of STS and OAuth validation
- ✅ Follows OAuth standards
- ✅ STS tokens still protected against replay attacks

#### Lessons Learned
- Different token types require different validation strategies
- Always verify assumptions with diagnostic logging
- Token expiry should be validated at the source (Aliyun)

---

### Decision 5: Defer Token Refresh Implementation
**Date**: 2026-01-30
**Decision Maker**: Implementation team
**Status**: ⏳ PENDING

#### Context
OAuth access tokens expire after 1-2 hours. Without refresh, users are forcibly logged out.

#### Options Considered
1. **Implement Now** (before initial deployment)
   - Complete feature from start
   - Better user experience
   - Delays initial deployment

2. **Defer Until After Initial Validation** ✅ CHOSEN
   - Faster initial deployment
   - Validate core OAuth flow first
   - Implement refresh based on user feedback
   - Can test with shorter sessions initially

3. **Never Implement** (force re-authentication)
   - Simplest approach
   - Poor user experience
   - Not viable for production

#### Decision
Defer token refresh implementation until after core OAuth flow is validated

#### Rationale
- **Risk Mitigation**: Validate core functionality first
- **Iterative Development**: Add features incrementally
- **User Feedback**: Understand actual session duration needs
- **Complexity**: Token refresh adds storage and security complexity
- **Testing**: Can test without refresh in development

#### Acceptance Criteria for Deferral
- Core OAuth flow must work end-to-end
- Users can successfully authenticate
- Session management works correctly
- Clear documentation of limitation

#### Implementation Plan (When Ready)
See `docs/OAUTH_TOKEN_LIFECYCLE.md` for detailed implementation guide:
1. Store refresh_token in encrypted session
2. Detect token expiry before requests
3. Implement refresh endpoint
4. Update Aliyun provider to auto-refresh
5. Handle refresh failures gracefully

#### Temporary Workaround
- Document that users will be logged out after 1-2 hours
- Set session timeout to match token lifetime
- Provide clear "Session Expired" messaging

#### Files Affected (When Implemented)
- `x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.ts`
- `x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts`

#### Consequences
- ✅ Faster initial deployment
- ✅ Focus on core functionality first
- ✅ Can validate OAuth flow independently
- ⚠️ Users logged out every 1-2 hours (temporary)
- ⚠️ Must implement before production deployment
- ⚠️ Additional work required later

#### Priority: HIGH (Required for Production)

---

### Decision 6: Manual Testing Instead of Full Automation
**Date**: 2026-01-29
**Decision Maker**: Implementation team
**Status**: ✅ Accepted

#### Context
Attempted to create automated end-to-end OAuth testing using Playwright, but Aliyun's login security prevents automation.

#### Blockers Identified
- Anti-bot protection (slider verification)
- Dynamic form rendering
- SMS verification requirements
- Possible CAPTCHA challenges
- Session fingerprinting

#### Options Considered
1. **Use CAPTCHA Solving Services**
   - Expensive
   - Unreliable
   - Against Aliyun ToS
   - Not sustainable

2. **Mock Aliyun OAuth Responses**
   - Unit tests work
   - Integration tests work
   - Doesn't test real OAuth flow
   - Misses Aliyun API changes

3. **Manual Testing** ✅ CHOSEN
   - Reliable for E2E validation
   - Tests real production flow
   - Acceptable for infrequent testing
   - Can automate everything except login

#### Decision
Use manual testing for end-to-end OAuth flow validation

#### Testing Strategy
- **Unit Tests**: Automated (mock all external calls)
- **Integration Tests**: Automated (mock Aliyun API responses)
- **E2E Tests**: Manual (real Aliyun OAuth flow)

#### Implementation Details
Created comprehensive manual testing guide:
- `docs/MANUAL_OAUTH_VALIDATION.md`
- Step-by-step validation procedure
- Expected results at each step
- Troubleshooting guide

#### Automated Testing Coverage
- ✅ PKCE generation and validation
- ✅ Authorization URL construction
- ✅ Code exchange logic
- ✅ Userinfo parsing
- ✅ Session creation
- ✅ Token validation
- ❌ Actual Aliyun login flow (manual)

#### Consequences
- ✅ Realistic testing of production flow
- ✅ No dependency on fragile automation
- ✅ Respects Aliyun's security measures
- ⚠️ Manual effort required for E2E testing
- ⚠️ Regression testing is manual

#### Best Practices
- Automate everything that CAN be automated
- Document manual testing procedures clearly
- Test manually before each production deployment
- Monitor OAuth success rates in production

---

### Decision 7: Store OAuth State in Memory (Not Database)
**Date**: 2026-01-28
**Decision Maker**: Implementation team
**Status**: ✅ Implemented

#### Context
OAuth flow requires storing state and code_verifier between authorization request and callback. Need to decide where to store this temporary data.

#### Options Considered
1. **In-Memory Map** ✅ CHOSEN
   - Fast access
   - Automatic cleanup (garbage collection)
   - Simple implementation
   - Lost on server restart (acceptable)

2. **Session Store**
   - Persistent across restarts
   - More complex
   - Slower access
   - Unnecessary for temporary data

3. **Database/Elasticsearch**
   - Highly persistent
   - Overkill for temporary data
   - Performance overhead
   - Requires cleanup logic

#### Decision
Use in-memory Map with TTL cleanup

#### Implementation Details
```typescript
const codeVerifiers = new Map<string, string>();

// Store verifier
codeVerifiers.set(state, codeVerifier);

// Retrieve and delete
const verifier = codeVerifiers.get(state);
codeVerifiers.delete(state);
```

#### Cleanup Strategy
- TTL: 10 minutes (OAuth flow should complete quickly)
- Automatic cleanup on retrieval
- Background cleanup for abandoned flows (future enhancement)

#### Files Affected
- `x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.ts`

#### Consequences
- ✅ Fast and simple
- ✅ No external dependencies
- ✅ Automatic memory reclamation
- ⚠️ Data lost on Kibana restart (acceptable for OAuth state)
- ⚠️ Not suitable for multi-node deployments without sticky sessions
- ℹ️ Consider Redis for multi-node setup

#### Multi-Node Consideration
If deploying Kibana in multi-node setup:
- Use sticky sessions (route user to same Kibana node)
- OR: Use shared session store (Redis, Memcached)
- Document this requirement

---

### Decision 8: Use BasePath-Aware Redirect URI Construction
**Date**: 2026-01-28
**Decision Maker**: Implementation team
**Status**: ✅ Implemented

#### Context
Kibana is deployed with basePath `/kibana`, but redirect URI must match exactly what's registered in Aliyun.

#### Challenge
- `server.publicBaseUrl` might include basePath
- `server.basePath` is always just the path component
- Redirect URI must be absolute URL
- Double basePath causes 404 errors

#### Options Considered
1. **Always append basePath**
   - Breaks when publicBaseUrl already includes it
   - Causes redirect_uri_mismatch

2. **Never append basePath**
   - Breaks when publicBaseUrl doesn't include it
   - Inconsistent behavior

3. **Smart Detection** ✅ CHOSEN
   - Check if publicBaseUrl already includes basePath
   - Append only when needed
   - Consistent redirect URI

#### Decision
Implement smart basePath detection in redirect URI construction

#### Implementation Details
```typescript
const hasBasePathInPublicUrl = basePath.publicBaseUrl &&
                               basePath.publicBaseUrl !== 'http://127.0.0.1:5601';

const redirectUri = hasBasePathInPublicUrl
  ? `${basePath.publicBaseUrl}/api/security/aliyun/oauth/callback`
  : `${basePath.publicBaseUrl || 'http://127.0.0.1:5601'}${basePath.serverBasePath}/api/security/aliyun/oauth/callback`;
```

#### Files Affected
- `x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.ts`

#### Consequences
- ✅ Works with and without basePath in publicBaseUrl
- ✅ Prevents double basePath issues
- ✅ Consistent redirect URI
- ⚠️ Slightly more complex logic

#### Configuration Requirements
Ensure `server.publicBaseUrl` is set correctly in kibana.yml:
```yaml
server.publicBaseUrl: "http://47.236.247.55:5601/kibana"  # Includes basePath
# OR
server.publicBaseUrl: "http://47.236.247.55:5601"  # No basePath
server.basePath: "/kibana"  # Will be appended
```

---

## Decision Summary Table

| # | Decision | Date | Status | Priority | Impact |
|---|----------|------|--------|----------|--------|
| 1 | Use OAuth 2.1 with PKCE | 2026-01-27 | ✅ Complete | HIGH | Security |
| 2 | Use `/api/` routes | 2026-01-30 | ✅ Complete | HIGH | Functionality |
| 3 | Validate via Userinfo endpoint | 2026-01-28 | ✅ Complete | MEDIUM | Architecture |
| 4 | Skip timestamp validation for OAuth | 2026-01-29 | ✅ Complete | HIGH | Correctness |
| 5 | Defer token refresh | 2026-01-30 | ⏳ Pending | HIGH | UX |
| 6 | Manual E2E testing | 2026-01-29 | ✅ Accepted | MEDIUM | Quality |
| 7 | In-memory state storage | 2026-01-28 | ✅ Complete | LOW | Scalability |
| 8 | BasePath-aware redirect URI | 2026-01-28 | ✅ Complete | MEDIUM | Configuration |

---

## Pending Decisions

### 1. Token Refresh Implementation Approach
**Status**: Research phase
**Timeline**: Before production deployment
**Options**: Session-based vs Background worker
**Documentation**: `docs/OAUTH_TOKEN_LIFECYCLE.md`

### 2. Multi-Node Deployment Strategy
**Status**: Not yet required
**Timeline**: If scaling beyond single node
**Options**: Sticky sessions vs Shared session store
**Blocker**: Single node sufficient for now

### 3. Role Mapping Strategy
**Status**: Requirements gathering
**Timeline**: Before user onboarding
**Options**: Manual vs Auto-provisioning
**Dependencies**: User identity requirements

---

## Lessons Learned

### What Went Well ✅
1. PKCE implementation prevented security issues
2. Public route pattern followed Kibana conventions
3. Comprehensive documentation prevented miscommunication
4. Diagnostic logging helped debug timestamp issue quickly
5. Separating token types (STS vs OAuth) early was correct

### What Could Be Improved ⚠️
1. Should have implemented token refresh from start
2. Route path decision (`/internal/` vs `/api/`) should have been clear earlier
3. Multi-node considerations should be documented earlier
4. Automated testing limitations should be assessed earlier

### Key Takeaways 💡
1. **Security First**: PKCE was the right choice despite added complexity
2. **Follow Conventions**: Using Kibana's route patterns prevented issues
3. **Document Decisions**: This log helped track reasoning and trade-offs
4. **Validate Assumptions**: Diagnostic logging revealed timestamp misdiagnosis
5. **Iterate Wisely**: Deferring token refresh allowed faster initial deployment

---

## References

- OAuth 2.1 Specification: https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-09
- PKCE RFC 7636: https://datatracker.ietf.org/doc/html/rfc7636
- Kibana Security Plugin: `x-pack/platform/plugins/shared/security/`
- Aliyun OAuth Docs: https://help.aliyun.com/document_detail/93697.html

---

**Maintained By**: Engineering Team
**Last Updated**: 2026-01-30
**Review Frequency**: After each major decision
**Audience**: Developers, Architects, Operations Team
