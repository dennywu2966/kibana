/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';

import type { StartServicesAccessor } from '@kbn/core/public';
import { i18n } from '@kbn/i18n';
import { KibanaContextProvider } from '@kbn/kibana-react-plugin/public';
import type { RegisterManagementAppArgs } from '@kbn/management-plugin/public';

import { AliyunRoleMappingsGridPage } from './aliyun_role_mappings_grid_page';
import type { PluginStartDependencies } from '../../plugin';

interface CreateParams {
  getStartServices: StartServicesAccessor<PluginStartDependencies>;
}

export const aliyunRoleMappingsManagementApp = Object.freeze({
  id: 'aliyun_role_mappings',
  create({ getStartServices }: CreateParams) {
    const title = i18n.translate('xpack.security.management.aliyunRoleMappingsTitle', {
      defaultMessage: 'Aliyun Role Mappings',
    });

    return {
      id: this.id,
      order: 45, // After role_mappings (40)
      title,
      mount: async ({ element, history }) => {
        const [[core], { AliyunRoleMappingsGridPage }] = await Promise.all([
          getStartServices(),
          import('./aliyun_role_mappings_grid_page'),
        ]);

        core.chrome.docTitle.change(title);

        const I18nContext = core.i18n.Context;

        render(
          core.rendering.addContext(
            <KibanaContextProvider services={core}>
              <I18nContext>
                <AliyunRoleMappingsGridPage
                  http={core.http}
                  notifications={core.notifications}
                />
              </I18nContext>
            </KibanaContextProvider>,
            { history }
          ),
          element
        );

        return () => {
          core.chrome.docTitle.reset();
          unmountComponentAtNode(element);
        };
      },
    };
  },
});
