# Aliyun OAuth 2.1 Diagnostic Report

## Status: ⚠️ Aliyun App Configuration Issue

### Verified Kibana Configuration ✅

| Parameter | Value | Status |
|-----------|-------|--------|
| Client ID | `4004069369666938196` | ✅ Correct |
| Redirect URI | `http://47.236.247.55:5601/kibana/internal/security/aliyun/oauth/callback` | ✅ Correct |
| Scopes | `openid profile aliuid` | ✅ Correct |
| PKCE Method | `S256` | ✅ Correct |
| Response Type | `code` | ✅ Correct |

### Aliyun Response Analysis

```bash
$ curl -v "https://signin.aliyun.com/oauth2/v1/authorize?..."

< HTTP/2 302
< location: http://www.aliyun.com/notfound/
```

**What this means:** Aliyun receives the request but redirects to `/notfound/` because it cannot find or validate the OAuth app.

---

## Required Actions in Aliyun Console

You need to check the following in your Aliyun RAM console:

### 1. Application Status (应用状态)
**Location:** RAM → 应用管理 → 找到应用 ID `4004069369666938196`

| Expected | Current |
|----------|---------|
| 在线 | ❓ Check in console |

**Action:** If status is not "在线", click "启用" to enable the app.

---

### 2. Callback URL (回调地址)
**Location:** 应用详情 → 配置 → 回调地址

**Required value:**
```
http://47.236.247.55:5601/kibana/internal/security/aliyun/oauth/callback
```

| Check | Expected |
|-------|----------|
| Protocol | `http://` (not https) |
| Host | `47.236.247.55:5601` |
| Path | `/kibana/internal/security/aliyun/oauth/callback` |
| Exact match | ✅ Must be identical |

**Common issues:**
- ❌ Using `https://` instead of `http://`
- ❌ Missing port `:5601`
- ❌ Missing `/kibana` basePath
- ❌ Extra trailing slashes

---

### 3. Application Type (应用类型)
**Location:** 应用详情 → 基本信息

**Expected:** Web应用

| Type | Support |
|------|---------|
| Web应用 | ✅ Supports PKCE |
| 单页应用 | ✅ Supports PKCE |
| Native应用 | ❌ May not work |

---

### 4. Grant Type (授权模式)
**Location:** 应用详情 → 配置 → 授权模式

**Required:**
- ✅ Authorization Code (授权码模式)

For PKCE (OAuth 2.1), this is the **only** grant type needed.

---

### 5. Scopes (授权范围)
**Location:** 应用详情 → 配置 → 授权范围

**Required scopes:**
- ✅ `openid`
- ✅ `profile`
- ✅ `aliuid`

**Note:** Some Aliyun OAuth apps require you to explicitly enable each scope.

---

### 6. Environment (地域/环境)
**Location:** Console右上角 → 地域选择

| Environment | China Region |
|-------------|--------------|
| China (中国站) | ✅ `signin.aliyun.com` |
| International | ❌ `signin.alibabacloud.com` |

**Action:** Make sure your OAuth app was created in the **China (中国站)** environment since you're using `signin.aliyun.com`.

---

## Quick Verification Steps

### Step 1: Check App Status
1. Log in to [Aliyun RAM Console](https://ram.console.aliyun.com)
2. Navigate to: 应用管理 → OAuth应用
3. Find app ID: `4004069369666938196`
4. Check status is "在线"

### Step 2: Verify Callback URL
1. Click on the app to view details
2. Go to 配置 → 回调地址
3. Verify exact match with: `http://47.236.247.55:5601/kibana/internal/security/aliyun/oauth/callback`

### Step 3: Check Scopes
1. In app details, go to 配置 → 授权范围
2. Ensure `openid`, `profile`, and `aliuid` are enabled

---

## Test After Fixing

Once you've verified/fixed the Aliyun configuration, test the flow:

```bash
# 1. Test OAuth endpoint
curl "http://127.0.0.1:5601/kibana/internal/security/aliyun/oauth/authorize"

# 2. Visit login page in browser
# http://47.236.247.55:5601/kibana/login

# 3. Click "Log in with Aliyun RAM"
# You should be redirected to Aliyun login page (not /notfound/)
```

---

## Possible Root Causes

Based on the `/notfound/` response, the issue is likely one of:

1. **App disabled** - Status is "离线" or "已禁用"
2. **Wrong environment** - App created in International region but accessed from China
3. **Callback mismatch** - Redirect URI doesn't exactly match
4. **Missing scopes** - `aliuid` scope not enabled in app config
5. **Wrong app type** - Created as wrong type that doesn't support PKCE

---

## Files Modified (For Reference)

- `x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun_oauth.ts`
- `x-pack/platform/plugins/shared/security/server/config.ts`
- `x-pack/platform/plugins/shared/security/public/authentication/login/components/aliyun_login_form/aliyun_login_form.tsx`
- `config/kibana.yml`
- `x-pack/platform/plugins/shared/security/server/routes/aliyun_role_mappings/*`

---

## Support

If after verifying all settings the issue persists:
1. Try recreating the OAuth app in Aliyun console
2. Make sure to select "Web应用" type
3. Use the correct callback URL exactly as shown above
4. Enable all required scopes

Generated: 2026-01-29
