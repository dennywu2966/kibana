/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { URL } from 'url';

import type { Type } from '@kbn/config-schema';
import { kibanaResponseFactory } from '@kbn/core/server';
import type { RequestHandler, RouteConfig } from '@kbn/core/server';
import { coreMock, httpServerMock } from '@kbn/core/server/mocks';

import { defineAliyunOAuthRoutes } from './aliyun_oauth';
import type { SecurityRequestHandlerContext, SecurityRouter } from '../../types';
import { routeDefinitionParamsMock } from '../index.mock';

describe('Aliyun OAuth authentication routes', () => {
  let router: jest.Mocked<SecurityRouter>;
  let mockContext: SecurityRequestHandlerContext;
  let originalCallbackPath: string | undefined;
  let originalRedirectUri: string | undefined;
  let originalFetch: typeof global.fetch | undefined;

  beforeAll(() => {
    originalCallbackPath = process.env.ALIYUN_OAUTH_CALLBACK_PATH;
    originalRedirectUri = process.env.ALIYUN_OAUTH_REDIRECT_URI;
    originalFetch = global.fetch;
  });

  beforeEach(() => {
    delete process.env.ALIYUN_OAUTH_CALLBACK_PATH;
    delete process.env.ALIYUN_OAUTH_REDIRECT_URI;

    const routeParamsMock = routeDefinitionParamsMock.create({
      authc: {
        providers: {
          aliyun: {
            aliyun: {
              order: 0,
              oauth: {
                clientId: 'test-client-id',
              },
            },
          },
        },
      },
    });

    router = routeParamsMock.router;
    defineAliyunOAuthRoutes(routeParamsMock);

    mockContext = coreMock.createCustomRequestHandlerContext({
      licensing: {
        license: {
          check: jest.fn().mockReturnValue({ check: 'valid' }),
        },
      },
    }) as unknown as SecurityRequestHandlerContext;
  });

  afterAll(() => {
    if (originalCallbackPath) {
      process.env.ALIYUN_OAUTH_CALLBACK_PATH = originalCallbackPath;
    } else {
      delete process.env.ALIYUN_OAUTH_CALLBACK_PATH;
    }

    if (originalRedirectUri) {
      process.env.ALIYUN_OAUTH_REDIRECT_URI = originalRedirectUri;
    } else {
      delete process.env.ALIYUN_OAUTH_REDIRECT_URI;
    }

    global.fetch = originalFetch!;
  });

  describe('authorize route', () => {
    let routeHandler: RequestHandler<any, any, any, SecurityRequestHandlerContext>;
    let routeConfig: RouteConfig<any, any, any, any>;

    beforeEach(() => {
      const [authorizeConfig, authorizeHandler] = router.get.mock.calls.find(
        ([{ path }]) => path === '/api/security/aliyun/oauth/authorize'
      )!;

      routeConfig = authorizeConfig;
      routeHandler = authorizeHandler;
    });

    it('accepts both redirect_to and next query parameters', () => {
      const queryValidator = (routeConfig.validate as any).query as Type<any>;

      expect(queryValidator.validate({ redirect_to: '/app/discover' })).toEqual({
        redirect_to: '/app/discover',
      });
      expect(queryValidator.validate({ next: '/app/discover' })).toEqual({
        next: '/app/discover',
      });
      expect(queryValidator.validate({ redirect_to: '/a', next: '/b' })).toEqual({
        redirect_to: '/a',
        next: '/b',
      });
    });

    it('maps next query into relay_state in authorization URL', async () => {
      const request = httpServerMock.createKibanaRequest({
        query: { next: '/mock-server-basepath/app/discover' },
      });

      const response = await routeHandler(mockContext, request, kibanaResponseFactory);

      expect(response.status).toBe(200);
      const authorizationUrl = (response.payload as any).authorizationUrl as string;
      const parsed = new URL(authorizationUrl);
      expect(parsed.searchParams.get('relay_state')).toBe('/mock-server-basepath/app/discover');
    });

    it('returns a signed OAuth state token', async () => {
      const request = httpServerMock.createKibanaRequest();

      const response = await routeHandler(mockContext, request, kibanaResponseFactory);

      expect(response.status).toBe(200);
      const stateToken = (response.payload as any).state as string;
      expect(stateToken).toContain('.');
      const [payloadPart, signaturePart] = stateToken.split('.');
      expect(payloadPart.length).toBeGreaterThan(20);
      expect(signaturePart.length).toBeGreaterThan(20);
    });

    it('uses sorted provider chain to resolve OAuth config', async () => {
      const chainedRouteParams = routeDefinitionParamsMock.create({
        authc: {
          providers: {
            aliyun: {
              aliyun: {
                order: 0,
                oauth: { clientId: 'chain-client-id' },
              },
            },
          },
        },
      });

      // Simulate a config where no aliyun provider is enabled in sorted chain.
      (chainedRouteParams.config.authc as any).sortedProviders = Object.freeze([]);

      defineAliyunOAuthRoutes(chainedRouteParams);
      const [, authorizeHandlerFromChain] = chainedRouteParams.router.get.mock.calls.find(
        ([{ path }]) => path === '/api/security/aliyun/oauth/authorize'
      )!;

      const request = httpServerMock.createKibanaRequest();
      const response = await authorizeHandlerFromChain(
        mockContext,
        request,
        kibanaResponseFactory
      );

      expect(response.status).toBe(500);
    });

    it('drops unsafe absolute redirect targets', async () => {
      const request = httpServerMock.createKibanaRequest({
        query: { next: 'https://evil.example/path' },
      });

      const response = await routeHandler(mockContext, request, kibanaResponseFactory);

      expect(response.status).toBe(200);
      const authorizationUrl = (response.payload as any).authorizationUrl as string;
      const parsed = new URL(authorizationUrl);
      expect(parsed.searchParams.get('relay_state')).toBeNull();
    });
  });

  describe('callback route', () => {
    it('registers both API and legacy callback paths', () => {
      const callbackPaths = router.get.mock.calls
        .map(([config]) => config.path)
        .filter((path) => path.includes('/aliyun/oauth/callback'));

      expect(callbackPaths).toEqual(
        expect.arrayContaining([
          '/api/security/aliyun/oauth/callback',
          '/kibana/internal/security/aliyun/oauth/callback',
        ])
      );
    });

    it('redirects to login auth error when state is missing', async () => {
      const [, callbackHandler] = router.get.mock.calls.find(
        ([{ path }]) => path === '/api/security/aliyun/oauth/callback'
      )!;

      const request = httpServerMock.createKibanaRequest({
        query: {
          code: 'dummy-auth-code',
          relay_state: '/mock-server-basepath/app/discover',
        },
      });

      const response = await callbackHandler(mockContext, request, kibanaResponseFactory);

      expect(response.status).toBe(302);
      expect(response.options).toEqual({
        headers: {
          location:
            '/mock-server-basepath/login?msg=AUTHENTICATION_ERROR&next=%2Fmock-server-basepath%2Fapp%2Fdiscover',
        },
      });
    });

    it('redirects to login auth error when state signature is invalid', async () => {
      const [authorizeConfig, authorizeHandler] = router.get.mock.calls.find(
        ([{ path }]) => path === '/api/security/aliyun/oauth/authorize'
      )!;
      const [, callbackHandler] = router.get.mock.calls.find(
        ([{ path }]) => path === '/api/security/aliyun/oauth/callback'
      )!;

      const authorizeRequest = httpServerMock.createKibanaRequest({
        query: { next: '/mock-server-basepath/app/discover' },
      });
      const authorizeResponse = await authorizeHandler(
        mockContext,
        authorizeRequest,
        kibanaResponseFactory
      );
      expect(authorizeResponse.status).toBe(200);

      const validStateToken = (authorizeResponse.payload as any).state as string;
      const tamperedStateToken = `${validStateToken}tampered`;

      const callbackRequest = httpServerMock.createKibanaRequest({
        query: {
          code: 'dummy-auth-code',
          state: tamperedStateToken,
          relay_state: '/mock-server-basepath/app/discover',
        },
      });

      const callbackResponse = await callbackHandler(
        mockContext,
        callbackRequest,
        kibanaResponseFactory
      );

      expect(callbackResponse.status).toBe(302);
      expect(callbackResponse.options).toEqual({
        headers: {
          location:
            '/mock-server-basepath/login?msg=AUTHENTICATION_ERROR&next=%2Fmock-server-basepath%2Fapp%2Fdiscover',
        },
      });
    });

    it('redirects to auth error when token exchange is aborted and uses AbortSignal', async () => {
      const [, authorizeHandler] = router.get.mock.calls.find(
        ([{ path }]) => path === '/api/security/aliyun/oauth/authorize'
      )!;
      const [, callbackHandler] = router.get.mock.calls.find(
        ([{ path }]) => path === '/api/security/aliyun/oauth/callback'
      )!;

      const authorizeRequest = httpServerMock.createKibanaRequest({
        query: { next: '/mock-server-basepath/app/discover' },
      });
      const authorizeResponse = await authorizeHandler(
        mockContext,
        authorizeRequest,
        kibanaResponseFactory
      );
      expect(authorizeResponse.status).toBe(200);
      const state = (authorizeResponse.payload as any).state as string;

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      const fetchMock = jest.fn().mockRejectedValue(abortError);
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const callbackRequest = httpServerMock.createKibanaRequest({
        query: {
          code: 'dummy-auth-code',
          state,
          relay_state: '/mock-server-basepath/app/discover',
        },
      });

      const callbackResponse = await callbackHandler(
        mockContext,
        callbackRequest,
        kibanaResponseFactory
      );

      expect(callbackResponse.status).toBe(302);
      expect(callbackResponse.options).toEqual({
        headers: {
          location:
            '/mock-server-basepath/login?msg=AUTHENTICATION_ERROR&next=%2Fmock-server-basepath%2Fapp%2Fdiscover',
        },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(Object),
        })
      );
    });

    it('redirects to auth error when token endpoint returns non-JSON payload', async () => {
      const [, authorizeHandler] = router.get.mock.calls.find(
        ([{ path }]) => path === '/api/security/aliyun/oauth/authorize'
      )!;
      const [, callbackHandler] = router.get.mock.calls.find(
        ([{ path }]) => path === '/api/security/aliyun/oauth/callback'
      )!;

      const authorizeRequest = httpServerMock.createKibanaRequest({
        query: { next: '/mock-server-basepath/app/discover' },
      });
      const authorizeResponse = await authorizeHandler(
        mockContext,
        authorizeRequest,
        kibanaResponseFactory
      );
      expect(authorizeResponse.status).toBe(200);
      const state = (authorizeResponse.payload as any).state as string;

      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        statusText: 'OK',
        json: jest.fn().mockRejectedValue(new Error('Unexpected token < in JSON')),
      });
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const callbackRequest = httpServerMock.createKibanaRequest({
        query: {
          code: 'dummy-auth-code',
          state,
          relay_state: '/mock-server-basepath/app/discover',
        },
      });

      const callbackResponse = await callbackHandler(
        mockContext,
        callbackRequest,
        kibanaResponseFactory
      );

      expect(callbackResponse.status).toBe(302);
      expect(callbackResponse.options).toEqual({
        headers: {
          location:
            '/mock-server-basepath/login?msg=AUTHENTICATION_ERROR&next=%2Fmock-server-basepath%2Fapp%2Fdiscover',
        },
      });
    });
  });
});
