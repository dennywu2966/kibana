/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { kibanaResponseFactory } from '@kbn/core/server';
import type { RequestHandler } from '@kbn/core/server';
import { coreMock, httpServerMock } from '@kbn/core/server/mocks';

import { defineAliyunRoutes } from './aliyun';
import { AuthenticationResult } from '../../authentication/authentication_result';
import type { SecurityRequestHandlerContext } from '../../types';
import { routeDefinitionParamsMock } from '../index.mock';

describe('Aliyun authentication route', () => {
  it('uses the configured aliyun provider name when creating a session', async () => {
    const routeParams = routeDefinitionParamsMock.create({
      authc: {
        providers: {
          aliyun: {
            aliyun_oauth: {
              order: 0,
              oauth: {
                clientId: 'test-client-id',
              },
            },
          },
        },
      },
    });

    defineAliyunRoutes(routeParams);

    const [, routeHandler] = routeParams.router.post.mock.calls.find(
      ([{ path }]) => path === '/internal/security/aliyun/authenticate'
    ) as [any, RequestHandler<any, any, any, SecurityRequestHandlerContext>];

    const authenticationService = routeParams.getAuthenticationService();
    authenticationService.login.mockResolvedValue(AuthenticationResult.redirectTo('/app/discover'));

    const coreContext = coreMock.createRequestHandlerContext();
    coreContext.elasticsearch.client.asCurrentUser.transport.request.mockResolvedValue({});

    const requestContext = coreMock.createCustomRequestHandlerContext({
      core: coreContext,
      licensing: {
        license: {
          check: jest.fn().mockReturnValue({ state: 'valid' }),
        },
      },
    }) as unknown as SecurityRequestHandlerContext;

    const request = httpServerMock.createKibanaRequest({
      body: {
        signedToken: 'signed-token',
        currentURL: 'http://localhost:5601/mock-server-basepath/app/discover',
      },
    });

    const response = await routeHandler(requestContext, request, kibanaResponseFactory);

    expect(response.status).toBe(200);
    expect(authenticationService.login).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: { name: 'aliyun_oauth' },
      })
    );
  });

  it('delegates auth to authentication service without direct ES pre-authentication call', async () => {
    const routeParams = routeDefinitionParamsMock.create({
      authc: {
        providers: {
          aliyun: {
            aliyun_oauth: {
              order: 0,
              oauth: {
                clientId: 'test-client-id',
              },
            },
          },
        },
      },
    });

    defineAliyunRoutes(routeParams);

    const [, routeHandler] = routeParams.router.post.mock.calls.find(
      ([{ path }]) => path === '/internal/security/aliyun/authenticate'
    ) as [any, RequestHandler<any, any, any, SecurityRequestHandlerContext>];

    const authenticationService = routeParams.getAuthenticationService();
    authenticationService.login.mockResolvedValue(AuthenticationResult.redirectTo('/app/discover'));

    const coreContext = coreMock.createRequestHandlerContext();
    coreContext.elasticsearch.client.asCurrentUser.transport.request.mockResolvedValue({});

    const requestContext = coreMock.createCustomRequestHandlerContext({
      core: coreContext,
      licensing: {
        license: {
          check: jest.fn().mockReturnValue({ state: 'valid' }),
        },
      },
    }) as unknown as SecurityRequestHandlerContext;

    const request = httpServerMock.createKibanaRequest({
      body: {
        signedToken: 'signed-token',
        currentURL: 'http://localhost:5601/mock-server-basepath/app/discover',
      },
    });

    const response = await routeHandler(requestContext, request, kibanaResponseFactory);

    expect(response.status).toBe(200);
    expect(coreContext.elasticsearch.client.asCurrentUser.transport.request).not.toHaveBeenCalled();
    expect(authenticationService.login).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: { name: 'aliyun_oauth' },
        value: expect.objectContaining({
          signedToken: 'signed-token',
        }),
      })
    );
  });
});
