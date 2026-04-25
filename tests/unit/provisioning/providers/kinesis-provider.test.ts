import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';

const mockSend = vi.hoisted(() => mock.fn());

vi.mock('@aws-sdk/client-kinesis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-kinesis')>();
  return {
    ...actual,
    KinesisClient: mock.fn().mockImplementation(() => ({
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

vi.mock('../../../../src/provisioning/resource-name.ts', () => ({
  generateResourceName: mock.fn().mockReturnValue('generated-stream-name'),
}));

import {
  CreateStreamCommand,
  DeleteStreamCommand,
  DescribeStreamCommand,
  AddTagsToStreamCommand,
  UpdateShardCountCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-kinesis';
import { KinesisStreamProvider } from '../../../../src/provisioning/providers/kinesis-provider.ts';

describe('KinesisStreamProvider', () => {
  let provider: KinesisStreamProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new KinesisStreamProvider();
  });

  describe('create', () => {
    it('should create stream with PROVISIONED mode', async () => {
      mockSend.mockImplementation((cmd: unknown) => {
        if (cmd instanceof CreateStreamCommand) return Promise.resolve({});
        if (cmd instanceof DescribeStreamCommand)
          return Promise.resolve({
            StreamDescription: {
              StreamStatus: 'ACTIVE',
              StreamARN: 'arn:aws:kinesis:us-east-1:123456789012:stream/test-stream',
            },
          });
        return Promise.resolve({});
      });

      const result = await provider.create('MyStream', 'AWS::Kinesis::Stream', {
        Name: 'test-stream',
        ShardCount: 2,
      });

      assert.strictEqual(result.physicalId, 'test-stream');
      expect(result.attributes).toEqual({
        Arn: 'arn:aws:kinesis:us-east-1:123456789012:stream/test-stream',
      });

      const createCall = mockSend.mock.calls.find(
        (call: unknown[]) => call[0] instanceof CreateStreamCommand
      );
      assert.notStrictEqual(createCall, undefined);
      expect(createCall![0].input).toEqual({
        StreamName: 'test-stream',
        ShardCount: 2,
        StreamModeDetails: { StreamMode: 'PROVISIONED' },
      });
    });

    it('should create stream with tags', async () => {
      mockSend.mockImplementation((cmd: unknown) => {
        if (cmd instanceof CreateStreamCommand) return Promise.resolve({});
        if (cmd instanceof DescribeStreamCommand)
          return Promise.resolve({
            StreamDescription: {
              StreamStatus: 'ACTIVE',
              StreamARN: 'arn:aws:kinesis:us-east-1:123456789012:stream/tagged-stream',
            },
          });
        if (cmd instanceof AddTagsToStreamCommand) return Promise.resolve({});
        return Promise.resolve({});
      });

      const result = await provider.create('MyStream', 'AWS::Kinesis::Stream', {
        Name: 'tagged-stream',
        ShardCount: 1,
        Tags: [
          { Key: 'Environment', Value: 'test' },
          { Key: 'Project', Value: 'cdkd' },
        ],
      });

      assert.strictEqual(result.physicalId, 'tagged-stream');

      const addTagsCall = mockSend.mock.calls.find(
        (call: unknown[]) => call[0] instanceof AddTagsToStreamCommand
      );
      assert.notStrictEqual(addTagsCall, undefined);
      expect(addTagsCall![0].input).toEqual({
        StreamName: 'tagged-stream',
        Tags: { Environment: 'test', Project: 'cdkd' },
      });
    });

    it('should create stream with ON_DEMAND mode without ShardCount', async () => {
      mockSend.mockImplementation((cmd: unknown) => {
        if (cmd instanceof CreateStreamCommand) return Promise.resolve({});
        if (cmd instanceof DescribeStreamCommand)
          return Promise.resolve({
            StreamDescription: {
              StreamStatus: 'ACTIVE',
              StreamARN: 'arn:aws:kinesis:us-east-1:123456789012:stream/ondemand-stream',
            },
          });
        return Promise.resolve({});
      });

      const result = await provider.create('MyStream', 'AWS::Kinesis::Stream', {
        Name: 'ondemand-stream',
        StreamModeDetails: { StreamMode: 'ON_DEMAND' },
      });

      assert.strictEqual(result.physicalId, 'ondemand-stream');

      const createCall = mockSend.mock.calls.find(
        (call: unknown[]) => call[0] instanceof CreateStreamCommand
      );
      assert.notStrictEqual(createCall, undefined);
      // ON_DEMAND mode should NOT include ShardCount
      expect(createCall![0].input).toEqual({
        StreamName: 'ondemand-stream',
        StreamModeDetails: { StreamMode: 'ON_DEMAND' },
      });
    });

    it('should generate stream name when Name not provided', async () => {
      mockSend.mockImplementation((cmd: unknown) => {
        if (cmd instanceof CreateStreamCommand) return Promise.resolve({});
        if (cmd instanceof DescribeStreamCommand)
          return Promise.resolve({
            StreamDescription: {
              StreamStatus: 'ACTIVE',
              StreamARN:
                'arn:aws:kinesis:us-east-1:123456789012:stream/generated-stream-name',
            },
          });
        return Promise.resolve({});
      });

      const result = await provider.create('MyStream', 'AWS::Kinesis::Stream', {
        ShardCount: 1,
      });

      assert.strictEqual(result.physicalId, 'generated-stream-name');

      const createCall = mockSend.mock.calls.find(
        (call: unknown[]) => call[0] instanceof CreateStreamCommand
      );
      assert.strictEqual(createCall![0].input.StreamName, 'generated-stream-name');
    });
  });

  describe('delete', () => {
    it('should delete stream with EnforceConsumerDeletion', async () => {
      mockSend.mockResolvedValueOnce({});

      await provider.delete('MyStream', 'test-stream', 'AWS::Kinesis::Stream');

      expect(mockSend).toHaveBeenCalledTimes(1);

      const deleteCall = mockSend.mock.calls[0];
      expect(deleteCall[0]).toBeInstanceOf(DeleteStreamCommand);
      expect(deleteCall[0].input).toEqual({
        StreamName: 'test-stream',
        EnforceConsumerDeletion: true,
      });
    });

    it('should not throw when stream does not exist', async () => {
      mockSend.mockRejectedValueOnce(
        new ResourceNotFoundException({
          $metadata: {},
          message: 'Stream not found',
        })
      );

      await expect(
        provider.delete('MyStream', 'test-stream', 'AWS::Kinesis::Stream')
      ).resolves.not.toThrow();

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('should update shard count when changed', async () => {
      mockSend.mockImplementation((cmd: unknown) => {
        if (cmd instanceof UpdateShardCountCommand) return Promise.resolve({});
        if (cmd instanceof DescribeStreamCommand)
          return Promise.resolve({
            StreamDescription: {
              StreamStatus: 'ACTIVE',
              StreamARN: 'arn:aws:kinesis:us-east-1:123456789012:stream/test-stream',
            },
          });
        return Promise.resolve({});
      });

      const result = await provider.update(
        'MyStream',
        'test-stream',
        'AWS::Kinesis::Stream',
        { ShardCount: 4 },
        { ShardCount: 2 }
      );

      assert.strictEqual(result.physicalId, 'test-stream');
      expect(result.attributes).toEqual({
        Arn: 'arn:aws:kinesis:us-east-1:123456789012:stream/test-stream',
      });

      const updateCall = mockSend.mock.calls.find(
        (call: unknown[]) => call[0] instanceof UpdateShardCountCommand
      );
      assert.notStrictEqual(updateCall, undefined);
      expect(updateCall![0].input).toEqual({
        StreamName: 'test-stream',
        TargetShardCount: 4,
        ScalingType: 'UNIFORM_SCALING',
      });
    });
  });
});
