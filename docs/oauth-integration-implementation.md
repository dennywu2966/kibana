# Aliyun OAuth Integration with Cloud IAM Realm

## Overview

This implementation extends the Elasticsearch Cloud IAM realm to support Aliyun OAuth 2.1 access tokens alongside the existing STS signature validation. This enables proper role-based permission mapping for OAuth-authenticated users.

## Problem Statement

Aliyun OAuth access tokens **cannot** be exchanged for STS signatures because:
- `AssumeRoleWithOIDC` API only works for external IdPs (Okta, Azure AD)
- Aliyun's own OAuth system (`signin.aliyun.com`) has no bridge to STS
- The previous Kibana implementation created sessions locally without ES authentication

## Solution

Extend the ES Cloud IAM realm to:
1. Detect and validate OAuth Bearer tokens from `Authorization` header
2. Call Aliyun userinfo endpoint to extract user/role identity
3. Construct proper ARN-based principals for permission mapping
4. Support both RAM users and RAM roles with correct ARN formats

## Implementation Changes

### 1. Elasticsearch Plugin (`es-9.2.4-plugins/plugins/security-realm-cloud-iam/`)

#### New File: `OAuthTokenValidator.java`

Validates OAuth tokens by calling Aliyun userinfo endpoint:

```java
public class OAuthTokenValidator implements IamClient {
    // Calls https://oauth.aliyun.com/v1/userinfo
    // Extracts: accountId (aid), userId (uid), userName (upn), type
    // Constructs ARN based on type (user/role)
}
```

**Key Features:**
- Supports both RAM users and RAM roles
- Constructs proper ARN formats:
  - Users: `acs:ram::{accountId}:user/{userName}`
  - Roles: `acs:ram::{accountId}:role/{roleName}`
- Caches validated tokens to reduce API calls
- Configurable endpoint and timeouts

#### Modified: `CloudIamToken.java`

Added OAuth token support alongside STS signatures:

```java
// New field for OAuth tokens
private final String oauthToken;

// New method to detect token type
public boolean isOAuthToken() {
    return oauthToken != null;
}

// Updated factory to handle both headers
public static CloudIamToken fromHeaders(
    String signedHeader,      // X-ES-IAM-Signed (STS)
    String authorization,     // Authorization (OAuth)
    int signedHeaderMaxBytes
)
```

**Key Features:**
- Dual token format support (STS signature + OAuth Bearer)
- Type detection for routing to correct validator
- Backward compatible with existing STS authentication

#### Modified: `CloudIamRealm.java`

Updated to route tokens to appropriate validator:

```java
// Two clients instead of one
private final IamClient stsClient;     // For STS signatures
private final IamClient oauthClient;   // For OAuth tokens

// Token extraction checks both headers
String signedRequest = context.getHeader(signedHeader);
String authorization = context.getHeader("Authorization");

// Route based on token type
IamClient client = iamToken.isOAuthToken() ? oauthClient : stsClient;
```

**Key Features:**
- Auto-detection of token type (OAuth vs STS)
- Separate caching strategies for each type
- Maintains all existing security features (nonce, replay protection, etc.)

#### Modified: `CloudIamSecurityExtension.java`

Creates both validators:

```java
String mode = config.getSetting(AUTH_MODE, () -> "aliyun");
IamClient stsClient = "mock".equals(mode)
    ? new MockIamClient(config)
    : new AliyunStsClient(config);
IamClient oauthClient = "mock".equals(mode)
    ? new MockIamClient(config)
    : new OAuthTokenValidator(config);
```

### 2. Kibana (`x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts`)

Changed from local session creation to ES authentication:

```typescript
// Before: Created user session locally without ES auth
const user = { username: arn, roles: [], ... };
return AuthenticationResult.succeeded(user);

// After: Pass Bearer token to ES for validation
const authHeaders = { 'Authorization': `Bearer ${accessToken}` };
const user = await this.getUser(request, authHeaders);
```

**Key Changes:**
- OAuth tokens now validated by ES Cloud IAM realm
- Proper role mappings applied based on extracted ARN
- Consistent authentication flow with STS

## Userinfo Response Handling

### RAM User Response

```json
{
  "sub": "1437310945246567:289518327600482862",
  "aid": "1437310945246567",
  "uid": "289518327600482862",
  "upn": "dongdongplanet",
  "name": "Dong Dong",
  "type": "user"
}
```

**Extracted ARN:** `acs:ram::1437310945246567:user/dongdongplanet`

### RAM Role Response

```json
{
  "sub": "1437310945246567:role/myrole",
  "aid": "1437310945246567",
  "type": "role"
}
```

**Extracted ARN:** `acs:ram::1437310945246567:role/myrole`

## Role Mapping Configuration

Configure role mappings based on the extracted ARN:

```yaml
xpack.security.authc.realms.cloud_iam.aliyun:
  order: 0
  role_mapping.enabled: true

# Example role mappings for users
role_mapping:
  aliyun_developers:
    roles:
      - developer
    rules:
      - field: cloud_arn
        value: "acs:ram::1437310945246567:user/*"

  aliyun_admins:
    roles:
      - admin
    rules:
      - field: cloud_arn
        value: "acs:ram::1437310945246567:role/admin-role"
```

## Configuration

### Elasticsearch

```yaml
xpack.security.authc.realms.cloud_iam.aliyun:
  order: 0
  # OAuth client configuration (optional)
  iam.endpoint: "https://oauth.aliyun.com/v1/userinfo"
  iam.timeout.connect: 1s
  iam.timeout.read: 2s
  # Caching
  cache.ttl: 5m
  cache.max_entries: 10000
```

### Kibana

No configuration changes required - automatically passes OAuth token to ES.

## Security Considerations

1. **Token Caching**: Validated tokens are cached to reduce API calls
2. **HTTPS Only**: OAuth tokens always transmitted over TLS
3. **Token Expiration**: Checked during validation
4. **Role Type Detection**: Properly distinguishes users from roles for permission mapping

## Testing

### Manual Testing

```bash
# 1. Get OAuth token from Aliyun
TOKEN=$(curl -s "https://oauth.aliyun.com/v1/token" -d "..." | jq -r .access_token)

# 2. Test with ES
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:9200/_security/_authenticate"

# 3. Verify role mappings work
curl -H "Authorization: Bearer $KIBANA_SESSION" \
  "http://localhost:9200/_cluster/health"
```

### Expected Results

- User authenticated with proper ARN
- Role mappings applied based on ARN
- Metadata includes: cloud_arn, cloud_account, cloud_principal_type, cloud_user_id

## Backward Compatibility

- Existing STS signature authentication continues to work
- Configuration unchanged for STS users
- Both authentication methods can coexist

## Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `OAuthTokenValidator.java` | NEW | OAuth token validator |
| `CloudIamToken.java` | MODIFIED | Added OAuth token support |
| `CloudIamRealm.java` | MODIFIED | Dual validator routing |
| `CloudIamSecurityExtension.java` | MODIFIED | Create both validators |
| `aliyun.ts` | MODIFIED | Pass token to ES instead of local auth |

## Next Steps

1. Deploy updated ES plugin with OAuth support
2. Configure role mappings for Aliyun users/roles
3. Test complete OAuth flow from login to ES queries
4. Monitor token validation performance and adjust caching
