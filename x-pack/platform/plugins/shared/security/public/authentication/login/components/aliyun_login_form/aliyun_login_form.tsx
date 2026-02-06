/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  EuiButton,
  EuiCallOut,
  EuiFlexGroup,
  EuiFlexItem,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSpacer,
  EuiText,
} from '@elastic/eui';
import React, { Component, Fragment } from 'react';

import type { HttpStart, NotificationsStart } from '@kbn/core/public';
import { i18n } from '@kbn/i18n';
import { FormattedMessage } from '@kbn/i18n-react';

interface Props {
  http: HttpStart;
  notifications: NotificationsStart;
  onSuccess: () => void;
}

interface State {
  message:
    | { type: 'none' }
    | { type: 'danger' | 'info'; content: string };
  isLoading: boolean;
}

export class AliyunLoginForm extends Component<Props, State> {
  state: State = {
    message: { type: 'none' as const },
    isLoading: false,
  };

  componentDidMount() {
    // Check if this is a callback from Aliyun OAuth
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const error = urlParams.get('error');

    if (error) {
      this.setState({
        message: {
          type: 'danger',
          content: i18n.translate('xpack.security.login.aliyun.oauthError', {
            defaultMessage: 'Authentication was cancelled or failed. Please try again.',
          }),
        },
      });
    } else if (code) {
      // This is an OAuth callback, process it
      this.handleOAuthCallback(code);
    }
  }

  private handleOAuthCallback = async (code: string) => {
    this.setState({ isLoading: true });

    try {
      await this.props.http.post('/api/security/aliyun/oauth/callback', {
        query: {
          code,
          state: new URLSearchParams(window.location.search).get('state') || '/',
        },
      });

      // If successful, the server will handle redirect
      this.props.onSuccess();
    } catch (err: any) {
      this.setState({
        isLoading: false,
        message: {
          type: 'danger',
          content:
            err?.body?.message ||
            i18n.translate('xpack.security.login.aliyun.authenticationFailed', {
              defaultMessage: 'Authentication failed. Please try again.',
            }),
        },
      });
    }
  };

  private initiateOAuthLogin = async () => {
    this.setState({ isLoading: true, message: { type: 'none' as const } });

    try {
      // Get the authorization URL from the server
      const redirectTarget = window.location.pathname + window.location.search;
      const result = await this.props.http.get<{ authorizationUrl: string; state: string }>(
        '/api/security/aliyun/oauth/authorize',
        {
          query: {
            redirect_to: redirectTarget !== '/login' ? redirectTarget : undefined,
          },
        }
      );

      // Redirect to Aliyun authorization page
      if (result.authorizationUrl) {
        window.location.href = result.authorizationUrl;
      }
    } catch (err: any) {
      this.setState({
        isLoading: false,
        message: {
          type: 'danger',
          content:
            err?.body?.message ||
            i18n.translate('xpack.security.login.aliyun.initFailed', {
              defaultMessage: 'Failed to initialize Aliyun authentication. Please try again.',
            }),
        },
      });
    }
  };

  private renderMessage = () => {
    const { message } = this.state;
    if (message.type === 'danger') {
      return (
        <Fragment>
          <EuiCallOut
            size="s"
            color="danger"
            data-test-subj="loginErrorMessage"
            title={message.content}
            role="alert"
          />
          <EuiSpacer size="l" />
        </Fragment>
      );
    }

    if (message.type === 'info') {
      return (
        <Fragment>
          <EuiCallOut
            size="s"
            color="primary"
            data-test-subj="loginInfoMessage"
            title={message.content}
            role="status"
          />
          <EuiSpacer size="l" />
        </Fragment>
      );
    }

    return null;
  };

  public render() {
    return (
      <Fragment>
        {this.renderMessage()}
        <EuiPanel data-test-subj="aliyunLoginForm" color="transparent">
          <EuiFlexGroup responsive={false} alignItems="center" gutterSize="s" direction="column">
            <EuiFlexItem>
              <EuiText textAlign="center">
                <p>
                  <FormattedMessage
                    id="xpack.security.login.aliyun.description"
                    defaultMessage="You will be redirected to Aliyun to sign in securely."
                  />
                </p>
              </EuiText>
            </EuiFlexItem>

            <EuiSpacer />

            <EuiFlexItem>
              <EuiButton
                fill
                size="l"
                onClick={this.initiateOAuthLogin}
                isDisabled={this.state.isLoading}
                isLoading={this.state.isLoading}
                data-test-subj="aliyunLoginSubmit"
              >
                <FormattedMessage
                  id="xpack.security.login.aliyun.logInButtonLabel"
                  defaultMessage="Log in with Aliyun RAM"
                />
              </EuiButton>
            </EuiFlexItem>

            {this.state.isLoading && (
              <EuiFlexItem grow={false}>
                <EuiLoadingSpinner size="m" />
              </EuiFlexItem>
            )}
          </EuiFlexGroup>
        </EuiPanel>

        <EuiSpacer size="xl" />

        <EuiText color="subdued" size="s">
          <p>
            <FormattedMessage
              id="xpack.security.login.aliyun.helpText"
              defaultMessage="By clicking the button above, you'll be securely redirected to Aliyun RAM for authentication."
            />
          </p>
        </EuiText>
      </Fragment>
    );
  }
}
