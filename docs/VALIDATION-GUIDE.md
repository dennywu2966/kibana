# Aliyun OAuth 2.1 SSO Validation Guide

This guide documents the complete validation process for Aliyun OAuth 2.1 SSO integration with Kibana 9.2.4.

## Prerequisites

1. **Kibana Configuration** (`config/kibana.yml`):
   ```yaml
   server.host: "0.0.0.0"
   server.basePath: "/kibana"
   server.publicBaseUrl: "http://47.236.247.55:5601/kibana"

   xpack.security.authc.providers:
     aliyun.aliyun:
       order: 100
       description: "Log in with Aliyun RAM"
       oauth:
         clientId: "4004069369666938196"
     basic.basic:
       order: 0

   server.restrictInternalApis: false
   ```

2. **Aliyun OAuth App Configuration**:
   - Client ID: `4004069369666938196`
   - Redirect URI: `http://47.236.247.55:5601/kibana/internal/security/aliyun/oauth/callback`
   - Scopes: `openid`, `profile`, `aliuid`
   - Grant Type: Authorization Code with PKCE

## Validation Tests

### Test 1: Login State API

**Purpose**: Verify Aliyun provider is registered in login selector.

**Command**:
```bash
curl -s "http://127.0.0.1:5601/kibana/internal/security/login_state" | jq '.selector.providers[] | select(.type == "aliyun")'
```

**Expected Result**:
```json
{
  "type": "aliyun",
  "name": "aliyun",
  "usesLoginForm": false,
  "showInSelector": true,
  "description": "Log in with Aliyun RAM",
  "hint": "For Aliyun RAM users",
  "icon": "logoCloud"
}
```

**Success Criteria**: Provider is listed with `showInSelector: true`.

---

### Test 2: OAuth Authorize Endpoint

**Purpose**: Verify OAuth authorization URL generation with PKCE parameters.

**Command**:
```bash
curl -s "http://127.0.0.1:5601/kibana/internal/security/aliyun/oauth/authorize" | jq '.'
```

**Expected Result**:
```json
{
  "authorizationUrl": "https://signin.aliyun.com/oauth2/v1/auth?client_id=4004069369666938196&redirect_uri=http%3A%2F%2F47.236.247.55%3A5601%2Fkibana%2Finternal%2Fsecurity%2Faliyun%2Foauth%2Fcallback&response_type=code&scope=openid+profile+aliuid&state=...&code_challenge=...&code_challenge_method=S256",
  "state": "..."
}
```

**Success Criteria**:
- Authorization URL points to `https://signin.aliyun.com/oauth2/v1/auth`
- Client ID is correct
- Redirect URI matches Kibana callback URL
- PKCE parameters present: `code_challenge` and `code_challenge_method=S256`
- Scopes include `openid`, `profile`, `aliuid`

---

### Test 3: Frontend Login Flow (Playwright)

**Purpose**: Verify complete UI flow from login page to Aliyun SSO redirect.

**Test Script** (`/tmp/test_aliyun_sso.py`):
```python
from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)  # Use headless=False for visual testing
    page = browser.new_page()

    # Navigate to login page
    page.goto('http://127.0.0.1:5601/kibana/login', wait_until='networkidle')
    time.sleep(3)

    # Track Aliyun requests
    aliyun_requests = []
    def track_request(request):
        if 'aliyun' in request.url.lower():
            aliyun_requests.append(request.url)

    page.on('request', track_request)

    # Click Aliyun card in selector
    aliyun_card = page.locator('button:has-text("Log in with Aliyun RAM")').first
    aliyun_card.click()
    time.sleep(2)

    # Click submit button in Aliyun form
    submit_button = page.locator('[data-test-subj="aliyunLoginSubmit"]')
    submit_button.click()

    # Wait for redirect
    try:
        page.wait_for_url('**/signin.aliyun.com/**', timeout=10000)
        print("✓ Successfully redirected to Aliyun SSO!")
        print(f"Current URL: {page.url}")
    except:
        print("✗ Redirect to Aliyun SSO did not occur")
        print(f"Current URL: {page.url}")

    browser.close()
```

**Success Criteria**:
- Aliyun card is visible in login selector
- Clicking card shows Aliyun login form
- Clicking submit button triggers OAuth authorize API
- Browser redirects to `https://signin.aliyun.com/oauth2/v1/auth`
- Authorization URL contains all required parameters

---

### Test 4: Role Mapping Verification

**Purpose**: Verify ES role mapping exists for Aliyun ARN.

**Command**:
```bash
curl -s -u 'elastic:Summer11' "http://127.0.0.1:9200/_security/role_mapping/aliyun_user_dongdongplanet_1437310945246567" | jq '.'
```

**Expected Result**:
```json
{
  "roles": ["kibana_admin", "read_only"],
  "enabled": true,
  "rules": {
    "all": [{
      "field": {
        "metadata.aliyun_arn": "acs:ram::1437310945246567:user/dongdongplanet"
      }
    }]
  }
}
```

**Success Criteria**: Role mapping exists for the user's ARN.

---

### Test 5: Complete Login Flow (Manual)

**Purpose**: End-to-end manual validation of SSO login.

**Steps**:
1. Navigate to `http://47.236.247.55:5601/kibana/login`
2. Click "Log in with Aliyun RAM"
3. Enter Aliyun credentials:
   - Username: `dongdongplanet@1437310945246567.onaliyun.com`
   - Password: `Summer11`
4. Complete any MFA if required
5. Verify redirect back to Kibana
6. Verify user is logged in

**Success Criteria**:
- User is redirected to Kibana after Aliyun authentication
- User session is created
- User can access Kibana features

---

## Known Limitations

### Elasticsearch Authentication

**Current Behavior**: The implementation creates Kibana sessions directly without Elasticsearch authentication.

**Impact**:
- ✅ User can access Kibana UI
- ✅ User has valid Kibana session
- ⚠️ Direct ES queries may fail due to lack of ES authentication
- ⚠️ ES-level role mappings don't apply

**Why**: The Cloud IAM realm (which accepts STS signatures) is not installed in Elasticsearch.

**Options for Full ES Integration**:
1. Install Cloud IAM realm plugin in Elasticsearch
2. Create a custom ES realm that accepts OAuth tokens
3. Use service account to create native ES users

### STS Token Exchange

**Question**: Can OAuth token be exchanged for STS signature?

**Answer**: No, not with the current Aliyun OAuth setup.

**Reason**:
- `AssumeRoleWithOIDC` API is for external IdPs (Okta, Azure AD), not Aliyun's own OAuth service
- Calling Aliyun STS API requires RAM AccessKeys, not OAuth tokens
- The Cloud IAM realm would need to be installed to use STS signatures

## Files Modified

- `/x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.ts`
  - OAuth 2.1 PKCE flow implementation
  - Fixed authorization endpoint: `/oauth2/v1/auth`
  - Fixed userinfo endpoint: `/v1/userinfo`

- `/x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts`
  - Creates Kibana sessions from OAuth credentials
  - Supports both SAML and OAuth authentication methods

- `/x-pack/platform/plugins/shared/security/public/authentication/login/components/aliyun_login_form/aliyun_login_form.tsx`
  - Frontend component for Aliyun OAuth login
  - Handles OAuth callback processing

- `/config/kibana.yml`
  - Aliyun provider configuration

## Regression Testing

To prevent regressions, run these tests after any changes:

```bash
# Quick smoke test
./scripts/test_aliyun_sso.sh

# Full validation (requires Playwright)
python3 /tmp/test_aliyun_sso.py --full
```

## Troubleshooting

### Issue: Aliyun redirects to `/notfound/`

**Cause**: OAuth app not configured correctly in Aliyun console.

**Solution**:
1. Verify app is enabled (在线 status)
2. Verify callback URL matches exactly: `http://47.236.247.55:5601/kibana/internal/security/aliyun/oauth/callback`
3. Verify app type is "Web应用" or "单页应用"

### Issue: "Invalid state parameter" error

**Cause**: PKCE code verifier expired or not found.

**Solution**: This is a timing issue. The code verifier is stored in memory and expires after use. Re-initiate the login flow.

### Issue: User not authenticated after callback

**Cause**: Authentication provider not processing credentials correctly.

**Solution**: Check Kibana logs for authentication errors. Verify the provider configuration in kibana.yml.

---

Last Updated: 2026-01-29
Tested With: Kibana 9.2.4, Node 22.21.1
