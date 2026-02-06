/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineCommonRoutes } from './common';
import { defineOIDCRoutes } from './oidc';
import { defineSAMLRoutes } from './saml';
import { defineAliyunRoutes } from './aliyun';
import { defineAliyunOAuthRoutes } from './aliyun_oauth';
import type { RouteDefinitionParams } from '..';

export function defineAuthenticationRoutes(params: RouteDefinitionParams) {
  defineCommonRoutes(params);

  // Debug logging to see which providers are configured
  const providers = params.config.authc.sortedProviders;
  const providerInfo = providers.map(p => `${p.type}/${p.name}`).join(', ');
  console.error(`[Security Routes] Configured providers: ${providerInfo}`);

  if (params.config.authc.sortedProviders.some(({ type }) => type === 'saml')) {
    defineSAMLRoutes(params);
  }

  if (params.config.authc.sortedProviders.some(({ type }) => type === 'oidc')) {
    defineOIDCRoutes(params);
  }

  if (params.config.authc.sortedProviders.some(({ type }) => type === 'aliyun')) {
    console.error('[Security Routes] Registering Aliyun routes');
    defineAliyunRoutes(params);
    defineAliyunOAuthRoutes(params);
  }
}
