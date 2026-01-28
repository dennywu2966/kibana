/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';

import type { ScopeableRequest } from '@kbn/core/server';
import { elasticsearchServiceMock, httpServerMock } from '@kbn/core/server/mocks';

import { mockAuthenticationProviderOptions } from './base.mock';
import { AliyunAuthenticationProvider } from './aliyun';
import { mockAuthenticatedUser } from '../../../common/model/authenticated_user.mock';
import { securityMock } from '../../mocks';
import { AuthenticationResult } from '../authentication_result';
import { DeauthenticationResult } from '../deauthentication_result';

function expectAuthenticateCall(
  mockClusterClient: ReturnType<typeof elasticsearchServiceMock.createClusterClient>,
  scopeableRequest: ScopeableRequest
) {
  expect(mockClusterClient.asScoped).toHaveBeenCalledTimes(1);
  expect(mockClusterClient.asScoped).toHaveBeenCalledWith(scopeableRequest);

  const mockScopedClusterClient = mockClusterClient.asScoped.mock.results[0].value;
  expect(mockScopedClusterClient.asCurrentUser.security.authenticate).toHaveBeenCalledTimes(1);
}

describe('AliyunAuthenticationProvider', () => {
  let provider: AliyunAuthenticationProvider;
  let mockOptions: ReturnType<typeof mockAuthenticationProviderOptions>;
  beforeEach(() => {
    mockOptions = mockAuthenticationProviderOptions({ name: 'aliyun1' });
    mockOptions.urls.loggedOut.mockReturnValue('/some-logged-out-page');

    provider = new AliyunAuthenticationProvider(mockOptions);
  });

  it('should have type "aliyun"', () => {
    expect(AliyunAuthenticationProvider.type).toBe('aliyun');
  });

  describe('`login` method', () => {
    it('succeeds with valid login attempt, creates session and authHeaders', async () => {
      const user = mockAuthenticatedUser();
      const loginAttempt = { signedToken: 'test-signed-token' };
      const authHeaders = { 'X-ES-IAM-Signed': 'test-signed-token' };

      const mockScopedClusterClient = elasticsearchServiceMock.createScopedClusterClient();
      mockScopedClusterClient.asCurrentUser.security.authenticate.mockResponse(user);
      mockOptions.client.asScoped.mockReturnValue(mockScopedClusterClient);

      const result = await provider.login(
        httpServerMock.createKibanaRequest({ headers: {} }),
        loginAttempt
      );

      // Check that authentication succeeded
      expect(result.succeeded()).toBe(true);
      expect(result.user?.username).toBe(user.username);
      expect(result.authHeaders).toEqual(authHeaders);
      expect(result.state).toEqual({ authorization: 'test-signed-token' });
      expect(result.user?.authentication_provider).toEqual({
        type: 'aliyun',
        name: 'aliyun1',
      });

      expectAuthenticateCall(mockOptions.client, { headers: authHeaders });
    });

    it('fails if user cannot be retrieved during login attempt', async () => {
      const request = httpServerMock.createKibanaRequest({ headers: {} });
      const loginAttempt = { signedToken: 'test-signed-token' };
      const authHeaders = { 'X-ES-IAM-Signed': 'test-signed-token' };

      const authenticationError = new errors.ResponseError(
        securityMock.createApiResponse({ body: {} })
      );
      const mockScopedClusterClient = elasticsearchServiceMock.createScopedClusterClient();
      mockScopedClusterClient.asCurrentUser.security.authenticate.mockRejectedValue(
        authenticationError
      );
      mockOptions.client.asScoped.mockReturnValue(mockScopedClusterClient);

      await expect(provider.login(request, loginAttempt)).resolves.toEqual(
        AuthenticationResult.failed(authenticationError)
      );

      expectAuthenticateCall(mockOptions.client, { headers: authHeaders });

      expect(request.headers).not.toHaveProperty('x-es-iam-signed');
    });
  });

  describe('`authenticate` method', () => {
    it('does not redirect AJAX requests that can not be authenticated to the login page.', async () => {
      // Add `kbn-xsrf` header to make `can_redirect_request` think that it's AJAX request and
      // avoid triggering of redirect logic.
      await expect(
        provider.authenticate(
          httpServerMock.createKibanaRequest({ headers: { 'kbn-xsrf': 'xsrf' } }),
          null
        )
      ).resolves.toEqual(AuthenticationResult.notHandled());
    });

    it('does not redirect requests that do not require authentication to the login page.', async () => {
      await expect(
        provider.authenticate(httpServerMock.createKibanaRequest({ routeAuthRequired: false }))
      ).resolves.toEqual(AuthenticationResult.notHandled());
    });

    it('redirects non-AJAX requests that can not be authenticated to the login page.', async () => {
      await expect(
        provider.authenticate(
          httpServerMock.createKibanaRequest({
            path: '/s/foo/some path that needs to be encoded',
          }),
          null
        )
      ).resolves.toEqual(
        AuthenticationResult.redirectTo(
          '/mock-server-basepath/login?next=%2Fmock-server-basepath%2Fs%2Ffoo%2Fsome%2520path%2520that%2520needs%2520to%2520be%2520encoded'
        )
      );
    });

    it('does not handle authentication if state exists, but authorization property is missing.', async () => {
      // When state exists but authorization is missing, provider should redirect
      await expect(
        provider.authenticate(httpServerMock.createKibanaRequest(), {})
      ).resolves.toEqual(
        AuthenticationResult.redirectTo('/mock-server-basepath/login?next=%2Fmock-server-basepath%2Fpath')
      );
    });

    it('succeeds if only state is available.', async () => {
      const request = httpServerMock.createKibanaRequest({ headers: {} });
      const user = mockAuthenticatedUser();
      const authorization = 'test-signed-token';

      const mockScopedClusterClient = elasticsearchServiceMock.createScopedClusterClient();
      mockScopedClusterClient.asCurrentUser.security.authenticate.mockResponse(user);
      mockOptions.client.asScoped.mockReturnValue(mockScopedClusterClient);

      const result = await provider.authenticate(request, { authorization });

      // Check that authentication succeeded
      expect(result.succeeded()).toBe(true);
      expect(result.user?.username).toBe(user.username);
      expect(result.authHeaders).toEqual({ 'X-ES-IAM-Signed': authorization });
      expect(result.user?.authentication_provider).toEqual({
        type: 'aliyun',
        name: 'aliyun1',
      });

      expectAuthenticateCall(mockOptions.client, {
        headers: { 'X-ES-IAM-Signed': authorization },
      });
    });

    it('fails if state contains invalid credentials.', async () => {
      const request = httpServerMock.createKibanaRequest({ headers: {} });
      const authorization = 'test-signed-token';

      const authenticationError = new errors.ResponseError(
        securityMock.createApiResponse({ body: {} })
      );
      const mockScopedClusterClient = elasticsearchServiceMock.createScopedClusterClient();
      mockScopedClusterClient.asCurrentUser.security.authenticate.mockRejectedValue(
        authenticationError
      );
      mockOptions.client.asScoped.mockReturnValue(mockScopedClusterClient);

      await expect(provider.authenticate(request, { authorization })).resolves.toEqual(
        AuthenticationResult.failed(authenticationError)
      );

      expectAuthenticateCall(mockOptions.client, {
        headers: { 'X-ES-IAM-Signed': authorization },
      });

      expect(request.headers).not.toHaveProperty('x-es-iam-signed');
    });
  });

  describe('`logout` method', () => {
    it('does not handle logout if state is not present', async () => {
      await expect(provider.logout(httpServerMock.createKibanaRequest())).resolves.toEqual(
        DeauthenticationResult.notHandled()
      );
    });

    it('redirects to the logged out URL.', async () => {
      await expect(provider.logout(httpServerMock.createKibanaRequest(), {})).resolves.toEqual(
        DeauthenticationResult.redirectTo('/some-logged-out-page')
      );

      await expect(provider.logout(httpServerMock.createKibanaRequest(), null)).resolves.toEqual(
        DeauthenticationResult.redirectTo('/some-logged-out-page')
      );
    });
  });

  it('`getHTTPAuthenticationScheme` method', () => {
    expect(provider.getHTTPAuthenticationScheme()).toBe('aliyun');
  });
});
