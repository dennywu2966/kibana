/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import crypto from 'crypto';

import { schema } from '@kbn/config-schema';
import { isInternalURL } from '@kbn/std';

import type { RouteDefinitionParams } from '..';
import { wrapIntoCustomErrorResponse } from '../../errors';
import { createLicensedRouteHandler } from '../licensed_route_handler';
import { ROUTE_TAG_AUTH_FLOW, ROUTE_TAG_CAN_REDIRECT } from '../tags';

interface OAuthStatePayload {
  v: 'v1';
  codeVerifier: string;
  redirectTo?: string;
  createdAt: number;
}

interface OAuthConfigEntry {
  providerName: string;
  clientId: string;
}

interface OAuthTokenResponsePayload {
  access_token: string;
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_VERSION = 'v1';
const OAUTH_TOKEN_EXCHANGE_TIMEOUT_MS = 10_000;

// Generate code verifier and challenge for PKCE
function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

// Aliyun OAuth 2.1 endpoints (PKCE - no client secret required)
// Source: https://oauth.aliyun.com/.well-known/openid-configuration
const ALIYUN_AUTHORIZATION_URL = 'https://signin.aliyun.com/oauth2/v1/auth';
const ALIYUN_TOKEN_URL = 'https://oauth.aliyun.com/v1/token';
const LEGACY_OAUTH_CALLBACK_PATH = '/kibana/internal/security/aliyun/oauth/callback';
const API_OAUTH_CALLBACK_PATH = '/api/security/aliyun/oauth/callback';

export function defineAliyunOAuthRoutes({
  router,
  getAuthenticationService,
  config,
  basePath,
  logger,
}: RouteDefinitionParams) {
  const routeLogger = logger.get('routes', 'authentication', 'aliyun_oauth');

  const getConfiguredCallbackPath = () => {
    const redirectUriOverride = process.env.ALIYUN_OAUTH_REDIRECT_URI?.trim();
    if (redirectUriOverride) {
      try {
        const parsed = new URL(redirectUriOverride);
        if (parsed.pathname.startsWith('/')) {
          return parsed.pathname;
        }
      } catch {
        // fall through to path-based configuration
      }
    }

    const configuredPath = process.env.ALIYUN_OAUTH_CALLBACK_PATH?.trim();
    if (configuredPath?.startsWith('/')) {
      return configuredPath;
    }
    return API_OAUTH_CALLBACK_PATH;
  };

  const getOAuthCallbackURL = () => {
    const redirectUriOverride = process.env.ALIYUN_OAUTH_REDIRECT_URI?.trim();
    if (redirectUriOverride) {
      return redirectUriOverride;
    }
    return basePath.publicBaseUrl
      ? `${basePath.publicBaseUrl}${getConfiguredCallbackPath()}`
      : `http://127.0.0.1:5601${basePath.serverBasePath}${getConfiguredCallbackPath()}`;
  };

  const getOAuthCallbackPaths = () =>
    Array.from(
      new Set([getConfiguredCallbackPath(), API_OAUTH_CALLBACK_PATH, LEGACY_OAUTH_CALLBACK_PATH])
    );

  const getSafeRedirectTo = (redirectTo?: string) =>
    redirectTo && isInternalURL(redirectTo, basePath.serverBasePath) ? redirectTo : undefined;

  const createOAuthStateToken = (payload: OAuthStatePayload) => {
    const serializedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = crypto
      .createHmac('sha256', config.encryptionKey)
      .update(serializedPayload)
      .digest('base64url');
    return `${serializedPayload}.${signature}`;
  };

  const parseOAuthStateToken = (stateToken: string): OAuthStatePayload | undefined => {
    const [serializedPayload, signature] = stateToken.split('.');
    if (!serializedPayload || !signature) {
      return undefined;
    }

    const expectedSignature = crypto
      .createHmac('sha256', config.encryptionKey)
      .update(serializedPayload)
      .digest();

    let receivedSignature: Buffer;
    try {
      receivedSignature = Buffer.from(signature, 'base64url');
    } catch {
      return undefined;
    }

    if (receivedSignature.length !== expectedSignature.length) {
      return undefined;
    }

    if (!crypto.timingSafeEqual(receivedSignature, expectedSignature)) {
      return undefined;
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(Buffer.from(serializedPayload, 'base64url').toString('utf8'));
    } catch {
      return undefined;
    }

    const payload = parsedPayload as Partial<OAuthStatePayload>;
    if (
      payload?.v !== OAUTH_STATE_VERSION ||
      typeof payload.codeVerifier !== 'string' ||
      typeof payload.createdAt !== 'number'
    ) {
      return undefined;
    }

    return {
      v: OAUTH_STATE_VERSION,
      codeVerifier: payload.codeVerifier,
      redirectTo: typeof payload.redirectTo === 'string' ? payload.redirectTo : undefined,
      createdAt: payload.createdAt,
    };
  };

  const getAuthenticationErrorRedirectURL = (redirectTo?: string) => {
    const safeRedirectTo = getSafeRedirectTo(redirectTo);
    const nextQuery = safeRedirectTo ? `&next=${encodeURIComponent(safeRedirectTo)}` : '';
    return `${basePath.serverBasePath}/login?msg=AUTHENTICATION_ERROR${nextQuery}`;
  };

  // Get OAuth configuration from provider config.
  const getOAuthConfig = (): OAuthConfigEntry | undefined => {
    const aliyunProviders = config.authc.providers.aliyun;
    if (!aliyunProviders) return undefined;

    // Resolve OAuth config using the active provider chain order to keep route behavior
    // aligned with authenticator/provider selection semantics.
    for (const providerRef of config.authc.sortedProviders) {
      if (providerRef.type !== 'aliyun') {
        continue;
      }

      const provider = aliyunProviders[providerRef.name];
      if (provider?.oauth?.clientId) {
        return {
          providerName: providerRef.name,
          clientId: provider.oauth.clientId,
        };
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
          next: schema.maybe(schema.string()),
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
        const { redirect_to: redirectToParam, next: nextParam } = request.query;
        const requestedRedirectTo = redirectToParam ?? nextParam;
        const redirectTo = getSafeRedirectTo(requestedRedirectTo);
        const oauthConfig = getOAuthConfig();

        if (!oauthConfig) {
          throw new Error('Aliyun OAuth is not configured. Please set clientId in kibana.yml');
        }

        // Generate PKCE code verifier and challenge
        const { codeVerifier, codeChallenge } = generatePKCE();
        const statePayload: OAuthStatePayload = {
          v: OAUTH_STATE_VERSION,
          codeVerifier,
          redirectTo,
          createdAt: Date.now(),
        };

        // Signed state token carries PKCE verifier and redirect metadata across instances.
        const state = createOAuthStateToken(statePayload);

        // Build OAuth callback URI.
        const redirectUri = getOAuthCallbackURL();

        // Build Aliyun OAuth 2.1 authorization URL with PKCE
        const authUrl = new URL(ALIYUN_AUTHORIZATION_URL);
        authUrl.searchParams.set('client_id', oauthConfig.clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', 'openid profile aliuid');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');

        // Add redirect_to as relay state.
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

  const oauthCallbackHandler = createLicensedRouteHandler(async (context, request, response) => {
    let failureRedirectTo: string | undefined;

    try {
      const {
        code,
        state,
        relay_state: relayState,
        error,
        error_description: errorDescription,
      } = request.query;
      const relayStateRedirect = getSafeRedirectTo(relayState);
      failureRedirectTo = relayStateRedirect;

      const oauthConfig = getOAuthConfig();

      if (!oauthConfig) {
        throw new Error('Aliyun OAuth is not configured');
      }

      if (error) {
        const message = errorDescription
          ? `${error}: ${errorDescription}`
          : `Aliyun OAuth failed: ${error}`;
        routeLogger.warn(`Aliyun OAuth callback returned error: ${message}`);
        return response.redirected({
          headers: { location: getAuthenticationErrorRedirectURL(failureRedirectTo) },
        });
      }

      if (!code) {
        routeLogger.warn('Aliyun OAuth callback missing authorization code.');
        return response.redirected({
          headers: { location: getAuthenticationErrorRedirectURL(failureRedirectTo) },
        });
      }

      if (!state) {
        routeLogger.warn('Aliyun OAuth callback missing state.');
        return response.redirected({
          headers: { location: getAuthenticationErrorRedirectURL(failureRedirectTo) },
        });
      }

      const stateEntry = parseOAuthStateToken(state);
      if (!stateEntry) {
        routeLogger.warn('Aliyun OAuth callback state token is invalid.');
        return response.redirected({
          headers: { location: getAuthenticationErrorRedirectURL(failureRedirectTo) },
        });
      }

      failureRedirectTo = stateEntry.redirectTo || relayStateRedirect;

      if (Date.now() - stateEntry.createdAt > OAUTH_STATE_TTL_MS) {
        routeLogger.warn(`Aliyun OAuth callback state ${state.slice(0, 8)}... exceeded TTL.`);
        return response.redirected({
          headers: {
            location: getAuthenticationErrorRedirectURL(failureRedirectTo),
          },
        });
      }

      // Build OAuth callback URI.
      const redirectUri = getOAuthCallbackURL();

      // Exchange authorization code for access token using PKCE.
      const tokenParams: Record<string, string> = {
        grant_type: 'authorization_code',
        code,
        client_id: oauthConfig.clientId,
        redirect_uri: redirectUri,
        code_verifier: stateEntry.codeVerifier,
      };

      const tokenExchangeAbortController = new AbortController();
      const tokenExchangeTimeout = setTimeout(
        () => tokenExchangeAbortController.abort(),
        OAUTH_TOKEN_EXCHANGE_TIMEOUT_MS
      );

      const tokenResponse = await fetch(ALIYUN_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(tokenParams),
        signal: tokenExchangeAbortController.signal,
      }).finally(() => clearTimeout(tokenExchangeTimeout));

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text().catch(() => '');
        routeLogger.warn(
          `Aliyun OAuth token exchange failed with status ${
            tokenResponse.status
          }: ${tokenResponse.statusText}${errorText ? ` - ${errorText}` : ''}`
        );
        return response.redirected({
          headers: { location: getAuthenticationErrorRedirectURL(failureRedirectTo) },
        });
      }

      let tokenData: unknown;
      try {
        tokenData = await tokenResponse.json();
      } catch (parseError) {
        routeLogger.warn(
          `Aliyun OAuth token exchange returned non-JSON payload: ${
            parseError instanceof Error ? parseError.message : String(parseError)
          }`
        );
        return response.redirected({
          headers: { location: getAuthenticationErrorRedirectURL(failureRedirectTo) },
        });
      }

      const accessToken =
        typeof tokenData === 'object' &&
        tokenData !== null &&
        'access_token' in tokenData &&
        typeof (tokenData as OAuthTokenResponsePayload).access_token === 'string'
          ? (tokenData as OAuthTokenResponsePayload).access_token
          : undefined;

      if (!accessToken) {
        routeLogger.warn('Aliyun OAuth token exchange returned no access token.');
        return response.redirected({
          headers: {
            location: getAuthenticationErrorRedirectURL(failureRedirectTo),
          },
        });
      }

      // Create Kibana session using Aliyun OAuth credentials.
      const redirectURL =
        stateEntry.redirectTo ||
        relayStateRedirect ||
        `${basePath.publicBaseUrl || 'http://127.0.0.1:5601'}${basePath.serverBasePath}/`;

      const authenticationResult = await getAuthenticationService().login(request, {
        provider: { name: oauthConfig.providerName },
        value: {
          accessToken,
          redirectURL,
        },
      });

      if (authenticationResult.failed()) {
        routeLogger.warn(
          `Aliyun OAuth authentication failed: ${
            authenticationResult.error?.message ?? 'unknown authentication error'
          }`
        );
        return response.redirected({
          headers: {
            location: getAuthenticationErrorRedirectURL(failureRedirectTo),
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
      routeLogger.warn('Aliyun OAuth authentication did not produce redirect result.');
      return response.redirected({
        headers: {
          location: getAuthenticationErrorRedirectURL(failureRedirectTo),
        },
      });
    } catch (error) {
      routeLogger.error(
        `Aliyun OAuth callback failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return response.redirected({
        headers: { location: getAuthenticationErrorRedirectURL(failureRedirectTo) },
      });
    }
  });

  // OAuth callback - handle authorization code. Register both legacy and API callback paths.
  for (const callbackPath of getOAuthCallbackPaths()) {
    router.get(
      {
        path: callbackPath,
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
          query: schema.object(
            {
              code: schema.maybe(schema.string()),
              state: schema.maybe(schema.string()),
              relay_state: schema.maybe(schema.string()),
              error: schema.maybe(schema.string()),
              error_description: schema.maybe(schema.string()),
            },
            { unknowns: 'allow' }
          ),
        },
        options: {
          access: 'public',
          excludeFromOAS: true,
          tags: [ROUTE_TAG_CAN_REDIRECT, ROUTE_TAG_AUTH_FLOW],
        },
      },
      oauthCallbackHandler
    );
  }
}
