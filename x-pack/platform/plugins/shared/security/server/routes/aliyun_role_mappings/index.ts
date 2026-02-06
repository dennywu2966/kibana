/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineCreateOrUpdateAliyunRoleMappingRoutes } from './create_or_update';
import { defineDeleteAliyunRoleMappingRoutes } from './delete';
import { defineGetAliyunRoleMappingRoutes } from './get';
import { defineGetAllAliyunRoleMappingsRoutes } from './get_all';
import type { RouteDefinitionParams } from '..';

/**
 * Defines all routes required for Aliyun role mappings management.
 */
export function defineAliyunRoleMappingsRoutes(params: RouteDefinitionParams) {
  defineGetAllAliyunRoleMappingsRoutes(params);
  defineGetAliyunRoleMappingRoutes(params);
  defineCreateOrUpdateAliyunRoleMappingRoutes(params);
  defineDeleteAliyunRoleMappingRoutes(params);
}
