/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { schema } from '@kbn/config-schema';
import { parseNextURL } from '@kbn/std';

import type { RouteDefinitionParams } from '..';
import { wrapIntoCustomErrorResponse } from '../../errors';
import { createLicensedRouteHandler } from '../licensed_route_handler';

/**
 * Defines routes required for Aliyun authentication.
 */
export function defineAliyunRoutes({
  router,
  getAuthenticationService,
  basePath,
  config,
}: RouteDefinitionParams) {
  const getAliyunProviderName = () =>
    config.authc.sortedProviders.find(({ type }) => type === 'aliyun')?.name ?? 'aliyun';

  router.post(
    {
      path: '/internal/security/aliyun/authenticate',
      security: {
        authz: {
          enabled: false,
          reason:
            'This route is used for authentication - it does not require existing authentication',
        },
        authc: {
          enabled: false,
          reason:
            'This route is used for authentication - it does not require existing authentication',
        },
      },
      validate: {
        body: schema.object({
          signedToken: schema.string(),
          currentURL: schema.string(),
        }),
      },
      options: {
        access: 'public',
      },
    },
    createLicensedRouteHandler(async (_context, request, response) => {
      try {
        const { signedToken, currentURL } = request.body;
        const redirectURL = parseNextURL(currentURL, basePath.serverBasePath);

        // Now establish Kibana session using the authentication service
        // We'll pass the authentication info to the Aliyun provider
        const authenticationResult = await getAuthenticationService().login(request, {
          provider: { name: getAliyunProviderName() },
          redirectURL,
          value: {
            signedToken,
          },
        });

        if (authenticationResult.redirected() || authenticationResult.succeeded()) {
          return response.ok({
            body: { location: authenticationResult.redirectURL || redirectURL },
            headers: authenticationResult.authResponseHeaders,
          });
        }

        return response.unauthorized({
          body: authenticationResult.error,
          headers: authenticationResult.authResponseHeaders,
        });
      } catch (error) {
        return response.customError(wrapIntoCustomErrorResponse(error));
      }
    })
  );
}
