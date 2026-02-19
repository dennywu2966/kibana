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

// Aliyun SAML SSO endpoints
const ALIYUN_SSO_URL = 'https://signin.aliyun.com/sso/oauth2/saml';
const ALIYUN_SAML_ACS_URL = '/internal/security/aliyun/saml/callback';

export function defineAliyunSamlRoutes({ router, getAuthenticationService, config }: RouteDefinitionParams) {
  // Get SAML configuration from provider config
  const getSamlConfig = () => {
    const providers = config.authc.sortedProviders;
    const aliyunProvider = providers.find(p => p.type === 'aliyun');
    return aliyunProvider?.saml;
  };

  // SAML callback endpoint - handles SAML response from Aliyun
  router.post(
    {
      path: '/internal/security/aliyun/saml/callback',
      validate: {
        body: schema.object({
          SAMLResponse: schema.string(),
          RelayState: schema.maybe(schema.string()),
        }),
      },
      options: {
        access: 'public',
      },
    },
    createLicensedRouteHandler(async (context, request, response) => {
      try {
        const { SAMLResponse: samlResponse, RelayState: relayState } = request.body;
        const samlConfig = getSamlConfig();

        if (!samlConfig) {
          throw new Error('Aliyun SAML SSO is not configured');
        }

        // In a real implementation, we would validate the SAML response
        // For now, we'll extract user info from the SAML assertion
        // This is simplified - production would use proper SAML validation

        // Extract user info from SAML response (simplified)
        // In production, use a SAML library to validate and parse
        const base64Response = Buffer.from(samlResponse, 'base64').toString();
        const match = base64Response.match(/<saml:NameID>([^<]+)<\/saml:NameID>/);
        const username = match ? match[1] : null;

        if (!username) {
          throw new Error('Could not extract username from SAML response');
        }

        // Authenticate with ES using the SAML user info
        const authc = getAuthenticationService();
        const authenticationResult = await authc.login(request, {
          provider: 'aliyun',
          credentials: {
            samlResponse,
            username,
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

        // Redirect to the originally requested URL or home page
        const redirectUrl = relayState || '/';

        return response.redirected({
          headers: {
            location: redirectUrl,
          },
        });
      } catch (error) {
        return response.customError(wrapIntoCustomErrorResponse(error));
      }
    })
  );

  // Initiate SAML SSO - redirect to Aliyun SSO page
  router.get(
    {
      path: '/internal/security/aliyun/sso/login',
      validate: {
        query: schema.object({
          redirect_to: schema.maybe(schema.string()),
        }),
      },
      options: {
        access: 'public',
      },
    },
    createLicensedRouteHandler(async (context, request, response) => {
      try {
        const { redirect_to: redirectTo } = request.query;
        const samlConfig = getSamlConfig();

        if (!samlConfig) {
          throw new Error('Aliyun SAML SSO is not configured');
        }

        // Build SAML request
        const requestId = `_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const samlRequest = buildSAMLRequest({
          appId: samlConfig.appId,
          destination: ALIYUN_SSO_URL,
          requestId,
          acsUrl: samlConfig.acsUrl,
        });

        // Encode SAML request and build SSO URL
        const encodedRequest = Buffer.from(samlRequest).toString('base64');
        const ssoUrl = `${ALIYUN_SSO_URL}?SAMLRequest=${encodeURIComponent(encodedRequest)}`;

        if (redirectTo) {
          const ssoUrlWithRelay = `${ssoUrl}&RelayState=${encodeURIComponent(redirectTo)}`;
          return response.redirected({
            headers: { location: ssoUrlWithRelay },
          });
        }

        return response.redirected({
          headers: { location: ssoUrl },
        });
      } catch (error) {
        return response.customError(wrapIntoCustomErrorResponse(error));
      }
    })
  );
}

function buildSAMLRequest({ appId, destination, requestId, acsUrl }: {
  appId: string;
  destination: string;
  requestId: string;
  acsUrl: string;
}): string {
  // Simplified SAML AuthRequest
  // In production, use a proper SAML library
  return `
<?xml version="1.0" encoding="UTF-8"?>
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
                   ID="${requestId}"
                   Version="2.0"
                   IssueInstant="${new Date().toISOString()}"
                   ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                   AssertionConsumerServiceURL="${acsUrl}"
                   Destination="${destination}">
  <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${appId}</saml:Issuer>
  <samlp:NameIDPolicy xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
                       Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"/>
</samlp:AuthnRequest>
  `.trim();
}
