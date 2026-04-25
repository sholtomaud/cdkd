import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';

// Mock AWS clients before importing the provider
const mockSend = mock.fn();

vi.mock('@aws-sdk/client-cognito-identity-provider', async () => {
  const actual = await vi.importActual('@aws-sdk/client-cognito-identity-provider');
  return {
    ...actual,
    CognitoIdentityProviderClient: mock.fn().mockImplementation(() => ({
      send: mockSend,
      config: { region: () => Promise.resolve('us-east-1') },
    })),
  };
});

vi.mock('../../../src/utils/logger.ts', () => {
  const childLogger = {
    debug: mock.fn(),
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    child: mock.fn().mockReturnThis(),
  };
  return {
    getLogger: () => ({
      child: () => childLogger,
      debug: mock.fn(),
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
    }),
  };
});

import { ResourceNotFoundException } from '@aws-sdk/client-cognito-identity-provider';
import { CognitoUserPoolProvider } from '../../../src/provisioning/providers/cognito-provider.ts';

describe('CognitoUserPoolProvider', () => {
  let provider: CognitoUserPoolProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CognitoUserPoolProvider();
  });

  describe('create', () => {
    it('should create user pool and return UserPoolId as physicalId with attributes', async () => {
      mockSend.mockResolvedValueOnce({
        UserPool: {
          Id: 'us-east-1_abc123',
          Arn: 'arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_abc123',
        },
      });

      const result = await provider.create('MyUserPool', 'AWS::Cognito::UserPool', {
        UserPoolName: 'my-user-pool',
      });

      assert.strictEqual(result.physicalId, 'us-east-1_abc123');
      expect(result.attributes).toEqual({
        Arn: 'arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_abc123',
        ProviderName: 'cognito-idp.us-east-1.amazonaws.com/us-east-1_abc123',
        ProviderURL: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc123',
        UserPoolId: 'us-east-1_abc123',
      });
      expect(mockSend).toHaveBeenCalledTimes(1);

      const createCall = mockSend.mock.calls[0][0];
      assert.strictEqual(createCall.constructor.name, 'CreateUserPoolCommand');
    });

    it('should pass PoolName as UserPoolName', async () => {
      mockSend.mockResolvedValueOnce({
        UserPool: {
          Id: 'us-east-1_abc123',
          Arn: 'arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_abc123',
        },
      });

      await provider.create('MyUserPool', 'AWS::Cognito::UserPool', {
        UserPoolName: 'custom-pool-name',
      });

      const createCall = mockSend.mock.calls[0][0];
      assert.strictEqual(createCall.input.PoolName, 'custom-pool-name');
    });

    it('should use logicalId as PoolName when UserPoolName is not provided', async () => {
      mockSend.mockResolvedValueOnce({
        UserPool: {
          Id: 'us-east-1_abc123',
          Arn: 'arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_abc123',
        },
      });

      await provider.create('MyUserPool', 'AWS::Cognito::UserPool', {});

      const createCall = mockSend.mock.calls[0][0];
      assert.strictEqual(createCall.input.PoolName, 'MyUserPool');
    });

    it('should throw ProvisioningError on failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      await expect(
        provider.create('MyUserPool', 'AWS::Cognito::UserPool', {
          UserPoolName: 'my-pool',
        })
      ).rejects.toThrow('Failed to create Cognito User Pool MyUserPool');
    });
  });

  describe('update', () => {
    it('should update user pool (Policies, MfaConfiguration, etc.)', async () => {
      // UpdateUserPool
      mockSend.mockResolvedValueOnce({});
      // DescribeUserPool
      mockSend.mockResolvedValueOnce({
        UserPool: {
          Arn: 'arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_abc123',
        },
      });

      const result = await provider.update(
        'MyUserPool',
        'us-east-1_abc123',
        'AWS::Cognito::UserPool',
        {
          Policies: {
            PasswordPolicy: {
              MinimumLength: 12,
              RequireUppercase: true,
            },
          },
          MfaConfiguration: 'OPTIONAL',
        },
        {
          Policies: {
            PasswordPolicy: {
              MinimumLength: 8,
              RequireUppercase: false,
            },
          },
          MfaConfiguration: 'OFF',
        }
      );

      assert.strictEqual(result.physicalId, 'us-east-1_abc123');
      assert.strictEqual(result.wasReplaced, false);
      expect(result.attributes).toEqual({
        Arn: 'arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_abc123',
        ProviderName: 'cognito-idp.us-east-1.amazonaws.com/us-east-1_abc123',
        ProviderURL: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc123',
        UserPoolId: 'us-east-1_abc123',
      });
      expect(mockSend).toHaveBeenCalledTimes(2);

      const updateCall = mockSend.mock.calls[0][0];
      assert.strictEqual(updateCall.constructor.name, 'UpdateUserPoolCommand');
      assert.strictEqual(updateCall.input.UserPoolId, 'us-east-1_abc123');
      expect(updateCall.input.Policies).toEqual({
        PasswordPolicy: {
          MinimumLength: 12,
          RequireUppercase: true,
        },
      });
      assert.strictEqual(updateCall.input.MfaConfiguration, 'OPTIONAL');

      const describeCall = mockSend.mock.calls[1][0];
      assert.strictEqual(describeCall.constructor.name, 'DescribeUserPoolCommand');
    });

    it('should not pass PoolName in update params (PoolName is immutable)', async () => {
      // UpdateUserPool
      mockSend.mockResolvedValueOnce({});
      // DescribeUserPool
      mockSend.mockResolvedValueOnce({
        UserPool: {
          Arn: 'arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_abc123',
        },
      });

      await provider.update(
        'MyUserPool',
        'us-east-1_abc123',
        'AWS::Cognito::UserPool',
        {
          UserPoolName: 'new-pool-name',
          MfaConfiguration: 'OFF',
        },
        {
          UserPoolName: 'old-pool-name',
          MfaConfiguration: 'OFF',
        }
      );

      const updateCall = mockSend.mock.calls[0][0];
      // PoolName should NOT be in the update params since it's immutable
      assert.strictEqual(updateCall.input.PoolName, undefined);
    });
  });

  describe('delete', () => {
    it('should delete user pool', async () => {
      // DescribeUserPool (check deletion protection) + DeleteUserPool
      mockSend
        .mockResolvedValueOnce({ UserPool: { DeletionProtection: 'INACTIVE' } })
        .mockResolvedValueOnce({});

      await provider.delete(
        'MyUserPool',
        'us-east-1_abc123',
        'AWS::Cognito::UserPool'
      );

      expect(mockSend).toHaveBeenCalledTimes(2);

      const deleteCall = mockSend.mock.calls[1][0];
      assert.strictEqual(deleteCall.constructor.name, 'DeleteUserPoolCommand');
      assert.strictEqual(deleteCall.input.UserPoolId, 'us-east-1_abc123');
    });

    it('should handle ResourceNotFoundException gracefully', async () => {
      mockSend.mockRejectedValueOnce(
        new ResourceNotFoundException({ $metadata: {}, message: 'not found' })
      );

      await provider.delete(
        'MyUserPool',
        'us-east-1_abc123',
        'AWS::Cognito::UserPool'
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should disable deletion protection before deleting', async () => {
      // DescribeUserPool returns ACTIVE + UpdateUserPool + DeleteUserPool
      mockSend
        .mockResolvedValueOnce({ UserPool: { DeletionProtection: 'ACTIVE' } })
        .mockResolvedValueOnce({}) // UpdateUserPool
        .mockResolvedValueOnce({}); // DeleteUserPool

      await provider.delete(
        'MyUserPool',
        'us-east-1_abc123',
        'AWS::Cognito::UserPool'
      );

      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('should throw ProvisioningError on unexpected failure', async () => {
      // DescribeUserPool succeeds, DeleteUserPool fails
      mockSend
        .mockResolvedValueOnce({ UserPool: { DeletionProtection: 'INACTIVE' } })
        .mockRejectedValueOnce(new Error('Access Denied'));

      await expect(
        provider.delete(
          'MyUserPool',
          'us-east-1_abc123',
          'AWS::Cognito::UserPool'
        )
      ).rejects.toThrow('Failed to delete Cognito User Pool MyUserPool');
    });
  });
});
