import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';
import { NoSuchCloudFrontOriginAccessIdentity } from '@aws-sdk/client-cloudfront';

// Mock AWS clients before importing the provider
const mockSend = mock.fn();

vi.mock('../../../src/utils/aws-clients.ts', () => ({
  getAwsClients: () => ({
    cloudFront: { send: mockSend },
  }),
}));

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

import { CloudFrontOAIProvider } from '../../../src/provisioning/providers/cloudfront-oai-provider.ts';

describe('CloudFrontOAIProvider', () => {
  let provider: CloudFrontOAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CloudFrontOAIProvider();
  });

  describe('create', () => {
    it('should create an OAI with Comment from config', async () => {
      mockSend.mockResolvedValueOnce({
        CloudFrontOriginAccessIdentity: {
          Id: 'E1ABCDEF123456',
          S3CanonicalUserId: 'abc123canonical',
        },
      });

      const result = await provider.create(
        'MyOAI',
        'AWS::CloudFront::CloudFrontOriginAccessIdentity',
        {
          CloudFrontOriginAccessIdentityConfig: {
            Comment: 'My OAI comment',
          },
        }
      );

      assert.strictEqual(result.physicalId, 'E1ABCDEF123456');
      expect(result.attributes).toEqual({
        Id: 'E1ABCDEF123456',
        S3CanonicalUserId: 'abc123canonical',
      });
      expect(mockSend).toHaveBeenCalledTimes(1);

      const createCall = mockSend.mock.calls[0][0];
      assert.strictEqual(createCall.constructor.name, 'CreateCloudFrontOriginAccessIdentityCommand');
      assert.strictEqual(createCall.input.CloudFrontOriginAccessIdentityConfig.CallerReference, 'MyOAI');
      expect(createCall.input.CloudFrontOriginAccessIdentityConfig.Comment).toBe(
        'My OAI comment'
      );
    });

    it('should create an OAI with empty Comment when config is missing', async () => {
      mockSend.mockResolvedValueOnce({
        CloudFrontOriginAccessIdentity: {
          Id: 'E1ABCDEF123456',
          S3CanonicalUserId: 'abc123canonical',
        },
      });

      const result = await provider.create(
        'MyOAI',
        'AWS::CloudFront::CloudFrontOriginAccessIdentity',
        {}
      );

      assert.strictEqual(result.physicalId, 'E1ABCDEF123456');
      expect(mockSend).toHaveBeenCalledTimes(1);

      const createCall = mockSend.mock.calls[0][0];
      assert.strictEqual(createCall.input.CloudFrontOriginAccessIdentityConfig.Comment, '');
    });

    it('should use logicalId as CallerReference', async () => {
      mockSend.mockResolvedValueOnce({
        CloudFrontOriginAccessIdentity: {
          Id: 'E1ABCDEF123456',
          S3CanonicalUserId: 'abc123canonical',
        },
      });

      await provider.create('MyUniqueOAI', 'AWS::CloudFront::CloudFrontOriginAccessIdentity', {
        CloudFrontOriginAccessIdentityConfig: {
          Comment: 'test',
        },
      });

      const createCall = mockSend.mock.calls[0][0];
      expect(createCall.input.CloudFrontOriginAccessIdentityConfig.CallerReference).toBe(
        'MyUniqueOAI'
      );
    });

    it('should throw ProvisioningError on failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      await expect(
        provider.create('MyOAI', 'AWS::CloudFront::CloudFrontOriginAccessIdentity', {
          CloudFrontOriginAccessIdentityConfig: {
            Comment: 'test',
          },
        })
      ).rejects.toThrow('Failed to create CloudFront OAI MyOAI');
    });
  });

  describe('update', () => {
    it('should return wasReplaced: false (no-op)', async () => {
      const result = await provider.update(
        'MyOAI',
        'E1ABCDEF123456',
        'AWS::CloudFront::CloudFrontOriginAccessIdentity',
        {
          CloudFrontOriginAccessIdentityConfig: {
            Comment: 'new comment',
          },
        },
        {
          CloudFrontOriginAccessIdentityConfig: {
            Comment: 'old comment',
          },
        }
      );

      assert.strictEqual(result.physicalId, 'E1ABCDEF123456');
      assert.strictEqual(result.wasReplaced, false);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should get ETag and delete OAI', async () => {
      // GetCloudFrontOriginAccessIdentity
      mockSend.mockResolvedValueOnce({
        ETag: 'E2QWRUHAPOMQZL',
        CloudFrontOriginAccessIdentity: {
          Id: 'E1ABCDEF123456',
          S3CanonicalUserId: 'abc123canonical',
        },
      });
      // DeleteCloudFrontOriginAccessIdentity
      mockSend.mockResolvedValueOnce({});

      await provider.delete(
        'MyOAI',
        'E1ABCDEF123456',
        'AWS::CloudFront::CloudFrontOriginAccessIdentity'
      );

      expect(mockSend).toHaveBeenCalledTimes(2);

      const getCall = mockSend.mock.calls[0][0];
      assert.strictEqual(getCall.constructor.name, 'GetCloudFrontOriginAccessIdentityCommand');
      assert.strictEqual(getCall.input.Id, 'E1ABCDEF123456');

      const deleteCall = mockSend.mock.calls[1][0];
      assert.strictEqual(deleteCall.constructor.name, 'DeleteCloudFrontOriginAccessIdentityCommand');
      assert.strictEqual(deleteCall.input.Id, 'E1ABCDEF123456');
      assert.strictEqual(deleteCall.input.IfMatch, 'E2QWRUHAPOMQZL');
    });

    it('should skip deletion when OAI does not exist (on Get)', async () => {
      mockSend.mockRejectedValueOnce(
        new NoSuchCloudFrontOriginAccessIdentity({
          $metadata: {},
          message: 'not found',
        })
      );

      await provider.delete(
        'MyOAI',
        'E1ABCDEF123456',
        'AWS::CloudFront::CloudFrontOriginAccessIdentity'
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle NoSuchCloudFrontOriginAccessIdentity during Delete gracefully', async () => {
      // GetCloudFrontOriginAccessIdentity
      mockSend.mockResolvedValueOnce({
        ETag: 'E2QWRUHAPOMQZL',
        CloudFrontOriginAccessIdentity: {
          Id: 'E1ABCDEF123456',
        },
      });
      // DeleteCloudFrontOriginAccessIdentity - already gone
      mockSend.mockRejectedValueOnce(
        new NoSuchCloudFrontOriginAccessIdentity({
          $metadata: {},
          message: 'not found',
        })
      );

      await provider.delete(
        'MyOAI',
        'E1ABCDEF123456',
        'AWS::CloudFront::CloudFrontOriginAccessIdentity'
      );

      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should throw ProvisioningError on unexpected failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      await expect(
        provider.delete(
          'MyOAI',
          'E1ABCDEF123456',
          'AWS::CloudFront::CloudFrontOriginAccessIdentity'
        )
      ).rejects.toThrow('Failed to delete CloudFront OAI MyOAI');
    });
  });

  describe('getAttribute', () => {
    it('should return physicalId for Id attribute', async () => {
      const id = await provider.getAttribute(
        'E1ABCDEF123456',
        'AWS::CloudFront::CloudFrontOriginAccessIdentity',
        'Id'
      );

      assert.strictEqual(id, 'E1ABCDEF123456');
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should fetch S3CanonicalUserId from API', async () => {
      mockSend.mockResolvedValueOnce({
        CloudFrontOriginAccessIdentity: {
          Id: 'E1ABCDEF123456',
          S3CanonicalUserId: 'abc123canonical',
        },
      });

      const userId = await provider.getAttribute(
        'E1ABCDEF123456',
        'AWS::CloudFront::CloudFrontOriginAccessIdentity',
        'S3CanonicalUserId'
      );

      assert.strictEqual(userId, 'abc123canonical');
      expect(mockSend).toHaveBeenCalledTimes(1);

      const getCall = mockSend.mock.calls[0][0];
      assert.strictEqual(getCall.constructor.name, 'GetCloudFrontOriginAccessIdentityCommand');
    });

    it('should throw for unsupported attribute', async () => {
      await expect(
        provider.getAttribute(
          'E1ABCDEF123456',
          'AWS::CloudFront::CloudFrontOriginAccessIdentity',
          'UnsupportedAttr'
        )
      ).rejects.toThrow('Unsupported attribute: UnsupportedAttr');
    });
  });
});
