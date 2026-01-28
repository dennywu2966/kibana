/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';

import { BaseAuthenticationProvider } from './base';
import { NEXT_URL_QUERY_STRING_PARAMETER } from '../../../common/constants';
import { getDetailedErrorMessage } from '../../errors';
import { AuthenticationResult } from '../authentication_result';
import { canRedirectRequest } from '../can_redirect_request';
import { DeauthenticationResult } from '../deauthentication_result';

/**
 * Describes the parameters that are required by the provider to process the initial login request.
 */
interface ProviderLoginAttempt {
  signedToken: string;
}

/**
 * The state supported by the provider.
 */
interface ProviderState {
  /**
   * Content of the IAM signed token that should be provided with every request to the
   * Elasticsearch on behalf of the authenticated user.
   */
  authorization?: string;
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
   * Performs initial login request using Aliyun IAM signed token.
   * @param request Request instance.
   * @param attempt Login attempt description with signed token.
   * @param [state] Optional state object associated with the provider.
   */
  public async login(
    request: KibanaRequest,
    { signedToken }: ProviderLoginAttempt,
    state?: ProviderState | null
  ) {
    this.logger.debug('Trying to perform Aliyun IAM login.');

    const authHeaders = {
      'X-ES-IAM-Signed': signedToken,
    };

    try {
      const user = await this.getUser(request, authHeaders);

      this.logger.debug('Aliyun IAM login successful.');
      return AuthenticationResult.succeeded(user, {
        authHeaders,
        state: { authorization: signedToken },
      });
    } catch (err) {
      this.logger.debug(() => `Failed Aliyun IAM login: ${getDetailedErrorMessage(err)}`);
      return AuthenticationResult.failed(err);
    }
  }

  /**
   * Performs request authentication using Aliyun IAM signed token.
   * @param request Request instance.
   * @param [state] Optional state object associated with the provider.
   */
  public async authenticate(request: KibanaRequest, state?: ProviderState | null) {
    this.logger.debug(`Aliyun authenticate: ${request.url.pathname}`);

    if (state?.authorization) {
      try {
        const authHeaders = { 'X-ES-IAM-Signed': state.authorization };
        const user = await this.getUser(request, authHeaders);

        this.logger.debug('Request has been authenticated via state.');
        return AuthenticationResult.succeeded(user, { authHeaders });
      } catch (err) {
        this.logger.debug(() => `Aliyun auth failed: ${getDetailedErrorMessage(err)}`);
        return AuthenticationResult.failed(err);
      }
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
  public async logout(request: KibanaRequest, state?: ProviderState | null) {
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
