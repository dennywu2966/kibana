# OAuth Token Lifecycle and Refresh Strategy

## Current Implementation Status

### Token Expiration

**Yes, OAuth access tokens expire automatically** based on Aliyun's token lifetime settings (typically 1-2 hours).

### Token Refresh - NOT CURRENTLY IMPLEMENTED ⚠️

**Current Behavior:**
- When the OAuth access token expires, users will be logged out
- Users must manually click "Log in with Aliyun RAM" again to re-authenticate
- No automatic token refresh mechanism exists

**This is a CRITICAL MISSING FEATURE for production use.**

## Why Token Refresh is Important

Without token refresh:
1. ❌ Users are forcibly logged out every 1-2 hours
2. ❌ Active work sessions are interrupted
3. ❌ Poor user experience in production
4. ❌ Increased load on Aliyun's OAuth endpoints

## Recommended Implementation

### Option 1: Session-Based Approach (Recommended)

Instead of relying on OAuth tokens directly, use Kibana sessions:

```typescript
// In aliyun_oauth.ts callback handler
async function handleCallback(code: string) {
  // 1. Exchange code for tokens
  const tokens = await exchangeCodeForTokens(code);

  // 2. Get user info
  const userInfo = await getUserInfo(tokens.access_token);

  // 3. Create Kibana session (NOT storing OAuth token)
  // Store refresh_token securely in session
  const session = await createKibanaSession(userInfo, {
    refresh_token: tokens.refresh_token,
    token_expires_at: Date.now() + tokens.expires_in * 1000
  });

  return session;
}

// In Aliyun authentication provider
async function authenticate(request, session) {
  // Check if token is about to expire (e.g., < 5 minutes left)
  if (session.token_expires_at - Date.now() < 5 * 60 * 1000) {
    // Refresh the token silently
    const newTokens = await refreshAccessToken(session.refresh_token);

    // Update session with new token
    await updateSession(session.id, {
      access_token: newTokens.access_token,
      token_expires_at: Date.now() + newTokens.expires_in * 1000
    });
  }

  // Use current valid token for Elasticsearch authentication
  return authenticateWithES(session.access_token);
}
```

### Option 2: Background Refresh Worker

```typescript
// Create a background task that refreshes tokens before expiry
class TokenRefreshWorker {
  private intervalId: NodeJS.Timeout;

  start() {
    // Run every 5 minutes
    this.intervalId = setInterval(async () => {
      const expiringSessions = await getSessionsExpiringIn(10 * 60 * 1000); // 10 min

      for (const session of expiringSessions) {
        try {
          const newTokens = await refreshAccessToken(session.refresh_token);
          await updateSession(session.id, {
            access_token: newTokens.access_token,
            token_expires_at: Date.now() + newTokens.expires_in * 1000
          });
        } catch (error) {
          // If refresh fails, invalidate session
          await invalidateSession(session.id);
        }
      }
    }, 5 * 60 * 1000);
  }
}
```

## Implementation Steps

### 1. Update OAuth Callback to Store Refresh Token

File: `x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.ts`

```typescript
// In the callback handler, capture refresh_token from Aliyun
const tokenResponse = await fetch(ALIYUN_TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: oauthConfig.clientId,
    code_verifier: codeVerifier,
  }),
});

const tokens = await tokenResponse.json();
// tokens.access_token - use immediately
// tokens.refresh_token - store in session for later refresh
// tokens.expires_in - calculate expiration time
```

### 2. Add Refresh Token Endpoint

```typescript
// Add to aliyun_oauth.ts
router.post(
  {
    path: '/api/security/aliyun/oauth/refresh',
    security: {
      authc: { enabled: true },
      authz: { enabled: false },
    },
  },
  async (context, request, response) => {
    try {
      const session = request.auth.session;
      const refreshToken = session.value.refresh_token;

      const tokenResponse = await fetch(ALIYUN_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: oauthConfig.clientId,
        }),
      });

      const newTokens = await tokenResponse.json();

      // Update session with new tokens
      await updateSession(session.id, {
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token || refreshToken,
        token_expires_at: Date.now() + newTokens.expires_in * 1000,
      });

      return response.ok({ body: { success: true } });
    } catch (error) {
      return response.customError(wrapIntoCustomErrorResponse(error));
    }
  }
);
```

### 3. Update Aliyun Provider to Check Token Expiry

File: `x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts`

```typescript
public async authenticate(request: KibanaRequest, state?: ProviderState | null) {
  if (state?.authorization) {
    // Check if token is expiring soon (less than 5 minutes)
    const expiresAt = state.token_expires_at || 0;
    const now = Date.now();

    if (expiresAt - now < 5 * 60 * 1000) {
      // Token is expiring, trigger refresh
      try {
        const refreshed = await this.refreshToken(state.refresh_token);
        state = {
          ...state,
          authorization: refreshed.access_token,
          token_expires_at: refreshed.expires_at,
        };
      } catch (err) {
        // Refresh failed, force re-authentication
        return AuthenticationResult.redirectTo('/login');
      }
    }

    // Continue with authentication using (possibly refreshed) token
    const authHeaders = { 'X-ES-IAM-Signed': state.authorization };
    const user = await this.getUser(request, authHeaders);

    return AuthenticationResult.succeeded(user, { authHeaders, state });
  }

  // ... rest of authentication logic
}
```

## Security Considerations

### Storing Refresh Tokens

⚠️ **CRITICAL**: Refresh tokens are sensitive credentials that allow obtaining new access tokens.

**Best Practices:**
1. ✅ Encrypt refresh tokens at rest in the session store
2. ✅ Use HTTP-only, secure cookies for session IDs
3. ✅ Set appropriate session timeouts (e.g., 8 hours)
4. ✅ Implement refresh token rotation (Aliyun may provide new refresh token with each refresh)
5. ✅ Invalidate all sessions on logout
6. ❌ NEVER expose refresh tokens to the browser/client

### Token Rotation

Aliyun OAuth 2.1 may implement refresh token rotation:
- Each time you use a refresh token, you get a NEW refresh token
- The old refresh token becomes invalid
- This prevents refresh token replay attacks

```typescript
// Handle token rotation
const newTokens = await refreshAccessToken(oldRefreshToken);

await updateSession(sessionId, {
  access_token: newTokens.access_token,
  refresh_token: newTokens.refresh_token || oldRefreshToken, // Use new if provided
  token_expires_at: Date.now() + newTokens.expires_in * 1000,
});
```

## Alternative: Shorter Session Timeout

If implementing token refresh is complex, you can:

1. **Set Kibana session timeout to match token expiry**:
   ```yaml
   # kibana.yml
   xpack.security.session.idleTimeout: 1h
   xpack.security.session.lifespan: 8h
   ```

2. **Force re-authentication on session expiry**:
   - User is redirected to login page
   - Can use "Remember me" cookies to speed up re-auth
   - Still requires manual OAuth flow

**Pros:**
- ✅ Simple to implement
- ✅ More secure (shorter token lifetime)

**Cons:**
- ❌ Disruptive user experience
- ❌ Users lose unsaved work

## Current Status

### What Works Now ✅
- Initial OAuth login flow
- Token exchange and userinfo retrieval
- Session creation with access token
- Authentication with Elasticsearch using access token

### What's Missing ⚠️
- ❌ Refresh token storage in session
- ❌ Token expiry detection
- ❌ Automatic token refresh before expiry
- ❌ Graceful session extension

### Impact on Users
- **Current**: Users will be logged out after ~1-2 hours (token expiry)
- **With Refresh**: Users stay logged in for session lifetime (8+ hours)

## Recommended Next Steps

1. **Immediate (Workaround)**:
   - Document that users need to re-login every 1-2 hours
   - Set session timeout to match token lifetime
   - Add clear "Session Expired" message

2. **Short-term (Essential)**:
   - Implement refresh token storage (encrypted)
   - Add token expiry detection in provider
   - Implement manual refresh on next request

3. **Long-term (Optimal)**:
   - Implement background token refresh worker
   - Add token refresh metrics/monitoring
   - Implement refresh token rotation
   - Add "Remember me" functionality

## Testing Token Refresh

```bash
# 1. Login and capture tokens
curl -c cookies.txt "http://localhost:5601/kibana/api/security/aliyun/oauth/authorize"
# Complete OAuth flow in browser

# 2. Wait for token to expire (or mock expiration)

# 3. Make authenticated request - should trigger refresh
curl -b cookies.txt "http://localhost:5601/kibana/api/status"

# 4. Verify new token was issued (check session)
```

## References

- [OAuth 2.1 Refresh Token Spec](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-09#section-6)
- [Aliyun OAuth Documentation](https://help.aliyun.com/document_detail/93697.html)
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

---

**Status**: ⚠️ Token refresh NOT implemented - users will be logged out when token expires
**Priority**: HIGH - Essential for production use
**Complexity**: Medium - Requires session store updates and provider modifications
