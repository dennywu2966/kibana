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

/**
 * Defines routes required for Aliyun authentication.
 */
export function defineAliyunRoutes({
  router,
}: RouteDefinitionParams) {
  router.post(
    {
      path: '/internal/security/aliyun/authenticate',
      security: {
        authz: {
          enabled: false,
          reason: 'This route is used for authentication - it does not require existing authentication',
        },
        authc: {
          enabled: false,
          reason: 'This route is used for authentication - it does not require existing authentication',
        },
      },
      validate: {
        body: schema.object({
          signedToken: schema.string(),
        }),
      },
      options: {
        access: 'public',
      },
    },
    createLicensedRouteHandler(async (context, request, response) => {
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
        return response.customError(wrapIntoCustomErrorResponse(error));
      }
    })
  );
}
