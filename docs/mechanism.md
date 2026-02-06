# Kibana Aliyun OAuth 认证机制详解

## 目录
1. [核心机制：客户端 Session (Client-side Session)](#核心机制客户端-session-clientside-session)
2. [OAuth Token 生命周期](#oauth-token-生命周期)
3. [Session 创建与加密流程](#session-创建与加密流程)
4. [Session 验证与解密流程](#session-验证与解密流程)
5. [与 Basic Auth 的对比](#与-basic-auth-的对比)

---

## 核心机制：客户端 Session (Client-side Session)

默认情况下（`xpack.security.session.store.type: cookie`），Kibana 使用完全无状态的客户端 Session 机制。

### 存储流程（封包）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Session 存储流程                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. 认证成功后（ES 返回用户信息）                                             │
│     │                                                                       │
│     ▼                                                                       │
│  2. Kibana 调用 session.create(request, sessionValue)                        │
│     │                                                                       │
│     ├─ 生成随机 SID (Session ID, 256 bits)                                  │
│     ├─ 生成随机 AAD (Additional Authenticated Data, 256 bits)                │
│     ├─ 计算过期时间 (idleTimeout, lifespan)                                  │
│     │                                                                       │
│     ▼                                                                       │
│  3. 加密敏感内容:                                                            │
│     crypto.encrypt(JSON.stringify({                                         │
│       username,                                                             │
│       userProfileId,                                                        │
│       state: { authorization: oauthAccessToken }  ← OAuth Token 存在这里      │
│     }), aad)                                                                │
│     │                                                                       │
│     ▼                                                                       │
│  4. 存储到两个位置:                                                          │
│     ┌─────────────────────────────────────────────────────────────────┐     │
│     │ Browser Cookie (加密)          ES Session Index (部分加密)          │     │
│     │ ┌─────────────────────────┐    ┌─────────────────────────────┐      │     │
│     │ │ sid: "abc123..."        │───▶│ sid: "abc123..."            │      │     │
│     │ │ aad: "xyz789..."        │    │ usernameHash: sha3-256(...) │      │     │
│     │ │ idleTimeoutExpiration   │    │ content: ENCRYPTED({        │      │     │
│     │ │ lifespanExpiration      │    │   username,                 │      │     │
│     │ │ path: "/kibana"         │    │   userProfileId,            │      │     │
│     │ └─────────────────────────┘    │   state: {                  │      │     │
│     │                                │     authorization: token    │ ← 加密 │     │
│     │                                │   }                         │      │     │
│     │                                │ })                         │      │     │
│     │                                └─────────────────────────────┘      │     │
│     └─────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│  关键点: Kibana 服务端此时不保留任何状态！                                    │
│         所有必要信息都加密存储在浏览器 Cookie 中                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 使用流程（解包）—— 确实是"每次"

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  每次请求的 Session 验证流程                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  用户点击 Kibana 界面 → 浏览器发送请求带上 Cookie                             │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 第一层：Kibana 本地验证（不需要访问 ES）                                │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                      │    │
│  │  1. 读取 Cookie → 获取 sid, aad, expiration                         │    │
│  │                                                                      │    │
│  │  2. 解密与完整性校验 (Integrity Check)                                │    │
│  │     机制: AES-GCM 解密                                                │    │
│  │     作用: GCM 模式自带完整性校验 (MAC)                                │    │
│  │     结果: 如果篡改或 Key 错误 → 解密失败 → 强制登出                    │    │
│  │                                                                      │    │
│  │  3. 过期时间校验 (TTL Check)                                          │    │
│  │     机制: 对比 expiration 时间戳与当前时间                            │    │
│  │     结果: 如果过期 → 清理 Cookie → 重定向到登录页                      │    │
│  │                                                                      │    │
│  │  如果这一步失败，请求在 Kibana 层被拦截，根本不会发给 ES               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│         │                                                                   │
│         ▼ (本地验证通过)                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 第二层：使用 OAuth Token 访问 ES                                       │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                      │    │
│  │  1. 从解密后的 state 中获取 authorization: oauthAccessToken            │    │
│  │                                                                      │    │
│  │  2. 构造请求头: Authorization: Bearer {oauthAccessToken}              │    │
│  │                                                                      │    │
│  │  3. 向 ES 发起请求                                                    │    │
│  │                                                                      │    │
│  │  4. ES 使用 Cloud IAM Realm 验证 OAuth Token                          │    │
│  │     │                                                               │    │
│  │     ├─ 调用 Aliyun IAM API 验证 Token                                 │    │
│  │     ├─ 获取用户信息                                                   │    │
│  │     └─ 进行角色映射 (role mapping)                                    │    │
│  │                                                                      │    │
│  │  5. ES 返回 200 OK + 请求数据                                         │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│         │                                                                   │
│         ▼                                                                   │
│  请求结束后，内存中的 Token 随即丢弃（直到下一次请求）                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## OAuth Token 生命周期

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  OAuth Token 完整生命周期                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 阶段 1: OAuth 授权码获取 (Browser → Aliyun)                             │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                      │    │
│  │  1. 用户访问 Kibana → 重定向到 /api/security/aliyun/oauth/authorize   │    │
│  │  2. Kibana 生成 PKCE 参数:                                            │    │
│  │     • codeVerifier (随机 32 字节)                                     │    │
│  │     • codeChallenge = SHA256(codeVerifier)                           │    │
│  │     • state = verifierId (用于 CSRF 保护和查找 codeVerifier)          │    │
│  │  3. Kibana 将 codeVerifier 存储在内存 Map 中 (key=state)               │    │
│  │  4. 重定向用户到 Aliyun 授权页面:                                      │    │
│  │     https://signin.aliyun.com/oauth2/v1/auth?                         │    │
│  │       client_id=xxx&                                                   │    │
│  │       redirect_uri=xxx&                                                 │    │
│  │       response_type=code&                                               │    │
│  │       scope=openid+profile+aliuid&                                      │    │
│  │       state={state}&                                                    │    │
│  │       code_challenge={challenge}&                                       │    │
│  │       code_challenge_method=S256                                        │    │
│  │  5. 用户在 Aliyun 完成登录                                              │    │
│  │  6. Aliyun 重定向回 Kibana (带 authorization code)                      │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 阶段 2: OAuth Token 交换 (Kibana → Aliyun)                              │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                      │    │
│  │  位置: /api/security/aliyun/oauth/callback                            │    │
│  │  文件: aliyun_oauth.ts:176-193                                        │    │
│  │                                                                      │    │
│  │  1. Kibana 接收回调:                                                  │    │
│  │     • code: Aliyun 生成的授权码                                        │    │
│  │     • state: 可能缺失（某些 provider 不返回）                          │    │
│  │                                                                      │    │
│  │  2. Kibana 用 code 从内存中查找 codeVerifier:                         │    │
│  │     codeVerifier = codeVerifiers.get(state)                           │    │
│  │                                                                      │    │
│  │  3. Kibana 向 Aliyun Token 端点发送 POST 请求:                         │    │
│  │     POST https://oauth.aliyun.com/v1/token                           │    │
│  │     Content-Type: application/x-www-form-urlencoded                   │    │
│  │     body: {                                                            │    │
│  │       grant_type: "authorization_code",                               │    │
│  │       code: "{授权码}",                                                 │    │
│  │       client_id: "{appId}",                                            │    │
│  │       redirect_uri: "{callback URL}",                                  │    │
│  │       code_verifier: "{codeVerifier}"  ← PKCE 验证                     │    │
│  │     }                                                                  │    │
│  │                                                                      │    │
│  │  4. Aliyun 验证 code_challenge 和 code_verifier (SHA256 匹配)           │    │
│  │                                                                      │    │
│  │  5. Aliyun 返回 OAuth Access Token:                                    │    │
│  │     {                                                                  │    │
│  │       "access_token": "eyJhbGciOiJSUzI1NiIs...",  ← JWT 格式 Token     │    │
│  │       "token_type": "Bearer",                                          │    │
│  │       "expires_in": 3600                                               │    │
│  │     }                                                                  │    │
│  │                                                                      │    │
│  │  关键点: 此时 access_token 已生成，但尚未写入浏览器 Session！            │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 阶段 3: Token 验证 (Kibana → ES)                                       │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                      │    │
│  │  位置: AliyunAuthenticationProvider.login()                          │    │
│  │  文件: aliyun.ts:62-91                                               │    │
│  │                                                                      │    │
│  │  1. Provider 构造认证头:                                              │    │
│  │     authHeaders = {                                                   │    │
│  │       "authorization": `Bearer ${accessToken}`                        │    │
│  │     }                                                                  │    │
│  │                                                                      │    │
│  │  2. Provider 调用 getUser(request, authHeaders):                      │    │
│  │     │                                                               │    │
│  │     └─ 向 ES 发送请求:                                               │    │
│  │        GET /_security/_authenticate                                  │    │
│  │        Authorization: Bearer {aliyunOAuthAccessToken}                │    │
│  │                                                                      │    │
│  │  3. ES Cloud IAM Realm 接收请求:                                      │    │
│  │     │                                                               │    │
│  │     ├─ 调用 IamClient.verify(accessToken)                            │    │
│  │     │   │                                                            │    │
│  │     │   └─ 向 Aliyun 发送请求:                                        │    │
│  │     │      GET https://oauth.aliyun.com/v1/userinfo                 │    │
│  │     │      Authorization: Bearer {accessToken}                       │    │
│  │     │      ↓                                                          │    │
│  │     │   返回用户信息: {                                               │    │
│  │     │     "sub": "1234567890123456",                                  │    │
│  │     │     "name": "张三",                                               │    │
│  │     │     "email": "zhangsan@example.com"                            │    │
│  │     │   }                                                             │    │
│  │     │                                                                │    │
│  │     ├─ 根据 Aliyun UID 进行角色映射 (role mapping):                    │    │
│  │     │   │                                                            │    │
│  │     │   └─ 查找匹配的 role_mapping 规则                               │    │
│  │     │       ↓                                                        │    │
│  │     │      返回角色列表: ["superuser", "kibana_admin"]                │    │
│  │     │                                                                │    │
│  │     └─ 返回 Kibana 用户信息:                                          │    │
│  │        {                                                             │    │
│  │          "username": "1234567890123456",  ← 使用 Aliyun UID 作为用户名   │    │
│  │          "roles": ["superuser", "kibana_admin"],                      │    │
│  │          "full_name": "张三",                                           │    │
│  │          "email": "zhangsan@example.com"                             │    │
│  │        }                                                             │    │
│  │                                                                      │    │
│  │  4. ES 返回 HTTP 200 OK                                               │    │
│  │                                                                      │    │
│  │  5. Provider 接收到用户信息，返回 AuthenticationResult:                │    │
│  │     return AuthenticationResult.redirectTo(redirectURL, {             │    │
│  │       user,                                                            │    │
│  │       authHeaders,                                                     │    │
│  │       state: { authorization: accessToken }  ← OAuth Token 存在这里      │    │
│  │     })                                                                │    │
│  │                                                                      │    │
│  │  关键点: ES 验证成功 (200 OK) 后，OAuth Token 准备写入 Session           │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 阶段 4: Session 创建 (Token 写入浏览器)                                 │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                      │    │
│  │  位置: Authenticator.updateSessionValue()                            │    │
│  │  文件: authenticator.ts:734-908                                      │    │
│  │                                                                      │    │
│  │  1. Authenticator 收到 AuthenticationResult.redirectTo()              │    │
│  │     │                                                               │    │
│  │     └─ 调用 updateSessionValue(request, {                             │    │
│  │         provider,                                                      │    │
│  │         authenticationResult,                                          │    │
│  │         existingSessionValue                                           │    │
│  │       })                                                              │    │
│  │                                                                      │    │
│  │  2. updateSessionValue() 检测到需要创建新 Session:                    │    │
│  │     │                                                               │    │
│  │     ├─ existingSessionValue === null (没有现有 Session)                │    │
│  │     ├─ authenticationResult.redirected() === true                     │    │
│  │     └─ authenticationResult.shouldUpdateState() === true              │    │
│  │                                                                      │    │
│  │  3. 调用 session.create(request, sessionValue):                      │    │
│  │     │                                                               │    │
│  │     └─ 见下面的 "Session 创建详细流程"                                  │    │
│  │                                                                      │    │
│  │  4. session.create() 返回 SessionValue:                               │    │
│  │     {                                                               │    │
│  │       sid: "abc123...",                                               │    │
│  │       username: "1234567890123456",                                   │    │
│  │       provider: { type: "aliyun", name: "aliyun" },                   │    │
│  │       state: { authorization: oauthAccessToken },  ← Token 在这里！     │    │
│  │       idleTimeoutExpiration: 1234567890,                              │    │
│  │       lifespanExpiration: 1234567890,                                 │    │
│  │       metadata: { ... }                                               │    │
│  │     }                                                                │    │
│  │                                                                      │    │
│  │  关键点: Token 在 ES 验证成功并返回 200 OK 后，才写入 Session！            │    │
│  │          如果 ES 返回 401/403，Session 不会被创建                         │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 阶段 5: Cookie 写入浏览器 (Hapi 自动处理)                               │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                      │    │
│  │  位置: SessionCookie.set()                                           │    │
│  │  文件: session_cookie.ts:129-133                                     │    │
│  │                                                                      │    │
│  │  1. session.create() 调用 sessionCookie.set():                        │    │
│  │     │                                                               │    │
│  │     └─ (await cookieSessionValueStorage).asScoped(request).set({      │    │
│  │         sid,                                                           │    │
│  │         aad,                                                           │    │
│  │         idleTimeoutExpiration,                                         │    │
│  │         lifespanExpiration,                                            │    │
│  │         path: serverBasePath                                           │    │
│  │       })                                                              │    │
│  │                                                                      │    │
│  │  2. Hapi 内部将 Session Value 序列化并加密:                             │    │
│  │     │                                                               │    │
│  │     └─ 使用 @kbn/core cookie session storage                          │    │
│  │        │                                                            │    │
│  │        └─ 调用 Hapi 的 state.cookie.set()                             │    │
│  │           │                                                        │    │
│  │           └─ Hapi 生成 Set-Cookie header:                            │    │
│  │              Set-Cookie: sid=encrypted_value; Path=/kibana;          │    │
│  │                       HttpOnly; Secure; SameSite=Lax                 │    │
│  │                                                                      │    │
│  │  3. Callback Handler 返回 response.redirected():                      │    │
│  │     │                                                               │    │
│  │     └─ HTTP 302 Redirect                                              │    │
│  │        Location: {redirectURL}                                        │    │
│  │        ↓                                                              │    │
│  │     浏览器接收响应                                                    │    │
│  │        │                                                            │    │
│  │        ├─ 保存 Set-Cookie header 到本地 Cookie 存储                    │    │
│  │        └─ 跟随 Location header 进行重定向                              │    │
│  │                                                                      │    │
│  │  关键点: Cookie 通过 HTTP 302 响应的 Set-Cookie header 写入浏览器！        │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 关键时序总结

| 时刻 | 事件 | Token 位置 |
|------|------|-----------|
| T1 | 用户访问 Kibana | 无 |
| T2 | 重定向到 Aliyun | 无 |
| T3 | 用户登录完成 | 无 |
| T4 | Aliyun 返回 code | Aliyun 服务器 |
| T5 | Kibana 交换 code → access_token | Kibana 内存 |
| T6 | **ES 验证 token (200 OK)** | Kibana 内存 → **Session.state** |
| T7 | Session.create() 加密并存储 | **加密写入 Cookie** |
| T8 | HTTP 302 + Set-Cookie | 浏览器 Cookie |
| T9+ | 后续请求使用 Token | 浏览器 → Kibana → ES |

**重要**: Token 在 ES 验证成功并返回 200 OK 后（T6），才写入 Session。如果 ES 验证失败，整个流程中止，不会创建 Session。

---

## Session 创建与加密流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Session 创建详细流程 (session.create())                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  入口: session.ts:240-280                                                    │
│                                                                             │
│  1. 生成唯一标识符                                                            │
│     ├─ SID (Session ID): crypto.randomBytes(32).toString('base64')           │
│     └─ AAD (Additional Authenticated Data): crypto.randomBytes(32)...       │
│                                                                             │
│  2. 计算过期时间                                                              │
│     ├─ idleTimeout: now + config.session.idleTimeout                       │
│     └─ lifespan: now + config.session.lifespan                            │
│                                                                             │
│  3. 准备要加密的内容                                                          │
│     const contentToEncrypt = {                                              │
│       username: "1234567890123456",                                          │
│       userProfileId: undefined,                                              │
│       state: {                                                              │
│         authorization: "eyJhbGciOiJSUzI1NiIs..."  ← OAuth Access Token      │
│       }                                                                     │
│     }                                                                       │
│                                                                             │
│  4. 加密敏感内容:                                                            │
│     encrypted = crypto.encrypt(                                            │
│       JSON.stringify(contentToEncrypt),  ← { username, state }             │
│       aad  ← 作为加密的额外认证数据                                          │
│     )                                                                       │
│                                                                             │
│     算法: AES-GCM (通过 @elastic/node-crypto)                               │
│     密钥: xpack.security.encryptionKey                                      │
│                                                                             │
│  5. 存储到 ES Session Index:                                                 │
│     await sessionIndex.create({                                             │
│       sid: "abc123...",                                                      │
│       usernameHash: sha3-256("1234567890123456"),                           │
│       idleTimeoutExpiration: 1234567890,                                     │
│       lifespanExpiration: 1234567890,                                       │
│       content: encrypted,  ← 加密后的 { username, state }                   │
│       provider: { type: "aliyun", name: "aliyun" },                         │
│       createdAt: 1234567890                                                  │
│     })                                                                      │
│                                                                             │
│  6. 写入浏览器 Cookie:                                                       │
│     await sessionCookie.set(request, {                                      │
│       sid: "abc123...",                                                      │
│       aad: "xyz789...",                                                      │
│       idleTimeoutExpiration: 1234567890,                                     │
│       lifespanExpiration: 1234567890                                        │
│     })                                                                      │
│                                                                             │
│     Hapi 自动将 Cookie 序列化、加密并添加 Set-Cookie header                   │
│                                                                             │
│  7. 返回 SessionValue:                                                       │
│     return {                                                                │
│       sid: "abc123...",                                                      │
│       username: "1234567890123456",                                          │
│       provider: { type: "aliyun", name: "aliyun" },                          │
│       state: { authorization: "eyJhbGciOiJSUzI1NiIs..." },                  │
│       idleTimeoutExpiration: 1234567890,                                     │
│       lifespanExpiration: 1234567890,                                       │
│       metadata: { index: { ... } }                                           │
│     }                                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Cookie 加密细节

Hapi 的 Cookie Session Storage 使用相同的加密密钥 (`xpack.security.encryptionKey`):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Cookie 加密结构                                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  浏览器收到的 Cookie 值:                                                      │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │ base64url(encrypted_cookie_value)                                  │     │
│  │                                                                     │     │
│  │ encrypted_cookie_value = AES-GCM-Encrypt(                          │     │
│  │   plaintext: {                                                       │     │
│  │     sid: "abc123...",                                               │     │
│  │     aad: "xyz789...",                                               │     │
│  │     idleTimeoutExpiration: 1234567890,                              │     │
│  │     lifespanExpiration: 1234567890,                                 │     │
│  │     path: "/kibana"                                                 │     │
│  │   },                                                                 │     │
│  │   key: xpack.security.encryptionKey,                                │     │
│  │   nonce: random_12_bytes,                                           │     │
│  │   aad: null                                                          │     │
│  │ )                                                                    │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│  Set-Cookie header:                                                          │
│  Set-Cookie: sid=base64url(encrypted_value);                                │
│            Path=/kibana;                                                     │
│            HttpOnly;                                                         │
│            Secure;                                                           │
│            SameSite=Lax                                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Session 验证与解密流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Session 验证详细流程 (每次请求)                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  入口: authenticator.authenticate() → session.get()                          │
│                                                                             │
│  1. 从请求中读取 Cookie:                                                      │
│     sessionCookieValue = await sessionCookie.get(request)                   │
│     │                                                                       │
│     └─ Hapi 自动解密 Cookie:                                                │
│        AES-GCM-Decrypt(                                                    │
│          ciphertext: cookie_value,                                         │
│          key: xpack.security.encryptionKey                                  │
│        ) → { sid, aad, idleTimeoutExpiration, lifespanExpiration, path }    │
│                                                                             │
│     如果解密失败 → 抛出异常 → 返回 SessionUnexpectedError                     │
│                                                                             │
│  2. 第一层本地验证 (Kibana 层，不访问 ES):                                     │
│                                                                             │
│     ├─ 完整性校验: AES-GCM 自动验证 MAC                                      │
│     │  如果被篡改 → 解密失败 → SessionUnexpectedError                         │
│     │                                                                       │
│     ├─ 过期时间校验:                                                         │
│     │  if (idleTimeoutExpiration < now) → SessionExpiredError               │
│     │  if (lifespanExpiration < now) → SessionExpiredError                  │
│     │                                                                       │
│     └─ 如果验证失败 → 清除 Cookie → 重定向到登录页                            │
│                                                                             │
│  3. 从 ES Session Index 读取加密内容:                                         │
│     sessionIndexValue = await sessionIndex.get(sid)                         │
│     │                                                                       │
│     └─ 返回: {                                                             │
│          sid, usernameHash, content, provider, ...                          │
│        }                                                                  │
│                                                                             │
│     如果找不到 → SessionUnexpectedError                                     │
│                                                                             │
│  4. 解密敏感内容 (使用 AAD):                                                  │
│     decrypted = crypto.decrypt(                                            │
│       sessionIndexValue.content,  ← 加密的 { username, state }              │
│       sessionCookieValue.aad       ← 来自 Cookie 的 AAD                     │
│     )                                                                       │
│     │                                                                       │
│     └─ 返回: {                                                             │
│          username: "1234567890123456",                                      │
│          userProfileId: undefined,                                           │
│          state: {                                                          │
│            authorization: "eyJhbGciOiJSUzI1NiIs..."  ← OAuth Token          │
│          }                                                                 │
│        }                                                                  │
│                                                                             │
│     如果解密失败 → SessionUnexpectedError                                   │
│                                                                             │
│  5. 并发 Session 限制检查:                                                   │
│     isWithinLimit = await sessionIndex.isWithinConcurrentSessionLimit()     │
│     │                                                                       │
│     └─ 如果超过限制 → SessionConcurrencyLimitError                          │
│                                                                             │
│  6. 返回完整 SessionValue:                                                   │
│     return {                                                                │
│       sid: "abc123...",                                                      │
│       username: "1234567890123456",                                          │
│       provider: { type: "aliyun", name: "aliyun" },                          │
│       state: { authorization: "eyJhbGciOiJSUzI1NiIs..." },                  │
│       idleTimeoutExpiration: 1234567890,                                     │
│       lifespanExpiration: 1234567890,                                       │
│       metadata: { ... }                                                      │
│     }                                                                       │
│                                                                             │
│  7. Provider 使用 state 中的 Token 访问 ES:                                   │
│     await provider.authenticate(request, state)                             │
│     │                                                                       │
│     └─ 构造请求头: Authorization: Bearer {state.authorization}              │
│        │                                                                  │
│        └─ 向 ES 发起请求 → ES Cloud IAM Realm 验证 → 返回数据                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 与 Basic Auth 的对比

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Basic Auth vs Aliyun OAuth                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Basic Auth 流程                                                         │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                      │    │
│  │  1. 用户输入用户名密码                                                   │    │
│  │  2. Kibana 调用 ES 的 /_security/_authenticate                          │    │
│  │  3. ES 验证用户名密码 (从 native realm 或其他 realm)                     │    │
│  │  4. ES 生成 Access Token 和 Refresh Token                               │    │
│  │  5. ES 返回用户信息 + Token                                             │    │
│  │  6. Kibana 将 ES Token 存入 Session.state:                              │    │
│  │     state: {                                                          │    │
│  │       accessToken: "EsGeneratedToken...",                             │    │
│  │       refreshToken: "EsRefreshToken..."                               │    │
│  │     }                                                                 │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Aliyun OAuth 流程                                                       │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                      │    │
│  │  1. 用户在 Aliyun 完成登录                                               │    │
│  │  2. Aliyun 返回 OAuth Access Token                                      │    │
│  │  3. Kibana 调用 ES 的 /_security/_authenticate (带 OAuth Token)         │    │
│  │  4. ES Cloud IAM Realm 验证 OAuth Token:                                │    │
│  │     │ 调用 Aliyun API 验证 Token                                         │    │
│  │     │ 获取用户信息                                                       │    │
│  │     │ 进行角色映射                                                       │    │
│  │  5. ES 返回用户信息 (不生成新 Token！)                                    │    │
│  │  6. Kibana 将 Aliyun OAuth Token 存入 Session.state:                    │    │
│  │     state: {                                                          │    │
│  │       authorization: "AliyunOAuthToken..."  ← 注意字段名不同              │    │
│  │     }                                                                 │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  关键区别:                                                                    │
│  ┌──────────────────┬─────────────────────┬─────────────────────┐            │
│  │     特性         │    Basic Auth       │   Aliyun OAuth       │            │
│  ├──────────────────┼─────────────────────┼─────────────────────┤            │
│  │ Token 来源        │ ES 生成              │ Aliyun 生成           │            │
│  │ Token 存储        │ state.accessToken   │ state.authorization  │            │
│  │ ES 返回 Token     │ 是                   │ 否                   │            │
│  │ Session 加密      │ 相同                 │ 相同                 │            │
│  │ 验证流程          │ 相同                 │ 相同                 │            │
│  └──────────────────┴─────────────────────┴─────────────────────┘            │
│                                                                             │
│  Session 加密机制完全相同:                                                    │
│  • 使用相同的 xpack.security.encryptionKey                                   │
│  • 使用相同的 AES-GCM 算法                                                   │
│  • 使用相同的两阶段验证 (本地 + ES)                                           │
│  • 唯一区别是 state 字段中存储的 Token 来源不同                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Session Value 结构对比

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Session Value 内部结构对比                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Basic Auth Session Value:                                                  │
│  {                                                                          │
│    sid: "...",                                                              │
│    username: "elastic",                                                     │
│    provider: { type: "basic", name: "basic" },                              │
│    state: {                                                                 │
│      accessToken: "EsGeneratedToken...",      ← ES 生成的 Token              │
│      refreshToken: "EsRefreshToken..."                                      │
│    },                                                                       │
│    idleTimeoutExpiration: 1234567890,                                       │
│    lifespanExpiration: 1234567890                                           │
│  }                                                                          │
│                                                                             │
│  Aliyun OAuth Session Value:                                                │
│  {                                                                          │
│    sid: "...",                                                              │
│    username: "1234567890123456",  ← Aliyun UID                               │
│    provider: { type: "aliyun", name: "aliyun" },                            │
│    state: {                                                                 │
│      authorization: "eyJhbGciOiJSUzI1NiIs..."  ← Aliyun OAuth Token           │
│    },                                                                       │
│    idleTimeoutExpiration: 1234567890,                                       │
│    lifespanExpiration: 1234567890                                           │
│  }                                                                          │
│                                                                             │
│  加密存储方式完全相同:                                                         │
│  • Cookie 中存储: { sid, aad, expiration, path }                            │
│  • ES Index 中存储: { sid, usernameHash, content: ENCRYPTED({state}) }       │
│  • 使用相同的 encryptionKey 和 AES-GCM 算法                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 关键代码位置索引

| 功能 | 文件 | 行号 | 说明 |
|------|------|------|------|
| OAuth 授权码获取 | `aliyun_oauth.ts` | 47-119 | `/api/security/aliyun/oauth/authorize` |
| OAuth Token 交换 | `aliyun_oauth.ts` | 176-193 | 用 code 换取 access_token |
| ES Token 验证 | `aliyun.ts` | 62-91 | `provider.login()` 验证 OAuth Token |
| Session 创建 | `authenticator.ts` | 862 | `session.create()` 调用 |
| Session 加密 | `session.ts` | 240-280 | 加密并存储 Session |
| Cookie 写入 | `session_cookie.ts` | 129-133 | Hapi Cookie 设置 |
| Session 验证 | `session.ts` | 165-233 | 每次请求解密并验证 |
| Provider 认证 | `aliyun.ts` | 123-158 | 使用 Session 中的 Token 访问 ES |

---

## 常见问题

### Q1: OAuth Token 什么时候写入浏览器？
**A**: 在 ES 验证成功并返回 HTTP 200 OK 之后。具体流程:
1. Kibana 从 Aliyun 获取 OAuth Access Token
2. Kibana 用 OAuth Token 向 ES 验证
3. ES 返回 200 OK + 用户信息
4. Kibana 调用 `session.create()` 将 OAuth Token 加密存储
5. 通过 Set-Cookie header 写入浏览器

### Q2: 如果 ES 验证失败会怎样？
**A**: 整个流程中止，不会创建 Session:
1. `provider.login()` 抛出异常或返回 `AuthenticationResult.failed()`
2. `updateSessionValue()` 检测到失败，不调用 `session.create()`
3. 不会写入 Cookie
4. 用户被重定向回登录页

### Q3: Session 加密和 Basic Auth 一样吗？
**A**: 完全相同:
• 使用相同的 `xpack.security.encryptionKey`
• 使用相同的 AES-GCM 算法
• 使用相同的两阶段验证 (本地完整性 + 过期检查 + ES 验证)
• 唯一区别是 `state` 字段中存储的 Token 来源不同

### Q4: 为什么需要 ES Session Index？
**A**:
• Cookie 中只存储元数据 (sid, aad, expiration)
• 敏感内容 (username, state) 加密存储在 ES 中
• 提供集中式 Session 管理 (并发限制、撤销等)
• 支持多实例部署 (所有 Kibana 节点共享 ES Session Index)

### Q5: AAD (Additional Authenticated Data) 的作用？
**A**:
• 作为 AES-GCM 加密的额外认证参数
• 用于关联 Cookie 和 ES Index 中的加密内容
• 解密时必须提供相同的 AAD，否则解密失败
• 防止攻击者将一个 Session 的 content 复制到另一个 Session

---

*文档版本: 1.0*
*最后更新: 2025-01-30*
*Kibana 版本: 9.2.4*
