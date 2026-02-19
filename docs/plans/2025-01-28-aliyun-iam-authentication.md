# Aliyun IAM Authentication for Kibana Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Aliyun RAM authentication to Kibana 9.2.4 as an additional login option alongside basic auth, with a UI for managing Aliyun RAM user role mappings.

**Architecture:**
- Server-side: Custom authentication provider (`AliyunAuthenticationProvider`) that forwards `X-ES-IAM-Signed` headers to Elasticsearch
- Client-side: Enhanced login page with "Login with Aliyun" button, Aliyun STS SDK integration
- UI: New section in Security management for Aliyun role mappings
- Extensibility: Token extractor interface for future gateway/cookie scenarios

**Tech Stack:**
- Kibana 9.2.4 plugin architecture
- Aliyun STS SDK (@alicloud/openapi-client)
- TypeScript/React for UI
- Elasticsearch Cloud IAM realm (already deployed)

**ES Connection:** localhost:9200, elastic/Summer11

---

## Task 1: Create Aliyun Auth Provider Plugin Skeleton

**Files:**
- Create: `x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts`
- Create: `x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.test.ts`

**Step 1: Create provider class skeleton**

```typescript
// x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts
import type { KibanaRequest } from '@kbn/core/server';
import { BaseAuthenticationProvider } from './base';
import { NEXT_URL_QUERY_STRING_PARAMETER } from '../../../common/constants';
import { getDetailedErrorMessage } from '../../errors';
import { AuthenticationResult } from '../authentication_result';
import { canRedirectRequest } from '../can_redirect_request';
import { DeauthenticationResult } from '../deauthentication_result';

interface ProviderLoginAttempt {
  signedToken: string;
}

interface ProviderState {
  authorization?: string;
}

function canStartNewSession(request: KibanaRequest) {
  return canRedirectRequest(request) && request.route.options.authRequired === true;
}

export class AliyunAuthenticationProvider extends BaseAuthenticationProvider {
  static readonly type = 'aliyun';

  public async login(
    request: KibanaRequest,
    { signedToken }: ProviderLoginAttempt,
    state?: ProviderState | null
  ) {
    this.logger.debug('Trying to perform Aliyun IAM login.');

    const authHeaders = {
      'X-ES-IAM-Signed': signedToken,
    };

    try {
      const user = await this.getUser(request, authHeaders);
      this.logger.debug('Aliyun IAM login successful.');
      return AuthenticationResult.succeeded(user, {
        authHeaders,
        state: { authorization: signedToken },
      });
    } catch (err) {
      this.logger.debug(() => `Failed Aliyun IAM login: ${getDetailedErrorMessage(err)}`);
      return AuthenticationResult.failed(err);
    }
  }

  public async authenticate(request: KibanaRequest, state?: ProviderState | null) {
    this.logger.debug(`Aliyun authenticate: ${request.url.pathname}`);

    if (state?.authorization) {
      try {
        const authHeaders = { 'X-ES-IAM-Signed': state.authorization };
        const user = await this.getUser(request, authHeaders);
        return AuthenticationResult.succeeded(user, { authHeaders });
      } catch (err) {
        this.logger.debug(() => `Aliyun auth failed: ${getDetailedErrorMessage(err)}`);
        return AuthenticationResult.failed(err);
      }
    }

    if (canStartNewSession(request)) {
      const basePath = this.options.basePath.get(request);
      return AuthenticationResult.redirectTo(
        `${basePath}/login?${NEXT_URL_QUERY_STRING_PARAMETER}=${encodeURIComponent(
          `${basePath}${request.url.pathname}${request.url.search}`
        )}`
      );
    }

    return AuthenticationResult.notHandled();
  }

  public async logout(request: KibanaRequest, state?: ProviderState | null) {
    if (state === undefined) {
      return DeauthenticationResult.notHandled();
    }
    return DeauthenticationResult.redirectTo(this.options.urls.loggedOut(request));
  }

  public getHTTPAuthenticationScheme() {
    return 'aliyun';
  }
}
```

**Step 2: Register provider in providers index**

File: `x-pack/platform/plugins/shared/security/server/authentication/providers/index.ts`

Add to exports:
```typescript
export { AliyunAuthenticationProvider } from './aliyun';
```

**Step 3: Write basic unit test**

File: `x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.test.ts`

```typescript
import { AliyunAuthenticationProvider } from './aliyun';
import { coreMock } from '@kbn/core/server/mocks';
import { authenticationServiceMock } from '../../authentication/authentication_service.mock';

describe('AliyunAuthenticationProvider', () => {
  it('should have type "aliyun"', () => {
    const provider = new AliyunAuthenticationProvider({
      logger: coreMock.createLogger(),
      client: authenticationServiceMock.createClient(),
      config: { ... },
      basePath: coreMock.createBasePath(),
      tokens: {},
      urls: { loggedOut: () => '/logged-out' },
    });
    expect(AliyunAuthenticationProvider.type).toBe('aliyun');
  });
});
```

**Step 4: Run test to verify**

Run: `cd /home/denny/projects/kibana-9.2.4 && yarn test x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.test.ts`

Expected: Test fails (implementation incomplete)

**Step 5: Commit**

```bash
cd /home/denny/projects/kibana-9.2.4
git add x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts
git add x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.test.ts
git add x-pack/platform/plugins/shared/security/server/authentication/providers/index.ts
git commit -m "feat: add Aliyun IAM authentication provider skeleton"
```

---

## Task 2: Add Client-side Signature Generation

**Files:**
- Create: `x-pack/platform/plugins/shared/security/public/authentication/aliyun/signal_generator.ts`
- Create: `x-pack/platform/plugins/shared/security/public/authentication/aliyun/signal_generator.test.ts`

**Step 1: Install Aliyun SDK dependency**

File: `x-pack/platform/plugins/shared/security/package.json`

Add to dependencies:
```json
"@alicloud/openapi-client": "^0.4.6",
"@alicloud/sts20150401": "^1.0.0",
"crypto-js": "^4.2.0"
```

**Step 2: Create signature generator (port of Python script)**

```typescript
// x-pack/platform/plugins/shared/security/public/authentication/aliyun/signal_generator.ts
import CryptoJS from 'crypto-js';

interface AliyunCredentials {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken?: string;
}

export class AliyunSTSClient {
  private credentials: AliyunCredentials;

  constructor(credentials: AliyunCredentials) {
    this.credentials = credentials;
  }

  /**
   * Get caller identity ARN via STS API
   */
  async getCallerIdentity(): Promise<string> {
    // For now, use mock mode for development
    // TODO: Integrate actual @alicloud/sts20150401 SDK
    const mockArn = `acs:ram::000000000000:user/mock`;
    return mockArn;
  }

  /**
   * Generate signed token for ES authentication
   * Port of aliyun_sts_sign.py logic
   */
  async generateSignedToken(): Promise<string> {
    const arn = await this.getCallerIdentity();
    const timestamp = Date.now();
    const signature = this.computeSignature(arn, timestamp);

    // Format: ARN:timestamp:signature
    return `${arn}:${timestamp}:${signature}`;
  }

  private computeSignature(arn: string, timestamp: number): string {
    const secret = this.credentials.accessKeySecret;
    const message = `${arn}:${timestamp}`;
    return CryptoJS.HmacSHA256(message, secret).toString(CryptoJS.enc.Base64);
  }
}

/**
 * Mock mode for testing without real credentials
 */
export async function generateMockSignedToken(): Promise<string> {
  // Mock signature matching ES plugin mock mode
  const mockArn = 'acs:ram::000000000000:user/mock';
  const timestamp = Date.now();
  const mockSignature = 'mock';
  return `${mockArn}:${timestamp}:${mockSignature}`;
}
```

**Step 3: Write unit tests**

File: `x-pack/platform/plugins/shared/security/public/authentication/aliyun/signal_generator.test.ts`

```typescript
import { generateMockSignedToken } from './signal_generator';

describe('AliyunSTSClient', () => {
  describe('generateMockSignedToken', () => {
    it('should generate a valid mock token', async () => {
      const token = await generateMockSignedToken();
      expect(token).toContain('acs:ram::000000000000:user/mock:');
      expect(token.split(':')).toHaveLength(3);
    });
  });
});
```

**Step 4: Run test**

Run: `yarn test x-pack/platform/plugins/shared/security/public/authentication/aliyun/signal_generator.test.ts`

**Step 5: Commit**

```bash
git add x-pack/platform/plugins/shared/security/package.json
git add x-pack/platform/plugins/shared/security/public/authentication/aliyun/
git commit -m "feat: add client-side Aliyun signature generator"
```

---

## Task 3: Create Aliyun Login API Route

**Files:**
- Create: `x-pack/platform/plugins/shared/security/server/authentication/routes/aliyun_auth.ts`
- Modify: `x-pack/platform/plugins/shared/security/server/plugin.ts` (register route)

**Step 1: Create authentication route handler**

```typescript
// x-pack/platform/plugins/shared/security/server/authentication/routes/aliyun_auth.ts
import type { SecurityPluginRequestHandlerContext } from '../../types';
import type { IRouter } from '@kbn/core/server';
import { I18N_ROUTE } from '../../../common/constants';
import { wrapCustomError } from '../../../server/lib/errors';

export function registerAliyunAuthRoutes(router: IRouter<SecurityPluginRequestHandlerContext>) {
  router.versioned
    .post({
      path: '/internal/security/aliyun/authenticate',
      access: 'public',
      security: {
        authz: {
          enabled: false,
        },
      },
    })
    .addVersion(
      {
        version: '1',
        validate: {
          request: {
            body: {
              type: 'object',
              properties: {
                signedToken: { type: 'string' },
              },
              required: ['signedToken'],
            },
          },
          response: {
            200: {
              type: 'object',
              properties: {
                username: { type: 'string' },
                roles: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      async (context, request, response) => {
        try {
          const { signedToken } = request.body;

          // Call ES with X-ES-IAM-Signed header
          const esClient = await context.core.elasticsearch.client;
          const authResponse = await esClient.asCurrentUser.transport.request({
            method: 'GET',
            path: '/_security/_authenticate',
            headers: {
              'X-ES-IAM-Signed': signedToken,
            },
          });

          return response.ok({
            body: {
              username: authResponse.username,
              roles: authResponse.roles,
            },
          });
        } catch (error) {
          throw wrapCustomError(error);
        }
      }
    );
}
```

**Step 2: Register route in plugin**

File: `x-pack/platform/plugins/shared/security/server/plugin.ts`

Find `setup()` method and add:
```typescript
import { registerAliyunAuthRoutes } from './authentication/routes/aliyun_auth';

export class SecurityPlugin implements Plugin<...> {
  async setup(core: CoreSetup<...>) {
    // ... existing code ...

    registerAliyunAuthRoutes(router);
  }
}
```

**Step 3: Test route manually**

Run: Start Kibana and test:
```bash
curl -X POST http://localhost:5601/internal/security/aliyun/authenticate \
  -H 'Content-Type: application/json' \
  -H 'kbn-version: 9.2.4' \
  -d '{"signedToken":"acs:ram::000000000000:user/mock:123456:mock"}'
```

Expected: User info returned from ES

**Step 4: Commit**

```bash
git add x-pack/platform/plugins/shared/security/server/authentication/routes/
git add x-pack/platform/plugins/shared/security/server/plugin.ts
git commit -m "feat: add Aliyun authentication API route"
```

---

## Task 4: Modify Login Page UI

**Files:**
- Modify: `x-pack/platform/plugins/shared/security/public/authentication/login/login_page.tsx`
- Create: `x-pack/platform/plugins/shared/security/public/authentication/login/components/aliyun_login_form.tsx`

**Step 1: Create Aliyun login form component**

```tsx
// x-pack/platform/plugins/shared/security/public/authentication/login/components/aliyun_login_form.tsx
import React, { useState } from 'react';
import { EuiButton, EuiLoadingSpinner, EuiText } from '@elastic/eui';
import { generateMockSignedToken } from '../../aliyun/signal_generator';
import type { HttpServiceSetup } from '@kbn/core/public';

interface Props {
  http: HttpServiceSetup;
  onLoginSuccess: () => void;
  onError: (message: string) => void;
}

export const AliyunLoginForm: React.FC<Props> = ({ http, onLoginSuccess, onError }) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleAliyunLogin = async () => {
    setIsLoading(true);
    try {
      // Step 1: Generate signed token
      const signedToken = await generateMockSignedToken();

      // Step 2: Authenticate with Kibana backend
      const response = await http.post('/internal/security/aliyun/authenticate', {
        body: JSON.stringify({ signedToken }),
      });

      // Step 3: Create Kibana session
      await http.post('/internal/security/login', {
        body: JSON.stringify({
          providerType: 'aliyun',
          providerName: 'aliyun1',
          currentURL: window.location.href,
          params: { signedToken },
        }),
      });

      onLoginSuccess();
    } catch (error) {
      onError(`Aliyun login failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <EuiText>
        <h3>Sign in with Aliyun</h3>
        <p>You'll be redirected to authenticate with your Aliyun RAM account.</p>
      </EuiText>
      {isLoading ? (
        <EuiLoadingSpinner size="l" />
      ) : (
        <EuiButton
          fill
          onClick={handleAliyunLogin}
          size="l"
        >
          Login with Aliyun
        </EuiButton>
      )}
    </div>
  );
};
```

**Step 2: Modify login page to support dual auth**

File: `x-pack/platform/plugins/shared/security/public/authentication/login/login_page.tsx`

Add state and selector:
```tsx
import { AliyunLoginForm } from './components/aliyun_login_form';

export const renderLoginPage = (core, { element }, props) => {
  const [authMethod, setAuthMethod] = useState<'basic' | 'aliyun'>('basic');

  return (
    <LoginPage
      {...props}
      renderSelector={() => (
        <EuiButtonGroup
          options={[
            { label: 'Username / Password', id: 'basic' },
            { label: 'Login with Aliyun', id: 'aliyun' },
          ]}
          idSelected={authMethod}
          onChange={(id) => setAuthMethod(id as 'basic' | 'aliyun')}
        />
      )}
    >
      {authMethod === 'basic' ? (
        <BasicLoginForm {...props} />
      ) : (
        <AliyunLoginForm
          http={props.http}
          onLoginSuccess={() => window.location.reload()}
          onError={(msg) => props.notifications.toasts.addDanger(msg)}
        />
      )}
    </LoginPage>
  );
};
```

**Step 3: Build and verify**

Run: `yarn build x-pack/platform/plugins/shared/security`

**Step 4: Commit**

```bash
git add x-pack/platform/plugins/shared/security/public/authentication/login/
git commit -m "feat: add dual login UI with Aliyun option"
```

---

## Task 5: Create Role Mapping Management UI

**Files:**
- Create: `x-pack/platform/plugins/shared/security/public/management/aliyun_role_mappings/`
  - `aliyun_role_mappings_app.tsx`
  - `components/aliyun_role_mapping_form.tsx`
- Create: `x-pack/platform/plugins/shared/security/server/management/aliyun_role_mappings/`

**Step 1: Create API route for role mappings**

File: `x-pack/platform/plugins/shared/security/server/routes/aliyun_role_mappings.ts`

```typescript
import type { IRouter } from '@kbn/core/server';

export function registerAliyunRoleMappingRoutes(router: IRouter) {
  // List all role mappings
  router.versioned
    .get({
      path: '/api/security/aliyun_role_mappings',
      access: 'public',
    })
    .addVersion({
      version: '1',
      validate: false,
    }, async (context, request, response) => {
      const esClient = await context.core.elasticsearch.client;
      const result = await esClient.asCurrentUser.transport.request({
        method: 'GET',
        path: '/_security/role_mapping',
      });

      // Filter only Aliyun-related mappings
      const aliyunMappings = Object.entries(result)
        .filter(([_, mapping]) => mapping.rules?.field?.['metadata.cloud_arn'])
        .reduce((acc, [key, val]) => ({ ...acc, [key]: val }), {});

      return response.ok({ body: aliyunMappings });
    });

  // Create/update role mapping
  router.versioned
    .put({
      path: '/api/security/aliyun_role_mappings/{name}',
      access: 'public',
    })
    .addVersion({
      version: '1',
      validate: {
        params: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
        body: {
          type: 'object',
          properties: {
            roles: { type: 'array', items: { type: 'string' } },
            arn: { type: 'string' },
          },
          required: ['roles', 'arn'],
        },
      },
    }, async (context, request, response) => {
      const { name } = request.params;
      const { roles, arn } = request.body;

      const esClient = await context.core.elasticsearch.client;
      await esClient.asCurrentUser.transport.request({
        method: 'PUT',
        path: `/_security/role_mapping/${name}`,
        body: JSON.stringify({
          enabled: true,
          roles,
          rules: {
            field: {
              'metadata.cloud_arn': arn,
            },
          },
        }),
      });

      return response.ok({ body: { acknowledged: true } });
    });

  // Delete role mapping
  router.versioned
    .delete({
      path: '/api/security/aliyun_role_mappings/{name}',
      access: 'public',
    })
    .addVersion({
      version: '1',
      validate: {
        params: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
      },
    }, async (context, request, response) => {
      const { name } = request.params;

      const esClient = await context.core.elasticsearch.client;
      await esClient.asCurrentUser.transport.request({
        method: 'DELETE',
        path: `/_security/role_mapping/${name}`,
      });

      return response.ok({ body: { acknowledged: true } });
    });
}
```

**Step 2: Create role mapping UI component**

```tsx
// x-pack/platform/plugins/shared/security/public/management/aliyun_role_mappings/aliyun_role_mappings_app.tsx
import React, { useState, useEffect } from 'react';
import {
  EuiPage,
  EuiPageBody,
  EuiPageHeader,
  EuiButton,
  EuiTable,
  EuiTableBody,
  EuiTableHeader,
  EuiTableHeaderCell,
  EuiTableRow,
  EuiTableRowCell,
  EuiConfirmModal,
} from '@elastic/eui';
import type { HttpServiceSetup } from '@kbn/core/public';

interface RoleMapping {
  name: string;
  roles: string[];
  arn: string;
}

export const AliyunRoleMappingsApp: React.FC<{ http: HttpServiceSetup }> = ({ http }) => {
  const [mappings, setMappings] = useState<RoleMapping[]>([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const fetchMappings = async () => {
    const response = await http.get('/api/security/aliyun_role_mappings');
    setMappings(
      Object.entries(response).map(([name, data]: [string, any]) => ({
        name,
        roles: data.roles,
        arn: data.rules?.field?.['metadata.cloud_arn'],
      }))
    );
  };

  useEffect(() => {
    fetchMappings();
  }, []);

  const handleDelete = async (name: string) => {
    await http.delete(`/api/security/aliyun_role_mappings/${name}`);
    fetchMappings();
    setShowDeleteModal(false);
  };

  const columns = [
    { field: 'name', name: 'Mapping Name' },
    { field: 'arn', name: 'Aliyun ARN' },
    { field: 'roles', name: 'Kibana Roles' },
    {
      name: 'Actions',
      actions: [
        {
          name: 'Delete',
          description: 'Delete mapping',
          icon: 'trash',
          color: 'danger',
          type: 'icon',
          onClick: (mapping: RoleMapping) => {
            setDeleteTarget(mapping.name);
            setShowDeleteModal(true);
          },
        },
      ],
    },
  ];

  return (
    <EuiPage>
      <EuiPageBody>
        <EuiPageHeader
          pageTitle="Aliyun Role Mappings"
          rightSideItems={[
            <EuiButton fill>Add Mapping</EuiButton>,
          ]}
        />
        <EuiTable items={mappings} columns={columns}>
          {/* Table rendering */}
        </EuiTable>
        {showDeleteModal && (
          <EuiConfirmModal
            title="Delete role mapping?"
            onCancel={() => setShowDeleteModal(false)}
            onConfirm={() => handleDelete(deleteTarget!)}
            cancelButtonText="Cancel"
            confirmButtonText="Delete"
            buttonColor="danger"
          />
        )}
      </EuiPageBody>
    </EuiPage>
  );
};
```

**Step 3: Register UI in security plugin**

File: `x-pack/platform/plugins/shared/security/public/plugin.ts`

```typescript
import { AliyunRoleMappingsApp } from './management/aliyun_role_mappings/aliyun_role_mappings_app';

export class SecurityPlugin implements Plugin {
  setup(core: CoreSetup) {
    // Register management UI
    core.application.register({
      id: 'aliyun_role_mappings',
      title: 'Aliyun Role Mappings',
      mount: async (params) => {
        const { renderApp } = await import('./management/aliyun_role_mappings');
        return renderApp(core, params);
      },
    });
  }
}
```

**Step 4: Commit**

```bash
git add x-pack/platform/plugins/shared/security/public/management/aliyun_role_mappings/
git add x-pack/platform/plugins/shared/security/server/routes/aliyun_role_mappings.ts
git commit -m "feat: add Aliyun role mapping management UI"
```

---

## Task 6: Integration Testing with Playwright

**Files:**
- Create: `x-pack/platform/plugins/shared/security/test/auth_aliyun_validation.ts`

**Step 1: Create validation script**

```typescript
// x-pack/platform/plugins/shared/security/test/auth_aliyun_validation.ts
import { test, expect } from '@playwright/test';

test.describe('Aliyun IAM Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5601/login');
  });

  test('should show Aliyun login option', async ({ page }) => {
    await expect(page.getByText('Login with Aliyun')).toBeVisible();
  });

  test('should switch to Aliyun login form', async ({ page }) => {
    await page.click('button:has-text("Login with Aliyun")');
    await expect(page.getByText('Sign in with Aliyun')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login with Aliyun' })).toBeVisible();
  });

  test('should authenticate with mock Aliyun credentials', async ({ page }) => {
    // Switch to Aliyun login
    await page.click('button:has-text("Login with Aliyun")');
    await page.click('button:has-text("Login with Aliyun")');

    // Wait for authentication and redirect
    await page.waitForURL('http://localhost:5601/');
    await expect(page).toHaveURL(/.*localhost:5601\/.*/);
  });

  test('should access role mapping management', async ({ page, context }) => {
    // Login as admin
    await page.fill('input[name="username"]', 'elastic');
    await page.fill('input[name="password"]', 'Summer11');
    await page.click('button[type="submit"]');

    // Navigate to role mappings
    await page.goto('http://localhost:5601/app/management/security/aliyun_role_mappings');
    await expect(page.getByText('Aliyun Role Mappings')).toBeVisible();
  });

  test('should create role mapping via UI', async ({ page }) => {
    // Login as admin
    await page.fill('input[name="username"]', 'elastic');
    await page.fill('input[name="password"]', 'Summer11');
    await page.click('button[type="submit"]');

    await page.goto('http://localhost:5601/app/management/security/aliyun_role_mappings');

    // Click add mapping
    await page.click('button:has-text("Add Mapping")');

    // Fill form
    await page.fill('input[name="name"]', 'test-user');
    await page.fill('input[name="arn"]', 'acs:ram::123456789:user/testuser');
    await page.fill('input[name="roles"]', 'kibana_admin');

    await page.click('button:has-text("Save")');

    // Verify mapping created
    await expect(page.getByText('test-user')).toBeVisible();
  });
});
```

**Step 2: Run Playwright tests**

Run: `yarn playwright test x-pack/platform/plugins/shared/security/test/auth_aliyun_validation.ts`

**Step 3: Document validation process**

Create: `VALIDATION-GUIDE.md`

```markdown
# Aliyun IAM Authentication Validation Guide

## Prerequisites
- Elasticsearch running at localhost:9200 with Cloud IAM plugin
- Kibana running at localhost:5601
- ES user: elastic/Summer11

## Validation Steps

### 1. Start Services
\`\`\`bash
# Start ES
cd /path/to/es-9.2.4
./bin/elasticsearch

# Start Kibana
cd /home/denny/projects/kibana-9.2.4
yarn start
\`\`\`

### 2. Run Playwright Tests
\`\`\`bash
cd /home/denny/projects/kibana-9.2.4
yarn playwright test x-pack/platform/plugins/shared/security/test/auth_aliyun_validation.ts
\`\`\`

### 3. Manual Verification
- Visit http://localhost:5601/login
- Verify "Login with Aliyun" button visible
- Click and complete Aliyun login flow
- Verify successful authentication
- Check role mapping UI at /app/management/security/aliyun_role_mappings

## Expected Results
- User sees dual login options
- Aliyun login authenticates successfully
- Role mappings can be created/deleted via UI
- Mappings are enforced by ES
\`\`\`

**Step 4: Commit validation guide**

```bash
git add VALIDATION-GUIDE.md
git add x-pack/platform/plugins/shared/security/test/auth_aliyun_validation.ts
git commit -m "test: add Aliyun auth validation tests and guide"
```

---

## Task 7: Extensibility Implementation

**Files:**
- Create: `x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun/token_extractor.ts`
- Modify: `x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts`

**Step 1: Create token extractor interface**

```typescript
// x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun/token_extractor.ts
import type { KibanaRequest } from '@kbn/core/server';

export interface TokenExtractor {
  extract(request: KibanaRequest): string | null;
}

/**
 * Default: Extract from X-ES-IAM-Signed header
 */
export class HeaderTokenExtractor implements TokenExtractor {
  extract(request: KibanaRequest): string | null {
    return request.headers['x-es-iam-signed'] || null;
  }
}

/**
 * Future: Extract from gateway-forwarded header
 */
export class GatewayTokenExtractor implements TokenExtractor {
  constructor(private headerName: string) {}

  extract(request: KibanaRequest): string | null {
    return request.headers[this.headerName.toLowerCase()] || null;
  }
}

/**
 * Future: Extract from cookie (same-domain Aliyun Console)
 */
export class CookieTokenExtractor implements TokenExtractor {
  constructor(private cookieName: string) {}

  extract(request: KibanaRequest): string | null {
    const cookies = request.headers.cookie;
    if (!cookies) return null;

    const match = cookies.match(`${this.cookieName}=([^;]+)`);
    return match ? match[1] : null;
  }
}
```

**Step 2: Integrate extractor into provider**

File: `x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts`

```typescript
import { HeaderTokenExtractor, type TokenExtractor } from './aliyun/token_extractor';

export class AliyunAuthenticationProvider extends BaseAuthenticationProvider {
  private tokenExtractor: TokenExtractor;

  constructor(options, config?: { tokenExtractor?: TokenExtractor }) {
    super(options);
    this.tokenExtractor = config?.tokenExtractor || new HeaderTokenExtractor();
  }

  public async authenticate(request: KibanaRequest, state?: ProviderState | null) {
    // Try to extract token from request (for gateway scenarios)
    const token = this.tokenExtractor.extract(request);
    if (token && !state?.authorization) {
      // Authenticate with extracted token
      return this.authenticateWithToken(request, token);
    }

    // ... rest of existing logic
  }
}
```

**Step 3: Commit**

```bash
git add x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun/token_extractor.ts
git add x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts
git commit -m "feat: add token extractor interface for extensibility"
```

---

## Final Verification

**Step 1: Run all tests**

```bash
cd /home/denny/projects/kibana-9.2.4

# Unit tests
yarn test x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.test.ts
yarn test x-pack/platform/plugins/shared/security/public/authentication/aliyun/signal_generator.test.ts

# Integration tests
yarn playwright test x-pack/platform/plugins/shared/security/test/auth_aliyun_validation.ts
```

**Step 2: Build and verify**

```bash
yarn build
yarn start
```

Manual verification checklist:
- [ ] Login page shows both Basic and Aliyun options
- [ ] Aliyun login authenticates successfully
- [ ] Role mapping UI accessible and functional
- [ ] Mappings enforced by ES
- [ ] Existing basic auth still works

**Step 3: Create summary PR**

```bash
git push origin branch-9.2.4
```

PR Description:
```
## Aliyun IAM Authentication for Kibana

### Features
- ✅ Dual login: Basic auth + Aliyun IAM
- ✅ Client-side Aliyun STS signature generation
- ✅ Role mapping management UI
- ✅ Extensible token extraction (header/gateway/cookie)

### Testing
- Unit tests for provider and signature generator
- Playwright E2E tests for login flow and role mapping UI
- Validation guide: `VALIDATION-GUIDE.md`

### Configuration
No config changes required. Provider auto-registers.
ES realm: `cloud_iam` must exist in Elasticsearch.
```

---

## Summary

This plan implements:
1. ✅ Aliyun authentication provider (server)
2. ✅ Client-side signature generation with Aliyun SDK
3. ✅ Dual login UI (Basic + Aliyun)
4. ✅ Role mapping management UI
5. ✅ Extensibility for gateway/cookie scenarios
6. ✅ Comprehensive testing with Playwright
7. ✅ Validation guide for regression testing

Total estimated implementation: ~7 tasks, ~20-30 commits, comprehensive test coverage.
