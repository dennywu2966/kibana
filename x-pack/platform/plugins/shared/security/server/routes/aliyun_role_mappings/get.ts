/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { estypes } from '@elastic/elasticsearch';
import { schema } from '@kbn/config-schema';
import type { RouteDefinitionParams } from '..';
import { wrapIntoCustomErrorResponse } from '../../errors';
import { createLicensedRouteHandler } from '../licensed_route_handler';
import type { AliyunRoleMapping } from './get_all';

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

export function defineGetAliyunRoleMappingRoutes({ router }: RouteDefinitionParams) {
  router.get(
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

        const mappingResult = await esClient.asCurrentUser.security.getRoleMapping({
          name: id,
        });

        // ES returns object where the key is the mapping name
        const mapping = mappingResult[id];
        const arn = mapping ? extractArnFromRoleMapping(mapping) : undefined;
        if (!mapping || !arn) {
          return response.notFound({
            body: {
              message: 'Aliyun role mapping not found',
            },
          });
        }

        return response.ok({
          body: {
            id,
            arn,
            roles: mapping.roles || [],
            enabled: mapping.enabled,
            created_at: mapping.metadata?.created_at,
            updated_at: mapping.metadata?.updated_at,
            created_by: mapping.metadata?.created_by,
          },
        });
      } catch (error) {
        return response.customError(wrapIntoCustomErrorResponse(error));
      }
    })
  );
}
