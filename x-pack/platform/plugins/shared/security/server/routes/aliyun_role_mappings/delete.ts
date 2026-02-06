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

export function defineDeleteAliyunRoleMappingRoutes({ router }: RouteDefinitionParams) {
  router.delete(
    {
      path: '/internal/security/aliyun/role_mappings/{id}',
      security: {
        authz: {
          enabled: false,
          reason: 'This route delegates authorization to Core\'s scoped ES cluster client',
        },
      },
      validate: {
        params: schema.object({
          id: schema.string(),
        }),
      },
      options: {
        access: 'internal',
      },
    },
    createLicensedRouteHandler(async (context, request, response) => {
      try {
        const { id } = request.params;
        const esClient = (await context.core).elasticsearch.client;

        await esClient.asCurrentUser.security.deleteRoleMapping({
          name: id,
        });

        return response.noContent();
      } catch (error) {
        return response.customError(wrapIntoCustomErrorResponse(error));
      }
    })
  );
}
