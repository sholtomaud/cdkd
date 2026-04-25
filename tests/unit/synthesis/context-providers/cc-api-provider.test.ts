import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';

// Mock AWS SDK
const mockSend = mock.fn();
const mockDestroy = mock.fn();
vi.mock('@aws-sdk/client-cloudcontrol', () => ({
  CloudControlClient: mock.fn().mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  })),
  GetResourceCommand: mock.fn().mockImplementation((input) => ({
    ...input,
    _type: 'GetResourceCommand',
  })),
  ListResourcesCommand: mock.fn().mockImplementation((input) => ({
    ...input,
    _type: 'ListResourcesCommand',
  })),
}));

// Mock logger
vi.mock('../../../../src/utils/logger.ts', () => ({
  getLogger: () => ({
    debug: mock.fn(),
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    child: () => ({
      debug: mock.fn(),
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
    }),
  }),
}));

import { CcApiContextProvider } from '../../../../src/synthesis/context-providers/cc-api-provider.ts';

describe('CcApiContextProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw when typeName is not provided', async () => {
    const provider = new CcApiContextProvider({ region: 'us-east-1' });

    await expect(provider.resolve({})).rejects.toThrow(
      'CC API context provider requires typeName property'
    );
  });

  it('should get resource by exact identifier', async () => {
    mockSend.mockResolvedValue({
      ResourceDescription: {
        Properties: JSON.stringify({
          RoleName: 'my-role',
          Arn: 'arn:aws:iam::123456789012:role/my-role',
          RoleId: 'AROAEXAMPLE',
        }),
      },
    });

    const provider = new CcApiContextProvider({ region: 'us-east-1' });
    const result = await provider.resolve({
      typeName: 'AWS::IAM::Role',
      exactIdentifier: 'my-role',
      expectedMatchCount: 'exactly-one',
    });

    expect(result).toEqual({
      RoleName: 'my-role',
      Arn: 'arn:aws:iam::123456789012:role/my-role',
      RoleId: 'AROAEXAMPLE',
    });
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('should return null resource when ResourceNotFoundException for exact identifier', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('Resource not found'), { name: 'ResourceNotFoundException' })
    );

    const provider = new CcApiContextProvider({ region: 'us-east-1' });

    await expect(
      provider.resolve({
        typeName: 'AWS::IAM::Role',
        exactIdentifier: 'nonexistent-role',
        expectedMatchCount: 'exactly-one',
      })
    ).rejects.toThrow('Expected exactly one AWS::IAM::Role with identifier nonexistent-role, found 0');
  });

  it('should list and filter resources by property match', async () => {
    mockSend.mockResolvedValue({
      ResourceDescriptions: [
        {
          Properties: JSON.stringify({
            BucketName: 'bucket-a',
            Tags: [{ Key: 'env', Value: 'prod' }],
          }),
        },
        {
          Properties: JSON.stringify({
            BucketName: 'bucket-b',
            Tags: [{ Key: 'env', Value: 'dev' }],
          }),
        },
        {
          Properties: JSON.stringify({
            BucketName: 'bucket-c',
            Tags: [{ Key: 'env', Value: 'prod' }],
          }),
        },
      ],
      NextToken: undefined,
    });

    const provider = new CcApiContextProvider({ region: 'us-east-1' });
    const result = await provider.resolve({
      typeName: 'AWS::S3::Bucket',
      propertyMatch: { BucketName: 'bucket-b' },
      expectedMatchCount: 'exactly-one',
    });

    expect(result).toEqual({
      BucketName: 'bucket-b',
      Tags: [{ Key: 'env', Value: 'dev' }],
    });
  });

  describe('validateMatchCount', () => {
    it('should pass for exactly-one when one resource found', async () => {
      mockSend.mockResolvedValue({
        ResourceDescriptions: [
          { Properties: JSON.stringify({ Name: 'resource-1' }) },
        ],
        NextToken: undefined,
      });

      const provider = new CcApiContextProvider({ region: 'us-east-1' });
      const result = await provider.resolve({
        typeName: 'AWS::SomeType',
        expectedMatchCount: 'exactly-one',
      });

      assert.deepStrictEqual(result, { Name: 'resource-1' });
    });

    it('should throw for exactly-one when multiple resources found', async () => {
      mockSend.mockResolvedValue({
        ResourceDescriptions: [
          { Properties: JSON.stringify({ Name: 'r1' }) },
          { Properties: JSON.stringify({ Name: 'r2' }) },
        ],
        NextToken: undefined,
      });

      const provider = new CcApiContextProvider({ region: 'us-east-1' });

      await expect(
        provider.resolve({
          typeName: 'AWS::SomeType',
          expectedMatchCount: 'exactly-one',
        })
      ).rejects.toThrow('Expected exactly one AWS::SomeType, found 2');
    });

    it('should pass for at-least-one when multiple resources found', async () => {
      mockSend.mockResolvedValue({
        ResourceDescriptions: [
          { Properties: JSON.stringify({ Name: 'r1' }) },
          { Properties: JSON.stringify({ Name: 'r2' }) },
        ],
        NextToken: undefined,
      });

      const provider = new CcApiContextProvider({ region: 'us-east-1' });
      const result = await provider.resolve({
        typeName: 'AWS::SomeType',
        expectedMatchCount: 'at-least-one',
      });

      assert.deepStrictEqual(result, [{ Name: 'r1' }, { Name: 'r2' }]);
    });

    it('should throw for at-least-one when no resources found', async () => {
      mockSend.mockResolvedValue({
        ResourceDescriptions: [],
        NextToken: undefined,
      });

      const provider = new CcApiContextProvider({ region: 'us-east-1' });

      await expect(
        provider.resolve({
          typeName: 'AWS::SomeType',
          expectedMatchCount: 'at-least-one',
        })
      ).rejects.toThrow('Expected at least one AWS::SomeType, found none');
    });

    it('should throw for at-most-one when multiple resources found', async () => {
      mockSend.mockResolvedValue({
        ResourceDescriptions: [
          { Properties: JSON.stringify({ Name: 'r1' }) },
          { Properties: JSON.stringify({ Name: 'r2' }) },
        ],
        NextToken: undefined,
      });

      const provider = new CcApiContextProvider({ region: 'us-east-1' });

      await expect(
        provider.resolve({
          typeName: 'AWS::SomeType',
          expectedMatchCount: 'at-most-one',
        })
      ).rejects.toThrow('Expected at most one AWS::SomeType, found 2');
    });

    it('should pass for any with zero resources when ignoreErrorOnMissingContext and dummyValue set', async () => {
      mockSend.mockResolvedValue({
        ResourceDescriptions: [],
        NextToken: undefined,
      });

      const provider = new CcApiContextProvider({ region: 'us-east-1' });
      const result = await provider.resolve({
        typeName: 'AWS::SomeType',
        expectedMatchCount: 'any',
        ignoreErrorOnMissingContext: true,
        dummyValue: { fallback: true },
      });

      assert.deepStrictEqual(result, { fallback: true });
    });
  });

  it('should return dummyValue when ignoreErrorOnMissingContext is true and no resource found', async () => {
    mockSend.mockResolvedValue({
      ResourceDescriptions: [],
      NextToken: undefined,
    });

    const provider = new CcApiContextProvider({ region: 'us-east-1' });
    const result = await provider.resolve({
      typeName: 'AWS::SomeType',
      expectedMatchCount: 'any',
      ignoreErrorOnMissingContext: true,
      dummyValue: 'dummy-result',
    });

    assert.strictEqual(result, 'dummy-result');
  });

  it('should throw when no resources found and ignoreErrorOnMissingContext is false', async () => {
    mockSend.mockResolvedValue({
      ResourceDescriptions: [],
      NextToken: undefined,
    });

    const provider = new CcApiContextProvider({ region: 'us-east-1' });

    await expect(
      provider.resolve({
        typeName: 'AWS::SomeType',
        expectedMatchCount: 'any',
      })
    ).rejects.toThrow('No AWS::SomeType resource found');
  });

  it('should extract requested properties', async () => {
    mockSend.mockResolvedValue({
      ResourceDescription: {
        Properties: JSON.stringify({
          RoleName: 'my-role',
          Arn: 'arn:aws:iam::123456789012:role/my-role',
          RoleId: 'AROAEXAMPLE',
          Path: '/',
        }),
      },
    });

    const provider = new CcApiContextProvider({ region: 'us-east-1' });
    const result = await provider.resolve({
      typeName: 'AWS::IAM::Role',
      exactIdentifier: 'my-role',
      expectedMatchCount: 'exactly-one',
      propertiesToReturn: ['Arn', 'RoleName'],
    });

    expect(result).toEqual({
      Arn: 'arn:aws:iam::123456789012:role/my-role',
      RoleName: 'my-role',
    });
  });

  it('should handle pagination in list resources', async () => {
    mockSend
      .mockResolvedValueOnce({
        ResourceDescriptions: [
          { Properties: JSON.stringify({ Name: 'r1' }) },
        ],
        NextToken: 'token-1',
      })
      .mockResolvedValueOnce({
        ResourceDescriptions: [
          { Properties: JSON.stringify({ Name: 'r2' }) },
        ],
        NextToken: undefined,
      });

    const provider = new CcApiContextProvider({ region: 'us-east-1' });
    const result = await provider.resolve({
      typeName: 'AWS::SomeType',
      expectedMatchCount: 'at-least-one',
    });

    assert.deepStrictEqual(result, [{ Name: 'r1' }, { Name: 'r2' }]);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('should filter by nested property match', async () => {
    mockSend.mockResolvedValue({
      ResourceDescriptions: [
        {
          Properties: JSON.stringify({
            Name: 'r1',
            Config: { Env: 'prod' },
          }),
        },
        {
          Properties: JSON.stringify({
            Name: 'r2',
            Config: { Env: 'dev' },
          }),
        },
      ],
      NextToken: undefined,
    });

    const provider = new CcApiContextProvider({ region: 'us-east-1' });
    const result = await provider.resolve({
      typeName: 'AWS::SomeType',
      propertyMatch: { 'Config.Env': 'prod' },
      expectedMatchCount: 'exactly-one',
    });

    assert.deepStrictEqual(result, { Name: 'r1', Config: { Env: 'prod' } });
  });
});
