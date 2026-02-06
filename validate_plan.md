# Authentication Validation Plan

## Overview

This document describes the validation plan for Kibana authentication methods:
1. **Basic Auth** - Existing simple authentication (elastic/Summer11)
2. **OAuth** - New Aliyun RAM SSO integration

**Target URL**: http://47.236.247.55:5601

**Test Tool**: Playwright MCP (headless Chromium)

---

## Prerequisites

1. Stack must be running:
   - Elasticsearch: https://127.0.0.1:9200
   - Kibana: http://47.236.247.55:5601

2. Start stack if needed:
   ```bash
   ./project-starter.sh
   ```

3. Verify stack health before testing:
   ```bash
   curl -sk -u elastic:Summer11 https://127.0.0.1:9200/_cluster/health
   curl -s http://localhost:5601/api/status
   ```

---

## Test Credentials

| Type | Username/Email | Password | Notes |
|------|----------------|----------|-------|
| Basic Auth | elastic | Summer11 | ES superuser |
| OAuth | dongdongplanet@1437310945246567.onaliyun.com | Summer11 | Aliyun RAM account |
| SMS | 18972952966 | - | For OTP verification |

---

## Test Suite 1: Basic Auth Regression Tests

### 1.1 Positive Case: Valid Credentials

**Objective**: Verify basic auth still works with valid credentials.

**Steps**:
1. Navigate to http://47.236.247.55:5601
2. Click on "Basic" tab or look for basic auth option
3. Enter username: `elastic`
4. Enter password: `Summer11`
5. Click "Log in"
6. Verify redirect to home page (http://47.236.247.55:5601/app/home)
7. Verify page shows Kibana dashboard (not error page)

**Expected Result**:
- Successful login
- Redirect to `/app/home`
- No JavaScript errors in console
- Dashboard visible

**Playwright Check**:
```javascript
// No errors in console
// Page title contains "Kibana"
// URL ends with /app/home or /app/discover or similar
```

---

### 1.2 Negative Case: Invalid Password

**Objective**: Verify proper error handling for invalid credentials.

**Steps**:
1. Navigate to http://47.236.247.55:5601
2. Click on "Basic" tab
3. Enter username: `elastic`
4. Enter password: `WrongPassword123`
5. Click "Log in"
6. Verify error message displayed

**Expected Result**:
- Login fails
- Error message shown (e.g., "Invalid username or password")
- No redirect to home page
- Stay on login page

**Playwright Check**:
```javascript
// URL still on login page
// Error message visible in DOM
// No redirect occurred
```

---

### 1.3 Negative Case: Invalid Username

**Objective**: Verify proper error handling for non-existent user.

**Steps**:
1. Navigate to http://47.236.247.55:5601
2. Click on "Basic" tab
3. Enter username: `nonexistent_user`
4. Enter password: `any_password`
5. Click "Log in"
6. Verify error message displayed

**Expected Result**:
- Login fails
- Error message shown
- No redirect to home page

---

## Test Suite 2: OAuth Flow Tests

### 2.1 Positive Case: Complete OAuth Flow

**Objective**: Verify full OAuth login flow with Aliyun RAM.

**Steps**:
1. Navigate to http://47.236.247.55:5601
2. Click "Log in with Aliyun RAM" button (should be visible with order: 0)
3. Verify redirect to Aliyun OAuth page
4. On Aliyun login page:
   - Enter email/username: `dongdongplanet@1437310945246567.onaliyun.com`
   - Enter password: `Summer11`
   - Click login
5. If SMS verification prompted:
   - Enter OTP code sent to `18972952966`
   - Submit
6. Verify redirect back to Kibana callback
7. Verify final redirect to home page
8. Verify user is logged in

**Expected Result**:
- Successful OAuth flow
- Redirect to `/app/home`
- User session established
- No OAuth errors

**Playwright Check**:
```javascript
// Initial page shows Aliyun login button
// After click, URL contains aliyun.com or signin.aliyun.com
// After auth, redirect to /api/security/aliyun/oauth/callback
// Final URL ends with /app/home or similar
// No console errors
```

---

### 2.2 Negative Case: Wrong OAuth Password

**Objective**: Verify OAuth handles invalid password correctly.

**Steps**:
1. Navigate to http://47.236.247.55:5601
2. Click "Log in with Aliyun RAM"
3. On Aliyun login page:
   - Enter email: `dongdongplanet@1437310945246567.onaliyun.com`
   - Enter password: `WrongPassword`
   - Click login
4. Verify error on Aliyun side

**Expected Result**:
- Aliyun shows authentication error
- No redirect back to Kibana
- Or redirect back with error parameter

---

### 2.3 Negative Case: User Cancels OAuth Flow

**Objective**: Verify behavior when user cancels on Aliyun side.

**Steps**:
1. Navigate to http://47.236.247.55:5601
2. Click "Log in with Aliyun RAM"
3. On Aliyun page, click cancel/back
4. Verify redirect back to Kibana with appropriate message

**Expected Result**:
- Redirect back to Kibana login page
- Error message about cancelled authorization
- Can try again

---

### 2.4 Negative Case: Invalid OAuth Account

**Objective**: Verify OAuth handles non-existent Aliyun account.

**Steps**:
1. Navigate to http://47.236.247.55:5601
2. Click "Log in with Aliyun RAM"
3. On Aliyun page:
   - Enter email: `nonexistent@nonexistent.onaliyun.com`
   - Enter any password
   - Click login
4. Verify error

**Expected Result**:
- Aliyun shows authentication failure
- No successful login

---

## Test Suite 3: UI/UX Verification

### 3.1 Login Page Layout

**Objective**: Verify login page shows both options correctly.

**Steps**:
1. Navigate to http://47.236.247.55:5601
2. Take screenshot
3. Verify elements:
   - "Log in with Aliyun RAM" button prominent (order: 0)
   - Basic auth option available (order: 100)
   - Proper labels and descriptions

**Expected Result**:
- Both login methods visible
- Aliyun OAuth button is primary (higher priority)
- Basic auth is secondary option

**Playwright Check**:
```javascript
// Button with text containing "Aliyun" or "RAM" exists
// Basic auth form exists
// No JavaScript errors
```

---

### 3.2 Console Error Check

**Objective**: Verify no JavaScript errors on login and after login.

**Steps**:
1. Open browser with console logging enabled
2. Navigate to http://47.236.247.55:5601
3. Check console for errors
4. Login with basic auth
5. Check console again
6. Logout
7. Login with OAuth
8. Check console again

**Expected Result**:
- No JavaScript errors at any point
- No 404s for critical resources
- No network errors for API calls

---

## Test Suite 4: Session Management

### 4.1 Session Persistence

**Objective**: Verify session persists across page navigation.

**Steps**:
1. Login with basic auth
2. Navigate to different pages (Discover, Dashboard, Dev Tools)
3. Verify no re-authentication required
4. Refresh page
5. Verify still logged in

**Expected Result**:
- Session persists across navigation
- Refresh maintains login state

---

### 4.2 Logout Functionality

**Objective**: Verify logout works correctly.

**Steps**:
1. Login with any method
2. Click logout/user menu
3. Click logout
4. Verify redirect to login page
5. Verify cannot access protected pages

**Expected Result**:
- Successful logout
- Redirect to login page
- Session cleared

---

## Execution Using Playwright MCP

### Basic Auth Test Example

```javascript
// Navigate to login
await page.goto('http://47.236.247.55:5601');

// Check for basic auth form
const basicForm = await page.$('form[data-test-subj="login-form"]');
if (basicForm) {
  await page.fill('input[name="username"]', 'elastic');
  await page.fill('input[name="password"]', 'Summer11');
  await page.click('button[type="submit"]');

  // Wait for navigation
  await page.waitForNavigation();

  // Verify success
  const currentUrl = page.url();
  console.log('After login URL:', currentUrl);
  // Should contain /app/
}
```

### OAuth Test Example

```javascript
// Navigate and click OAuth
await page.goto('http://47.236.247.55:5601');

// Find and click Aliyun button
const aliyunButton = await page.$('button:has-text("Aliyun")');
if (aliyunButton) {
  await aliyunButton.click();

  // Wait for Aliyun page
  await page.waitForURL(/aliyun\.com/);

  // Fill credentials
  await page.fill('input[name="username"]', 'dongdongplanet@1437310945246567.onaliyun.com');
  await page.fill('input[name="password"]', 'Summer11');

  // Continue flow...
}
```

---

## Validation Checklist

Run through this checklist to complete validation:

- [ ] **Basic Auth - Valid**: Login with elastic/Summer11 succeeds
- [ ] **Basic Auth - Wrong Password**: Shows error, no login
- [ ] **Basic Auth - Wrong User**: Shows error, no login
- [ ] **OAuth - Valid Flow**: Complete flow succeeds, user logged in
- [ ] **OAuth - Wrong Password**: Handled correctly
- [ ] **OAuth - Cancel Flow**: Returns to login with message
- [ ] **OAuth - Invalid Account**: Handled correctly
- [ ] **UI - Login Page**: Both options visible, proper order
- [ ] **Console - No Errors**: No JavaScript errors throughout
- [ ] **Session - Persistence**: Stays logged in across navigation
- [ ] **Session - Logout**: Logout works, session cleared

---

## Success Criteria

Validation is considered successful when:

1. All basic auth tests pass (no regression)
2. OAuth flow completes successfully with valid credentials
3. Negative cases are handled gracefully with proper error messages
4. No JavaScript errors in browser console
5. UI shows both authentication options in correct order
6. Session management works correctly

---

## Troubleshooting

### Stack Not Running
```bash
# Check if ES is running
curl -sk -u elastic:Summer11 https://127.0.0.1:9200

# Check if Kibana is running
curl -s http://localhost:5601/api/status

# Restart stack
./project-starter.sh
```

### OAuth Redirect Mismatch
If you see `redirect_uri_mismatch`:
1. Check `server.publicBaseUrl` in kibana.yml
2. Must be `http://47.236.247.55:5601`
3. Restart Kibana after changing

### Playwright MCP Setup
Ensure Playwright MCP is configured with:
- Headless Chromium
- Proper navigation timeouts
- Console error capture enabled
