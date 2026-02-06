/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { schema } from '@kbn/config-schema';
import type { RouteDefinitionParams } from '..';
import { wrapIntoCustomErrorResponse } from '../../errors';
import { createLicensedRouteHandler } from '../licensed_route_handler';
import { AliyunAuthenticationProvider } from '../../authentication/providers/aliyun';
import { ROUTE_TAG_AUTH_FLOW, ROUTE_TAG_CAN_REDIRECT } from '../tags';
import crypto from 'crypto';

// Generate code verifier and challenge for PKCE
function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  // Return with an ID that can be used to retrieve the verifier without state
  const verifierId = crypto.randomBytes(16).toString('hex');
  return { codeVerifier, codeChallenge, verifierId };
}

// Aliyun OAuth 2.1 endpoints (PKCE - no client secret required)
// Source: https://oauth.aliyun.com/.well-known/openid-configuration
const ALIYUN_AUTHORIZATION_URL = 'https://signin.aliyun.com/oauth2/v1/auth';
const ALIYUN_TOKEN_URL = 'https://oauth.aliyun.com/v1/token';
const ALIYUN_USERINFO_URL = 'https://oauth.aliyun.com/v1/userinfo';

export function defineAliyunOAuthRoutes({ router, getAuthenticationService, config, basePath }: RouteDefinitionParams) {
  // Store code verifiers in memory (in production, use Redis or similar)
  const codeVerifiers = new Map<string, string>();

  // Get OAuth configuration from provider config
  const getOAuthConfig = () => {
    const aliyunProviders = config.authc.providers.aliyun;
    if (!aliyunProviders) return undefined;

    // Get the first enabled Aliyun provider's oauth config
    for (const [name, provider] of Object.entries(aliyunProviders)) {
      if (provider.enabled && provider.oauth) {
        return provider.oauth;
      }
    }
    return undefined;
  };

  // OAuth 2.1 / PKCE - Initiate login
  router.get(
    {
      path: '/api/security/aliyun/oauth/authorize',
      security: {
        authc: {
          enabled: false,
          reason: 'This route initiates OAuth login flow',
        },
        authz: {
          enabled: false,
          reason: 'This route initiates OAuth login flow',
        },
      },
      validate: {
        query: schema.object({
          redirect_to: schema.maybe(schema.string()),
        }),
      },
      options: {
        access: 'public',
        excludeFromOAS: true,
        tags: [ROUTE_TAG_CAN_REDIRECT, ROUTE_TAG_AUTH_FLOW],
      },
    },
    createLicensedRouteHandler(async (context, request, response) => {
      try {
        const { redirect_to: redirectTo } = request.query;
        const oauthConfig = getOAuthConfig();

        if (!oauthConfig || !oauthConfig.clientId) {
          throw new Error('Aliyun OAuth is not configured. Please set appId in kibana.yml');
        }

        // Generate PKCE code verifier and challenge
        const { codeVerifier, codeChallenge, verifierId } = generatePKCE();

        // Use verifierId as the state - serves as both CSRF token and lookup key
        const state = verifierId;

        // Store the code verifier for later use (indexed by verifierId/state)
        codeVerifiers.set(state, codeVerifier);

        // Build redirect URI - if publicBaseUrl includes basePath, don't add serverBasePath
        const hasBasePathInPublicUrl = basePath.publicBaseUrl && basePath.publicBaseUrl !== 'http://127.0.0.1:5601';
        const redirectUri = hasBasePathInPublicUrl
          ? `${basePath.publicBaseUrl}/api/security/aliyun/oauth/callback`
          : `${basePath.publicBaseUrl || 'http://127.0.0.1:5601'}${basePath.serverBasePath}/api/security/aliyun/oauth/callback`;

        // Build Aliyun OAuth 2.1 authorization URL with PKCE
        const authUrl = new URL(ALIYUN_AUTHORIZATION_URL);
        authUrl.searchParams.set('client_id', oauthConfig.clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', 'openid profile aliuid');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');

        // Add redirect_to as relay state
        if (redirectTo) {
          authUrl.searchParams.set('relay_state', redirectTo);
        }

        return response.ok({
          body: {
            authorizationUrl: authUrl.toString(),
            state,
          },
        });
      } catch (error) {
        return response.customError(wrapIntoCustomErrorResponse(error));
      }
    })
  );

  // OAuth callback - handle authorization code
  router.get(
    {
      path: '/api/security/aliyun/oauth/callback',
      security: {
        authc: {
          enabled: false,
          reason: 'This route handles OAuth callback',
        },
        authz: {
          enabled: false,
          reason: 'This route handles OAuth callback',
        },
      },
      validate: {
        query: schema.object({
          code: schema.string(),
          state: schema.maybe(schema.string()),
        }),
      },
      options: {
        access: 'public',
        excludeFromOAS: true,
        tags: [ROUTE_TAG_CAN_REDIRECT, ROUTE_TAG_AUTH_FLOW],
      },
    },
    createLicensedRouteHandler(async (context, request, response) => {
      try {
        console.error('[ALIYUN_OAUTH_CALLBACK] Received callback request');
        console.error('[ALIYUN_OAUTH_CALLBACK] Query params:', JSON.stringify(request.query));
        const { code, state } = request.query;
        console.error('[ALIYUN_OAUTH_CALLBACK] Code:', code ? 'present' : 'missing', 'State:', state);
        const oauthConfig = getOAuthConfig();
        console.error('[ALIYUN_OAUTH_CALLBACK] OAuth config:', oauthConfig ? 'present' : 'missing');

        if (!oauthConfig) {
          throw new Error('Aliyun OAuth is not configured');
        }

        // Retrieve the code verifier using state as key
        // Aliyun should return the state parameter, but if not, we'll handle it gracefully
        let codeVerifier: string | undefined;
        if (state) {
          codeVerifier = codeVerifiers.get(state);
          codeVerifiers.delete(state); // Clean up immediately
        }

        // If no code verifier is available, we can't complete PKCE flow
        // As a fallback, try without PKCE (some providers allow this for testing)
        const usePKCE = !!codeVerifier;
        if (!usePKCE) {
          console.error('[ALIYUN_OAUTH_CALLBACK] Warning: State parameter missing, attempting token exchange without PKCE');
        }

        // Build redirect URI - if publicBaseUrl includes basePath, don't add serverBasePath
        const hasBasePathInPublicUrl = basePath.publicBaseUrl && basePath.publicBaseUrl !== 'http://127.0.0.1:5601';
        const redirectUri = hasBasePathInPublicUrl
          ? `${basePath.publicBaseUrl}/api/security/aliyun/oauth/callback`
          : `${basePath.publicBaseUrl || 'http://127.0.0.1:5601'}${basePath.serverBasePath}/api/security/aliyun/oauth/callback`;

        // Exchange authorization code for access token
        // Note: PKCE (code_verifier) is preferred but may not be available if state was lost
        const tokenParams: Record<string, string> = {
          grant_type: 'authorization_code',
          code,
          client_id: oauthConfig.clientId,
          redirect_uri: redirectUri,
        };

        // Add code_verifier only if we have it (PKCE flow)
        if (usePKCE && codeVerifier) {
          tokenParams.code_verifier = codeVerifier;
        }

        const tokenResponse = await fetch(ALIYUN_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(tokenParams),
        });

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          throw new Error(`Token exchange failed: ${tokenResponse.statusText} - ${errorText}`);
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        // Get user info from Aliyun
        const userResponse = await fetch(ALIYUN_USERINFO_URL, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });

        if (!userResponse.ok) {
          throw new Error(`Failed to get user info: ${userResponse.statusText}`);
        }

        const userInfo = await userResponse.json();

        // Create Kibana session using Aliyun OAuth credentials
        // Get redirect URL from relay_state query parameter (set during authorization)
        const redirectURL = request.query.relay_state as string || `${basePath.publicBaseUrl || 'http://127.0.0.1:5601'}${basePath.serverBasePath}/`;

        const authenticationResult = await getAuthenticationService().login(request, {
          provider: { type: AliyunAuthenticationProvider.type },
          value: {
            accessToken,
            userInfo,
            redirectURL,
          },
        });

        if (authenticationResult.failed()) {
          return response.unauthorized({
            body: {
              message: authenticationResult.error && authenticationResult.error.message
                ? `Authentication failed: ${authenticationResult.error.message}`
                : 'Authentication failed',
            },
          });
        }

        // Follow OIDC pattern: use response.redirected() when authenticationResult.redirected() is true
        // This ensures Hapi properly includes the session cookies in the redirect response
        if (authenticationResult.redirected()) {
          return response.redirected({
            headers: { location: authenticationResult.redirectURL! },
          });
        }

        // This should not happen with the current implementation, but handle it anyway
        return response.unauthorized({
          body: authenticationResult.error,
        });
      } catch (error) {
        console.error('[ALIYUN_OAUTH_CALLBACK] ERROR caught in callback:', error);
        console.error('[ALIYUN_OAUTH_CALLBACK] Error message:', error?.message);
        console.error('[ALIYUN_OAUTH_CALLBACK] Error stack:', error?.stack);
        return response.customError(wrapIntoCustomErrorResponse(error));
      }
    })
  );
}
