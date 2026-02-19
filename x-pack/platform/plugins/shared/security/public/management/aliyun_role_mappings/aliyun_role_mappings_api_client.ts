/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { HttpStart } from '@kbn/core/public';
import type { IApiErrorResponse } from '@kbn/core/public';
import { i18n } from '@kbn/i18n';

export interface AliyunRoleMapping {
  id: string;
  arn: string;
  roles: string[];
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface CreateAliyunRoleMappingRequest {
  arn: string;
  roles: string[];
}

export interface AliyunRoleMappingsResponse {
  mappings: AliyunRoleMapping[];
  total: number;
}

/**
 * API client for Aliyun role mappings.
 */
export class AliyunRoleMappingsApiClient {
  constructor(private readonly http: HttpStart) {}

  /**
   * Get all Aliyun role mappings.
   */
  async getAll(): Promise<AliyunRoleMappingsResponse> {
    const response = await this.http.get<{ mappings: AliyunRoleMapping[]; total: number }>(
      '/internal/security/aliyun/role_mappings'
    );
    return response;
  }

  /**
   * Get a single Aliyun role mapping by ID.
   */
  async get(id: string): Promise<AliyunRoleMapping> {
    const response = await this.http.get<AliyunRoleMapping>(
      `/internal/security/aliyun/role_mappings/${id}`
    );
    return response;
  }

  /**
   * Create a new Aliyun role mapping.
   */
  async create(request: CreateAliyunRoleMappingRequest): Promise<AliyunRoleMapping> {
    const response = await this.http.post<AliyunRoleMapping>(
      '/internal/security/aliyun/role_mappings',
      { body: JSON.stringify(request) }
    );
    return response;
  }

  /**
   * Update an existing Aliyun role mapping.
   */
  async update(id: string, request: CreateAliyunRoleMappingRequest): Promise<AliyunRoleMapping> {
    const response = await this.http.put<AliyunRoleMapping>(
      `/internal/security/aliyun/role_mappings/${id}`,
      { body: JSON.stringify(request) }
    );
    return response;
  }

  /**
   * Delete an Aliyun role mapping.
   */
  async delete(id: string): Promise<void> {
    await this.http.delete(`/internal/security/aliyun/role_mappings/${id}`);
  }

  /**
   * Check if an error is a conflict error (duplicate ARN).
   */
  isConflictError(error: IApiErrorResponse): boolean {
    return error.statusCode === 409;
  }
}
