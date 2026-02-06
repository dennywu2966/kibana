/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RouteDefinitionParams } from '..';
import { wrapIntoCustomErrorResponse } from '../../errors';
import { createLicensedRouteHandler } from '../licensed_route_handler';

export interface AliyunRoleMapping {
  id: string;
  arn: string;
  roles: string[];
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  enabled?: boolean;
}

export function defineGetAllAliyunRoleMappingsRoutes({ router }: RouteDefinitionParams) {
  router.get(
    {
      path: '/internal/security/aliyun/role_mappings',
      security: {
        authz: {
          enabled: false,
          reason: 'This route delegates authorization to Core\'s scoped ES cluster client',
        },
      },
      validate: false,
      options: {
        access: 'internal',
      },
    },
    createLicensedRouteHandler(async (context, request, response) => {
      try {
        const esClient = (await context.core).elasticsearch.client;

        // Get all role mappings from ES (returns object with mapping names as keys)
        const mappingsResult = await esClient.asCurrentUser.security.getRoleMapping();

        // Filter for Aliyun role mappings (those with metadata.arn)
        const aliyunMappings = Object.entries(mappingsResult || {})
          .filter(([, mapping]: [string, any]) => mapping.metadata?.arn)
          .map(([name, mapping]: [string, any]) => ({
            id: name,
            arn: mapping.metadata.arn,
            roles: mapping.roles || [],
            enabled: mapping.enabled,
            created_at: mapping.metadata?.created_at,
            updated_at: mapping.metadata?.updated_at,
            created_by: mapping.metadata?.created_by,
          }))
          .sort((a: AliyunRoleMapping, b: AliyunRoleMapping) =>
            (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || '')
          );

        return response.ok({
          body: {
            mappings: aliyunMappings,
            total: aliyunMappings.length,
          },
        });
      } catch (error) {
        // If no mappings exist, return empty list
        if (error?.meta?.statusCode === 404) {
          return response.ok({
            body: {
              mappings: [],
              total: 0,
            },
          });
        }
        return response.customError(wrapIntoCustomErrorResponse(error));
      }
    })
  );
}
