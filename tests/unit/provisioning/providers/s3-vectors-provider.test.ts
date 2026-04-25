import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';

const mockSend = vi.hoisted(() => mock.fn());

vi.mock('@aws-sdk/client-s3vectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3vectors')>();
  return {
    ...actual,
    S3VectorsClient: mock.fn().mockImplementation(() => ({
      send: mockSend,
    })),
  };
});

vi.mock('../../../../src/utils/logger.ts', () => {
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

import {
  CreateVectorBucketCommand,
  DeleteVectorBucketCommand,
  ListIndexesCommand,
  DeleteIndexCommand,
} from '@aws-sdk/client-s3vectors';
import { S3VectorsProvider } from '../../../../src/provisioning/providers/s3-vectors-provider.ts';

describe('S3VectorsProvider', () => {
  let provider: S3VectorsProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new S3VectorsProvider();
  });

  describe('create', () => {
    it('should create a vector bucket', async () => {
      mockSend.mockImplementation((cmd: unknown) => {
        if (cmd instanceof CreateVectorBucketCommand) {
          return Promise.resolve({
            vectorBucketArn: 'arn:aws:s3vectors:us-east-1:123456789012:vector-bucket/my-vector-bucket',
          });
        }
        return Promise.resolve({});
      });

      const result = await provider.create('MyVectorBucket', 'AWS::S3Vectors::VectorBucket', {
        VectorBucketName: 'my-vector-bucket',
      });

      assert.strictEqual(result.physicalId, 'my-vector-bucket');
      expect(result.attributes).toEqual({
        VectorBucketArn: 'arn:aws:s3vectors:us-east-1:123456789012:vector-bucket/my-vector-bucket',
      });

      const createCall = mockSend.mock.calls.find(
        (call: unknown[]) => call[0] instanceof CreateVectorBucketCommand
      );
      assert.notStrictEqual(createCall, undefined);
      expect(createCall![0].input).toEqual({
        vectorBucketName: 'my-vector-bucket',
        encryptionConfiguration: undefined,
      });
    });
  });

  describe('delete', () => {
    it('should delete a vector bucket with no indexes', async () => {
      mockSend.mockImplementation((cmd: unknown) => {
        if (cmd instanceof ListIndexesCommand) {
          return Promise.resolve({ indexes: [], nextToken: undefined });
        }
        if (cmd instanceof DeleteVectorBucketCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      await provider.delete('MyVectorBucket', 'my-vector-bucket', 'AWS::S3Vectors::VectorBucket');

      const listCall = mockSend.mock.calls.find(
        (call: unknown[]) => call[0] instanceof ListIndexesCommand
      );
      assert.notStrictEqual(listCall, undefined);

      const deleteCall = mockSend.mock.calls.find(
        (call: unknown[]) => call[0] instanceof DeleteVectorBucketCommand
      );
      assert.notStrictEqual(deleteCall, undefined);
      expect(deleteCall![0].input).toEqual({
        vectorBucketName: 'my-vector-bucket',
      });

      // No DeleteIndexCommand should have been called
      const deleteIndexCalls = mockSend.mock.calls.filter(
        (call: unknown[]) => call[0] instanceof DeleteIndexCommand
      );
      assert.strictEqual((deleteIndexCalls).length, 0);
    });

    it('should delete all indexes before deleting the vector bucket', async () => {
      mockSend.mockImplementation((cmd: unknown) => {
        if (cmd instanceof ListIndexesCommand) {
          return Promise.resolve({
            indexes: [
              { indexName: 'index-1' },
              { indexName: 'index-2' },
            ],
            nextToken: undefined,
          });
        }
        if (cmd instanceof DeleteIndexCommand) {
          return Promise.resolve({});
        }
        if (cmd instanceof DeleteVectorBucketCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      await provider.delete('MyVectorBucket', 'my-vector-bucket', 'AWS::S3Vectors::VectorBucket');

      // Verify ListIndexes was called
      const listCall = mockSend.mock.calls.find(
        (call: unknown[]) => call[0] instanceof ListIndexesCommand
      );
      assert.notStrictEqual(listCall, undefined);
      expect(listCall![0].input).toEqual({
        vectorBucketName: 'my-vector-bucket',
        nextToken: undefined,
      });

      // Verify DeleteIndex was called for each index
      const deleteIndexCalls = mockSend.mock.calls.filter(
        (call: unknown[]) => call[0] instanceof DeleteIndexCommand
      );
      assert.strictEqual((deleteIndexCalls).length, 2);
      expect(deleteIndexCalls[0][0].input).toEqual({
        vectorBucketName: 'my-vector-bucket',
        indexName: 'index-1',
      });
      expect(deleteIndexCalls[1][0].input).toEqual({
        vectorBucketName: 'my-vector-bucket',
        indexName: 'index-2',
      });

      // Verify DeleteVectorBucket was called
      const deleteBucketCall = mockSend.mock.calls.find(
        (call: unknown[]) => call[0] instanceof DeleteVectorBucketCommand
      );
      assert.notStrictEqual(deleteBucketCall, undefined);
    });

    it('should treat not-found as success (idempotent)', async () => {
      const notFoundError = new Error('Vector bucket not found');
      notFoundError.name = 'NotFoundException';
      mockSend.mockRejectedValueOnce(notFoundError);

      await expect(
        provider.delete('MyVectorBucket', 'my-vector-bucket', 'AWS::S3Vectors::VectorBucket')
      ).resolves.not.toThrow();

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('should be a no-op and return the existing physicalId', async () => {
      const result = await provider.update(
        'MyVectorBucket',
        'my-vector-bucket',
        'AWS::S3Vectors::VectorBucket',
        {},
        {}
      );

      assert.strictEqual(result.physicalId, 'my-vector-bucket');
      assert.strictEqual(result.wasReplaced, false);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});
