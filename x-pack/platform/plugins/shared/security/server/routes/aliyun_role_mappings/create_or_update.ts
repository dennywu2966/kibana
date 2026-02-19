/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { estypes } from '@elastic/elasticsearch';
import { schema } from '@kbn/config-schema';
import type { RouteDefinitionParams } from '..';
import { wrapError } from '../../errors';
import { createLicensedRouteHandler } from '../licensed_route_handler';
import type { AliyunRoleMapping } from './get_all';

const roleMappingSchema = schema.object({
  arn: schema.string({
    minLength: 20,
    maxLength: 2048,
  }),
  roles: schema.arrayOf(
    schema.string({
      minLength: 1,
    }),
    {
      minLength: 1,
      maxLength: 100,
    }
  ),
});

// Convert ARN to valid ES role mapping name
function arnToMappingName(arn: string): string {
  // Extract user/resource from ARN and create valid mapping name
  // ARN format: acs:ram::{account-id}:{type}/{name}
  const parts = arn.split(':');
  const resourcePart = parts[parts.length - 1]; // e.g., "user/dongdongplanet"
  const [type, name] = resourcePart.split('/');
  // Create valid mapping name: aliyun-{type}-{name}-{account}
  const accountId = parts[3]; // account-id from ARN
  return `aliyun_${type}_${name}_${accountId}`.replace(/[^a-z0-9_]/g, '_');
}

export function defineCreateOrUpdateAliyunRoleMappingRoutes({
  router,
  getAuthenticationService,
}: RouteDefinitionParams) {
  // POST - Create new role mapping
  router.post(
    {
      path: '/internal/security/aliyun/role_mappings',
      security: {
        authz: {
          enabled: false,
          reason: 'This route delegates authorization to Core\'s scoped ES cluster client',
        },
      },
      validate: {
        body: roleMappingSchema,
      },
      options: {
        access: 'internal',
      },
    },
    createLicensedRouteHandler(async (context, request, response) => {
      try {
        const { arn, roles } = request.body;
        const esClient = (await context.core).elasticsearch.client;

        const mappingName = arnToMappingName(arn);

        // Check if mapping already exists
        try {
          await esClient.asCurrentUser.security.getRoleMapping({ name: mappingName });
          // If we get here, mapping exists
          return response.conflict({
            body: {
              message: `Role mapping for ARN '${arn}' already exists`,
              existingName: mappingName,
            },
          });
        } catch (error: any) {
          // 404 is expected - mapping doesn't exist yet
          if (error?.meta?.statusCode !== 404) {
            throw error;
          }
        }

        // Create ES role mapping with rules to match Aliyun user by ARN.
        // Cloud IAM realm populates `metadata.cloud_arn` in the authenticated principal metadata.
        const roleMappingBody = {
          enabled: true,
          roles: roles,
          rules: {
            all: [
              { field: { 'metadata.cloud_arn': arn } },
            ],
          },
          metadata: {
            arn,
            created_by: (await getAuthenticationService().getCurrentUser(request))?.username,
            created_at: new Date().toISOString(),
          },
        };

        const saveResponse = await esClient.asCurrentUser.security.putRoleMapping({
          name: mappingName,
          ...roleMappingBody,
        });

        return response.ok({
          body: {
            id: mappingName,
            arn,
            roles,
            ...saveResponse,
          },
        });
      } catch (error) {
        const wrappedError = wrapError(error);
        return response.customError({
          body: wrappedError,
          statusCode: wrappedError.output?.statusCode || 500,
        });
      }
    })
  );

  // PUT - Update existing role mapping
  router.put(
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
        body: roleMappingSchema,
      },
      options: {
        access: 'internal',
      },
    },
    createLicensedRouteHandler(async (context, request, response) => {
      try {
        const { id } = request.params;
        const { arn, roles } = request.body;
        const esClient = (await context.core).elasticsearch.client;

        // Get existing mapping
        const existingMappings = await esClient.asCurrentUser.security.getRoleMapping({
          name: id,
        });
        const existingMapping = existingMappings[id];

        // Update ES role mapping
        const roleMappingBody = {
          enabled: true,
          roles: roles,
          rules: {
            all: [
              { field: { 'metadata.cloud_arn': arn } },
            ],
          },
          metadata: {
            ...existingMapping.metadata,
            arn,
            updated_at: new Date().toISOString(),
            updated_by: (await getAuthenticationService().getCurrentUser(request))?.username,
          },
        };

        const saveResponse = await esClient.asCurrentUser.security.putRoleMapping({
          name: id,
          ...roleMappingBody,
        });

        return response.ok({
          body: {
            id,
            arn,
            roles,
            ...saveResponse,
          },
        });
      } catch (error) {
        const wrappedError = wrapError(error);
        return response.customError({
          body: wrappedError,
          statusCode: wrappedError.output?.statusCode || 500,
        });
      }
    })
  );
}
