/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AuthHeaders } from '@kbn/core/server';

import { HTTPAuthorizationHeader } from '../http_authentication';

export type AliyunAuthMode = 'oauth' | 'iam';

export interface AliyunOAuthCredential {
  mode: 'oauth';
  accessToken: string;
}

export interface AliyunIAMCredential {
  mode: 'iam';
  signedToken: string;
}

export type AliyunCredential = AliyunOAuthCredential | AliyunIAMCredential;

export interface AliyunProviderStateV2 {
  version: 2;
  mode: AliyunAuthMode;
  authHeaders: AuthHeaders;
}

export interface AliyunProviderStateLegacy {
  authorization?: string;
  authorizationType?: AliyunAuthMode;
}

export type AliyunProviderState = AliyunProviderStateV2 | AliyunProviderStateLegacy;

export function buildAliyunAuthHeaders(credential: AliyunCredential): AuthHeaders {
  if (credential.mode === 'oauth') {
    return {
      authorization: new HTTPAuthorizationHeader('Bearer', credential.accessToken).toString(),
    };
  }

  return {
    'X-ES-IAM-Signed': credential.signedToken,
  };
}

export function buildAliyunProviderState(credential: AliyunCredential): AliyunProviderStateV2 {
  return {
    version: 2,
    mode: credential.mode,
    authHeaders: buildAliyunAuthHeaders(credential),
  };
}

export interface AliyunAuthCandidate {
  mode: AliyunAuthMode;
  authHeaders: AuthHeaders;
}

export function getAliyunAuthCandidatesFromState(
  state?: AliyunProviderState | null
): AliyunAuthCandidate[] {
  if (!state) {
    return [];
  }

  if (
    'version' in state &&
    state.version === 2 &&
    state.authHeaders &&
    typeof state.authHeaders === 'object'
  ) {
    return [{ mode: state.mode, authHeaders: state.authHeaders }];
  }

  // Legacy state shape migration path.
  if ('authorization' in state && state.authorization) {
    if (state.authorizationType === 'oauth') {
      return [
        {
          mode: 'oauth',
          authHeaders: {
            authorization: new HTTPAuthorizationHeader('Bearer', state.authorization).toString(),
          },
        },
      ];
    }

    if (state.authorizationType === 'iam') {
      return [{ mode: 'iam', authHeaders: { 'X-ES-IAM-Signed': state.authorization } }];
    }

    // Deterministic fallback for legacy sessions that don't carry explicit mode.
    return [
      {
        mode: 'oauth',
        authHeaders: {
          authorization: new HTTPAuthorizationHeader('Bearer', state.authorization).toString(),
        },
      },
      {
        mode: 'iam',
        authHeaders: { 'X-ES-IAM-Signed': state.authorization },
      },
    ];
  }

  return [];
}
