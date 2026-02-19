/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import type { EuiBasicTableColumn } from '@elastic/eui';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiConfirmModal,
  EuiFlexGroup,
  EuiFlexItem,
  EuiInMemoryTable,
  EuiLink,
  EuiPageHeader,
  EuiPageSection,
  EuiSpacer,
} from '@elastic/eui';
import React, { Component, RefObject } from 'react';

import type { CoreStart, NotificationsStart } from '@kbn/core/public';
import { i18n } from '@kbn/i18n';
import { FormattedMessage } from '@kbn/i18n-react';

import type {
  AliyunRoleMapping,
  CreateAliyunRoleMappingRequest,
} from './aliyun_role_mappings_api_client';
import { AliyunRoleMappingsApiClient } from './aliyun_role_mappings_api_client';

interface Props {
  http: CoreStart['http'];
  notifications: NotificationsStart;
}

interface State {
  mappings: AliyunRoleMapping[];
  isLoading: boolean;
  error: string | null;
  isDeleteModalVisible: boolean;
  deleteMappingId: string | null;
  isEditModalVisible: boolean;
  editMapping: AliyunRoleMapping | null;
}

export class AliyunRoleMappingsGridPage extends Component<Props, State> {
  private tableRef: RefObject<EuiInMemoryTable<any>>;

  constructor(props: Props) {
    super(props);
    this.state = {
      mappings: [],
      isLoading: true,
      error: null,
      isDeleteModalVisible: false,
      deleteMappingId: null,
      isEditModalVisible: false,
      editMapping: null,
    };
    this.tableRef = React.createRef();
  }

  public componentDidMount() {
    this.loadMappings();
  }

  private loadMappings = async () => {
    this.setState({ isLoading: true, error: null });
    try {
      const apiClient = new AliyunRoleMappingsApiClient(this.props.http);
      const response = await apiClient.getAll();
      this.setState({ mappings: response.mappings, isLoading: false });
    } catch (err: any) {
      const errorMessage = err?.body?.message || err?.message || 'Failed to load role mappings';
      this.setState({ error: errorMessage, isLoading: false });
      this.props.notifications.toasts.addDanger(errorMessage, {
        title: i18n.translate('xpack.security.management.aliyunRoleMappings.loadErrorTitle', {
          defaultMessage: 'Error loading role mappings',
        }),
      });
    }
  };

  private handleDelete = async () => {
    const { deleteMappingId } = this.state;
    if (!deleteMappingId) return;

    try {
      const apiClient = new AliyunRoleMappingsApiClient(this.props.http);
      await apiClient.delete(deleteMappingId);

      this.props.notifications.toasts.addSuccess(
        i18n.translate('xpack.security.management.aliyunRoleMappings.deleteSuccessTitle', {
          defaultMessage: 'Role mapping deleted',
        })
      );

      this.setState({ isDeleteModalVisible: false, deleteMappingId: null });
      this.loadMappings();
    } catch (err: any) {
      const errorMessage = err?.body?.message || err?.message || 'Failed to delete role mapping';
      this.props.notifications.toasts.addDanger(errorMessage, {
        title: i18n.translate('xpack.security.management.aliyunRoleMappings.deleteErrorTitle', {
          defaultMessage: 'Error deleting role mapping',
        }),
      });
    }
  };

  private showDeleteModal = (mapping: AliyunRoleMapping) => {
    this.setState({
      isDeleteModalVisible: true,
      deleteMappingId: mapping.id,
    });
  };

  private closeDeleteModal = () => {
    this.setState({ isDeleteModalVisible: false, deleteMappingId: null });
  };

  private showEditModal = (mapping: AliyunRoleMapping) => {
    this.setState({
      isEditModalVisible: true,
      editMapping: mapping,
    });
  };

  private closeEditModal = () => {
    this.setState({ isEditModalVisible: false, editMapping: null });
  };

  private handleCreateOrUpdate = async (request: CreateAliyunRoleMappingRequest) => {
    const { editMapping } = this.state;
    try {
      const apiClient = new AliyunRoleMappingsApiClient(this.props.http);

      if (editMapping) {
        await apiClient.update(editMapping.id, request);
        this.props.notifications.toasts.addSuccess(
          i18n.translate('xpack.security.management.aliyunRoleMappings.updateSuccessTitle', {
            defaultMessage: 'Role mapping updated',
          })
        );
      } else {
        await apiClient.create(request);
        this.props.notifications.toasts.addSuccess(
          i18n.translate('xpack.security.management.aliyunRoleMappings.createSuccessTitle', {
            defaultMessage: 'Role mapping created',
          })
        );
      }

      this.closeEditModal();
      this.loadMappings();
    } catch (err: any) {
      const errorMessage = err?.body?.message || err?.message || 'Failed to save role mapping';
      this.props.notifications.toasts.addDanger(errorMessage, {
        title: i18n.translate('xpack.security.management.aliyunRoleMappings.saveErrorTitle', {
          defaultMessage: 'Error saving role mapping',
        }),
      });
      throw err;
    }
  };

  private get columns(): EuiBasicTableColumn<AliyunRoleMapping, any>[] {
    return [
      {
        field: 'arn',
        name: i18n.translate('xpack.security.management.aliyunRoleMappings.arnColumnTitle', {
          defaultMessage: 'Aliyun RAM ARN',
        }),
        sortable: true,
        truncateText: true,
        render: (arn: string) => (
          <EuiLink onClick={() => {}}>{arn}</EuiLink>
        ),
      },
      {
        field: 'roles',
        name: i18n.translate('xpack.security.management.aliyunRoleMappings.rolesColumnTitle', {
          defaultMessage: 'Kibana Roles',
        }),
        truncateText: true,
        render: (roles: string[]) => roles.join(', '),
      },
      {
        field: 'created_at',
        name: i18n.translate('xpack.security.management.aliyunRoleMappings.createdColumnTitle', {
          defaultMessage: 'Created',
        }),
        width: '180px',
        render: (date: string) => new Date(date).toLocaleString(),
      },
      {
        field: 'created_by',
        name: i18n.translate('xpack.security.management.aliyunRoleMappings.createdByColumnTitle', {
          defaultMessage: 'Created By',
        }),
        width: '150px',
      },
      {
        name: i18n.translate('xpack.security.management.aliyunRoleMappings.actionsColumnTitle', {
          defaultMessage: 'Actions',
        }),
        width: '150px',
        actions: [
          {
            render: (item: AliyunRoleMapping) => (
              <EuiButtonEmpty
                size="s"
                color="text"
                iconType="pencil"
                onClick={() => this.showEditModal(item)}
                aria-label={i18n.translate('xpack.security.management.aliyunRoleMappings.editAriaLabel', {
                  defaultMessage: 'Edit role mapping',
                })}
              >
                <FormattedMessage
                  id="xpack.security.management.aliyunRoleMappings.editButtonLabel"
                  defaultMessage="Edit"
                />
              </EuiButtonEmpty>
            ),
          },
          {
            render: (item: AliyunRoleMapping) => (
              <EuiButtonEmpty
                size="s"
                color="text"
                iconType="trash"
                onClick={() => this.showDeleteModal(item)}
                aria-label={i18n.translate('xpack.security.management.aliyunRoleMappings.deleteAriaLabel', {
                  defaultMessage: 'Delete role mapping',
                })}
              >
                <FormattedMessage
                  id="xpack.security.management.aliyunRoleMappings.deleteButtonLabel"
                  defaultMessage="Delete"
                />
              </EuiButtonEmpty>
            ),
          },
        ],
      },
    ];
  }

  public render() {
    const { mappings, isLoading, error, isDeleteModalVisible, isEditModalVisible, editMapping } = this.state;

    if (error) {
      return (
        <EuiPageSection alignment="center" color="danger">
          <EuiCallOut
            title={i18n.translate('xpack.security.management.aliyunRoleMappings.loadErrorTitle', {
              defaultMessage: 'Error loading role mappings',
            })}
            color="danger"
            iconType="warning"
          >
            {error}
          </EuiCallOut>
        </EuiPageSection>
      );
    }

    return (
      <>
        <EuiPageHeader
          bottomBorder
          pageTitle={
            <FormattedMessage
              id="xpack.security.management.aliyunRoleMappings.pageTitle"
              defaultMessage="Aliyun Role Mappings"
            />
          }
          description={
            <FormattedMessage
              id="xpack.security.management.aliyunRoleMappings.pageDescription"
              defaultMessage="Manage Aliyun RAM user ARN to Kibana role mappings"
            />
          }
          rightSideItems={[
            <EuiButton
              key="createButton"
              fill
              iconType="plusInCircle"
              onClick={() => this.setState({ isEditModalVisible: true, editMapping: null })}
              data-test-subj="createAliyunRoleMappingButton"
            >
              <FormattedMessage
                id="xpack.security.management.aliyunRoleMappings.createButtonLabel"
                defaultMessage="Create role mapping"
              />
            </EuiButton>,
          ]}
        />

        <EuiPageSection>
          {mappings.length === 0 && !isLoading ? (
            <EuiCallOut
              title={i18n.translate('xpack.security.management.aliyunRoleMappings.noMappingsTitle', {
                defaultMessage: 'No role mappings found',
              })}
              iconType="iInCircle"
            >
              <FormattedMessage
                id="xpack.security.management.aliyunRoleMappings.noMappingsMessage"
                defaultMessage="Create a role mapping to assign Kibana roles to Aliyun RAM users."
              />
            </EuiCallOut>
          ) : (
            <EuiInMemoryTable
              ref={this.tableRef}
              items={mappings}
              loading={isLoading}
              columns={this.columns()}
              pagination={true}
              sorting={true}
            />
          )}
        </EuiPageSection>

        {isDeleteModalVisible && (
          <EuiConfirmModal
            title={i18n.translate('xpack.security.management.aliyunRoleMappings.deleteModalTitle', {
              defaultMessage: 'Delete role mapping',
            })}
            onCancel={this.closeDeleteModal}
            onConfirm={this.handleDelete}
            cancelButtonText={i18n.translate('xpack.security.management.aliyunRoleMappings.deleteModalCancel', {
              defaultMessage: 'Cancel',
            })}
            confirmButtonText={i18n.translate('xpack.security.management.aliyunRoleMappings.deleteModalConfirm', {
              defaultMessage: 'Delete',
            })}
            buttonColor="danger"
            defaultFocusedButton="confirm"
          >
            <FormattedMessage
              id="xpack.security.management.aliyunRoleMappings.deleteModalMessage"
              defaultMessage="Are you sure you want to delete this role mapping? This action cannot be undone."
            />
          </EuiConfirmModal>
        )}

        {isEditModalVisible && (
          <AliyunRoleMappingEditModal
            mapping={editMapping}
            onCancel={this.closeEditModal}
            onSave={this.handleCreateOrUpdate}
          />
        )}
      </>
    );
  }
}

// Simple inline modal for creating/editing role mappings
interface EditModalProps {
  mapping: AliyunRoleMapping | null;
  onCancel: () => void;
  onSave: (request: CreateAliyunRoleMappingRequest) => Promise<void>;
}

function AliyunRoleMappingEditModal({ mapping, onCancel, onSave }: EditModalProps) {
  const [arn, setArn] = React.useState(mapping?.arn || '');
  const [roles, setRoles] = React.useState(mapping?.roles.join(', ') || '');
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!arn.trim()) {
      setError(i18n.translate('xpack.security.management.aliyunRoleMappings.arnRequiredError', {
        defaultMessage: 'ARN is required',
      }));
      return;
    }

    if (!roles.trim()) {
      setError(i18n.translate('xpack.security.management.aliyunRoleMappings.rolesRequiredError', {
        defaultMessage: 'At least one role is required',
      }));
      return;
    }

    const rolesList = roles.split(',').map(r => r.trim()).filter(r => r);

    if (rolesList.length === 0) {
      setError(i18n.translate('xpack.security.management.aliyunRoleMappings.rolesRequiredError', {
        defaultMessage: 'At least one role is required',
      }));
      return;
    }

    setIsSaving(true);
    try {
      await onSave({ arn: arn.trim(), roles: rolesList });
    } catch (err: any) {
      const conflict = err?.body?.message?.includes('already exists');
      if (conflict) {
        setError(i18n.translate('xpack.security.management.aliyunRoleMappings.duplicateArnError', {
          defaultMessage: 'A role mapping for this ARN already exists',
        }));
      } else {
        throw err;
      }
    } finally {
      setIsSaving(false);
    }
  };

  const title = mapping
    ? i18n.translate('xpack.security.management.aliyunRoleMappings.editMappingTitle', {
        defaultMessage: 'Edit role mapping',
      })
    : i18n.translate('xpack.security.management.aliyunRoleMappings.createMappingTitle', {
        defaultMessage: 'Create role mapping',
      });

  return (
    <EuiConfirmModal
      title={title}
      onCancel={onCancel}
      onConfirm={handleSubmit}
      cancelButtonText={i18n.translate('xpack.security.management.aliyunRoleMappings.cancelButtonLabel', {
        defaultMessage: 'Cancel',
      })}
      confirmButtonText={
        isSaving
          ? i18n.translate('xpack.security.management.aliyunRoleMappings.savingButtonLabel', {
              defaultMessage: 'Saving...',
            })
          : mapping
          ? i18n.translate('xpack.security.management.aliyunRoleMappings.updateButtonLabel', {
              defaultMessage: 'Update',
            })
          : i18n.translate('xpack.security.management.aliyunRoleMappings.createButtonLabel', {
              defaultMessage: 'Create',
            })
      }
      buttonColor="primary"
      defaultFocusedButton="confirm"
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <EuiCallOut color="danger" size="s" iconType="warning">
            {error}
          </EuiCallOut>
        )}

        <EuiFlexGroup direction="column" gutterSize="m">
          <EuiFlexItem>
            <label>
              <FormattedMessage
                id="xpack.security.management.aliyunRoleMappings.arnLabel"
                defaultMessage="Aliyun RAM ARN"
              />
            </label>
            <input
              type="text"
              className="euiFieldText"
              value={arn}
              onChange={(e) => setArn(e.target.value)}
              placeholder={i18n.translate('xpack.security.management.aliyunRoleMappings.arnPlaceholder', {
                defaultMessage: 'acs:ram::123456789012:user/test-user',
              })}
              disabled={isSaving}
              style={{ width: '100%' }}
            />
          </EuiFlexItem>

          <EuiFlexItem>
            <label>
              <FormattedMessage
                id="xpack.security.management.aliyunRoleMappings.rolesLabel"
                defaultMessage="Kibana Roles"
              />
            </label>
            <input
              type="text"
              className="euiFieldText"
              value={roles}
              onChange={(e) => setRoles(e.target.value)}
              placeholder={i18n.translate('xpack.security.management.aliyunRoleMappings.rolesPlaceholder', {
                defaultMessage: 'kibana_admin, read_only',
              })}
              disabled={isSaving}
              style={{ width: '100%' }}
            />
          </EuiFlexItem>

          <EuiFlexItem>
            <FormattedMessage
              id="xpack.security.management.aliyunRoleMappings.arnHelpText"
              defaultMessage="Enter the Aliyun RAM user or role ARN to map to Kibana roles."
            />
          </EuiFlexItem>
        </EuiFlexGroup>
      </form>
    </EuiConfirmModal>
  );
}
