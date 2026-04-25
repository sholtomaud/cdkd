import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';
import { NoSuchDistribution } from '@aws-sdk/client-cloudfront';

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

import { CloudFrontDistributionProvider } from '../../../src/provisioning/providers/cloudfront-distribution-provider.ts';

describe('CloudFrontDistributionProvider', () => {
  let provider: CloudFrontDistributionProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CloudFrontDistributionProvider();
  });

  describe('create', () => {
    it('should create distribution and return Id as physicalId with DomainName attribute', async () => {
      // CreateDistributionCommand
      mockSend.mockResolvedValueOnce({
        Distribution: {
          Id: 'EDFDVBD6EXAMPLE',
          DomainName: 'd111111abcdef8.cloudfront.net',
        },
      });
      // GetDistributionCommand (waitForDistributionDeployed)
      mockSend.mockResolvedValueOnce({
        Distribution: { Id: 'EDFDVBD6EXAMPLE', Status: 'Deployed' },
      });

      const result = await provider.create(
        'MyDistribution',
        'AWS::CloudFront::Distribution',
        {
          DistributionConfig: {
            DefaultCacheBehavior: {
              TargetOriginId: 'myS3Origin',
              ViewerProtocolPolicy: 'redirect-to-https',
            },
            Enabled: true,
          },
        }
      );

      assert.strictEqual(result.physicalId, 'EDFDVBD6EXAMPLE');
      expect(result.attributes).toEqual({
        Id: 'EDFDVBD6EXAMPLE',
        DistributionId: 'EDFDVBD6EXAMPLE',
        DomainName: 'd111111abcdef8.cloudfront.net',
      });
      expect(mockSend).toHaveBeenCalledTimes(2);

      const createCall = mockSend.mock.calls[0][0];
      assert.strictEqual(createCall.constructor.name, 'CreateDistributionCommand');
      assert.notStrictEqual(createCall.input.DistributionConfig.CallerReference, undefined);
      assert.strictEqual(createCall.input.DistributionConfig.Enabled, true);
    });

    it('should convert DistributionConfig with Origins Items to SDK Quantity format', async () => {
      // CreateDistributionCommand
      mockSend.mockResolvedValueOnce({
        Distribution: {
          Id: 'EDFDVBD6EXAMPLE',
          DomainName: 'd111111abcdef8.cloudfront.net',
        },
      });
      // GetDistributionCommand (waitForDistributionDeployed)
      mockSend.mockResolvedValueOnce({
        Distribution: { Id: 'EDFDVBD6EXAMPLE', Status: 'Deployed' },
      });

      await provider.create('MyDistribution', 'AWS::CloudFront::Distribution', {
        DistributionConfig: {
          Origins: [
            {
              Id: 'myS3Origin',
              DomainName: 'mybucket.s3.amazonaws.com',
            },
          ],
          DefaultCacheBehavior: {
            TargetOriginId: 'myS3Origin',
            ViewerProtocolPolicy: 'redirect-to-https',
          },
          Enabled: true,
        },
      });

      const createCall = mockSend.mock.calls[0][0];
      const origins = createCall.input.DistributionConfig.Origins;
      expect(origins).toEqual({
        Quantity: 1,
        Items: [
          {
            Id: 'myS3Origin',
            DomainName: 'mybucket.s3.amazonaws.com',
          },
        ],
      });
    });

    it('should throw ProvisioningError on failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      await expect(
        provider.create('MyDistribution', 'AWS::CloudFront::Distribution', {
          DistributionConfig: {
            Enabled: true,
          },
        })
      ).rejects.toThrow('Failed to create CloudFront Distribution MyDistribution');
    });
  });

  describe('update', () => {
    it('should get current config (ETag), then update with IfMatch', async () => {
      // GetDistributionConfigCommand
      mockSend.mockResolvedValueOnce({
        ETag: 'E2QWRUHAPOMQZL',
        DistributionConfig: {
          CallerReference: 'original-caller-ref',
          Enabled: true,
          DefaultCacheBehavior: {
            TargetOriginId: 'myS3Origin',
            ViewerProtocolPolicy: 'allow-all',
          },
        },
      });
      // UpdateDistributionCommand
      mockSend.mockResolvedValueOnce({});
      // GetDistributionCommand (for updated attributes)
      mockSend.mockResolvedValueOnce({
        Distribution: {
          Id: 'EDFDVBD6EXAMPLE',
          DomainName: 'd111111abcdef8.cloudfront.net',
        },
      });

      const result = await provider.update(
        'MyDistribution',
        'EDFDVBD6EXAMPLE',
        'AWS::CloudFront::Distribution',
        {
          DistributionConfig: {
            DefaultCacheBehavior: {
              TargetOriginId: 'myS3Origin',
              ViewerProtocolPolicy: 'redirect-to-https',
            },
            Enabled: true,
          },
        },
        {
          DistributionConfig: {
            DefaultCacheBehavior: {
              TargetOriginId: 'myS3Origin',
              ViewerProtocolPolicy: 'allow-all',
            },
            Enabled: true,
          },
        }
      );

      assert.strictEqual(result.physicalId, 'EDFDVBD6EXAMPLE');
      assert.strictEqual(result.wasReplaced, false);
      expect(result.attributes).toEqual({
        Id: 'EDFDVBD6EXAMPLE',
        DistributionId: 'EDFDVBD6EXAMPLE',
        DomainName: 'd111111abcdef8.cloudfront.net',
      });
      expect(mockSend).toHaveBeenCalledTimes(3);

      // Verify GetDistributionConfigCommand
      const getConfigCall = mockSend.mock.calls[0][0];
      assert.strictEqual(getConfigCall.constructor.name, 'GetDistributionConfigCommand');
      assert.strictEqual(getConfigCall.input.Id, 'EDFDVBD6EXAMPLE');

      // Verify UpdateDistributionCommand with IfMatch
      const updateCall = mockSend.mock.calls[1][0];
      assert.strictEqual(updateCall.constructor.name, 'UpdateDistributionCommand');
      assert.strictEqual(updateCall.input.Id, 'EDFDVBD6EXAMPLE');
      assert.strictEqual(updateCall.input.IfMatch, 'E2QWRUHAPOMQZL');
      // CallerReference should be preserved from the current config
      assert.strictEqual(updateCall.input.DistributionConfig.CallerReference, 'original-caller-ref');
    });
  });

  describe('delete', () => {
    it('should disable first if enabled, then delete with IfMatch', async () => {
      // GetDistributionConfigCommand (initial)
      mockSend.mockResolvedValueOnce({
        ETag: 'E2QWRUHAPOMQZL',
        DistributionConfig: {
          CallerReference: 'original-caller-ref',
          Enabled: true,
        },
      });
      // UpdateDistributionCommand (disable)
      mockSend.mockResolvedValueOnce({
        ETag: 'E3NEWETAG',
      });
      // GetDistributionCommand (wait for deployed - returns Deployed immediately)
      mockSend.mockResolvedValueOnce({
        Distribution: {
          Id: 'EDFDVBD6EXAMPLE',
          Status: 'Deployed',
        },
      });
      // GetDistributionConfigCommand (re-fetch ETag after waiting)
      mockSend.mockResolvedValueOnce({
        ETag: 'E4FINALETAG',
        DistributionConfig: {
          CallerReference: 'original-caller-ref',
          Enabled: false,
        },
      });
      // DeleteDistributionCommand
      mockSend.mockResolvedValueOnce({});

      await provider.delete(
        'MyDistribution',
        'EDFDVBD6EXAMPLE',
        'AWS::CloudFront::Distribution'
      );

      expect(mockSend).toHaveBeenCalledTimes(5);

      // Verify initial GetDistributionConfigCommand
      const getConfigCall = mockSend.mock.calls[0][0];
      assert.strictEqual(getConfigCall.constructor.name, 'GetDistributionConfigCommand');
      assert.strictEqual(getConfigCall.input.Id, 'EDFDVBD6EXAMPLE');

      // Verify UpdateDistributionCommand (disable)
      const updateCall = mockSend.mock.calls[1][0];
      assert.strictEqual(updateCall.constructor.name, 'UpdateDistributionCommand');
      assert.strictEqual(updateCall.input.Id, 'EDFDVBD6EXAMPLE');
      assert.strictEqual(updateCall.input.IfMatch, 'E2QWRUHAPOMQZL');
      assert.strictEqual(updateCall.input.DistributionConfig.Enabled, false);

      // Verify DeleteDistributionCommand with final ETag
      const deleteCall = mockSend.mock.calls[4][0];
      assert.strictEqual(deleteCall.constructor.name, 'DeleteDistributionCommand');
      assert.strictEqual(deleteCall.input.Id, 'EDFDVBD6EXAMPLE');
      assert.strictEqual(deleteCall.input.IfMatch, 'E4FINALETAG');
    });

    it('should handle NoSuchDistribution gracefully', async () => {
      // GetDistributionConfigCommand throws NoSuchDistribution
      mockSend.mockRejectedValueOnce(
        new NoSuchDistribution({
          $metadata: {},
          message: 'The specified distribution does not exist.',
        })
      );

      await provider.delete(
        'MyDistribution',
        'EDFDVBD6EXAMPLE',
        'AWS::CloudFront::Distribution'
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});
