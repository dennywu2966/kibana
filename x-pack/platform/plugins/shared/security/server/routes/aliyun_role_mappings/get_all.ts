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

function extractArnFromRoleMapping(mapping: any): string | undefined {
  const metadataArn = mapping?.metadata?.arn;
  if (typeof metadataArn === 'string' && metadataArn.length > 0) {
    return metadataArn;
  }

  const allRules = mapping?.rules?.all;
  if (Array.isArray(allRules)) {
    for (const rule of allRules) {
      const field = rule?.field;
      if (!field || typeof field !== 'object') {
        continue;
      }
      const arnCandidate =
        field['metadata.cloud_arn'] ?? field['metadata.aliyun_arn'] ?? field['metadata.arn'];
      if (typeof arnCandidate === 'string' && arnCandidate.length > 0) {
        return arnCandidate;
      }
    }
  }

  return undefined;
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

        // Filter for Aliyun role mappings by resolving ARN from metadata and/or field rules.
        const aliyunMappings = Object.entries(mappingsResult || {})
          .map(([name, mapping]: [string, any]) => {
            const arn = extractArnFromRoleMapping(mapping);
            return arn
              ? {
                  id: name,
                  arn,
                  roles: mapping.roles || [],
                  enabled: mapping.enabled,
                  created_at: mapping.metadata?.created_at,
                  updated_at: mapping.metadata?.updated_at,
                  created_by: mapping.metadata?.created_by,
                }
              : undefined;
          })
          .filter((mapping): mapping is AliyunRoleMapping => Boolean(mapping))
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
