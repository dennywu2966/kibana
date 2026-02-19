/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';

import { BaseAuthenticationProvider } from './base';
import {
  buildAliyunAuthHeaders,
  buildAliyunProviderState,
  getAliyunAuthCandidatesFromState,
  type AliyunProviderState,
} from './aliyun_state';
import { NEXT_URL_QUERY_STRING_PARAMETER } from '../../../common/constants';
import { getDetailedErrorMessage } from '../../errors';
import { AuthenticationResult } from '../authentication_result';
import { canRedirectRequest } from '../can_redirect_request';
import { DeauthenticationResult } from '../deauthentication_result';

/**
 * Describes the parameters that are required by the provider to process the initial login request.
 */
interface ProviderLoginAttempt {
  signedToken?: string;
  accessToken?: string;
  redirectURL?: string;
}

/**
 * Checks whether current request can initiate new session.
 * @param request Request instance.
 */
function canStartNewSession(request: KibanaRequest) {
  // We should try to establish new session only if request requires authentication and client
  // can be redirected to the login page where they can enter their credentials.
  return canRedirectRequest(request) && request.route.options.authRequired === true;
}

/**
 * Provider that supports request authentication via Aliyun IAM.
 */
export class AliyunAuthenticationProvider extends BaseAuthenticationProvider {
  /**
   * Type of the provider.
   */
  static readonly type = 'aliyun';

  /**
   * Performs initial login request using Aliyun IAM signed token or OAuth access token.
   * @param request Request instance.
   * @param attempt Login attempt description with signed token or access token.
   * @param [state] Optional state object associated with the provider.
   */
  public async login(
    request: KibanaRequest,
    { signedToken, accessToken, redirectURL }: ProviderLoginAttempt,
    state?: AliyunProviderState | null
  ) {
    this.logger.debug('Trying to perform Aliyun login.');

    // OAuth token path - use the access token obtained from OAuth flow
    if (accessToken) {
      this.logger.debug('Performing Aliyun OAuth login.');

      const credential = { mode: 'oauth', accessToken } as const;
      const authHeaders = buildAliyunAuthHeaders(credential);

      try {
        const user = await this.getUser(request, authHeaders);

        this.logger.debug('Aliyun OAuth login successful.');
        // Return redirectTo() like OIDC does, so the callback handler can use response.redirected()
        // This ensures Hapi properly includes the session cookies in the redirect response
        const finalRedirectURL = redirectURL || `${this.options.basePath.get(request)}/`;
        return AuthenticationResult.redirectTo(finalRedirectURL, {
          user,
          authHeaders,
          state: buildAliyunProviderState(credential),
        });
      } catch (err) {
        this.logger.debug(() => `Failed Aliyun OAuth login: ${getDetailedErrorMessage(err)}`);
        return AuthenticationResult.failed(err);
      }
    }

    // IAM/STS signed token path (original behavior)
    if (signedToken) {
      this.logger.debug('Performing Aliyun IAM/STS login.');

      const credential = { mode: 'iam', signedToken } as const;
      const authHeaders = buildAliyunAuthHeaders(credential);

      try {
        const user = await this.getUser(request, authHeaders);

        this.logger.debug('Aliyun IAM login successful.');
        return AuthenticationResult.succeeded(user, {
          authHeaders,
          state: buildAliyunProviderState(credential),
        });
      } catch (err) {
        this.logger.debug(() => `Failed Aliyun IAM login: ${getDetailedErrorMessage(err)}`);
        return AuthenticationResult.failed(err);
      }
    }

    return AuthenticationResult.failed(new Error('No valid credentials provided'));
  }

  /**
   * Performs request authentication using Aliyun IAM signed token.
   * @param request Request instance.
   * @param [state] Optional state object associated with the provider.
   */
  public async authenticate(request: KibanaRequest, state?: AliyunProviderState | null) {
    this.logger.debug(`Aliyun authenticate: ${request.url.pathname}`);

    const authCandidates = getAliyunAuthCandidatesFromState(state);
    if (authCandidates.length > 0) {
      let latestError: unknown;
      for (const candidate of authCandidates) {
        try {
          const { authHeaders } = candidate;
          const user = await this.getUser(request, authHeaders);

          this.logger.debug('Request has been authenticated via state.');
          return AuthenticationResult.succeeded(user, { authHeaders });
        } catch (err) {
          latestError = err;
          this.logger.debug(
            () => `Aliyun ${candidate.mode} auth failed: ${getDetailedErrorMessage(err)}`
          );
        }
      }

      if (latestError instanceof Error) {
        return AuthenticationResult.failed(latestError);
      }

      return AuthenticationResult.failed(new Error('Aliyun authentication failed'));
    }

    // If state isn't present let's redirect user to the login page.
    if (canStartNewSession(request)) {
      this.logger.debug('Redirecting request to Login page.');
      const basePath = this.options.basePath.get(request);
      return AuthenticationResult.redirectTo(
        `${basePath}/login?${NEXT_URL_QUERY_STRING_PARAMETER}=${encodeURIComponent(
          `${basePath}${request.url.pathname}${request.url.search}`
        )}`
      );
    }

    return AuthenticationResult.notHandled();
  }

  /**
   * Redirects user to the logged out page.
   * @param request Request instance.
   * @param [state] Optional state object associated with the provider.
   */
  public async logout(request: KibanaRequest, state?: AliyunProviderState | null) {
    this.logger.debug(`Trying to log user out via ${request.url.pathname}${request.url.search}.`);

    // Having a `null` state means that provider was specifically called to do a logout, but when
    // session isn't defined then provider is just being probed whether or not it can perform logout.
    if (state === undefined) {
      return DeauthenticationResult.notHandled();
    }

    return DeauthenticationResult.redirectTo(this.options.urls.loggedOut(request));
  }

  /**
   * Returns HTTP authentication scheme (`aliyun`) that's used within `X-ES-IAM-Signed` HTTP header
   * that provider attaches to all successfully authenticated requests to Elasticsearch.
   */
  public getHTTPAuthenticationScheme() {
    return 'aliyun';
  }
}
