import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';

// Mock @aws-sdk/client-s3
const mockS3Send = mock.fn();
const mockS3Destroy = mock.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: mock.fn().mockImplementation(() => ({
    send: mockS3Send,
    destroy: mockS3Destroy,
  })),
  HeadObjectCommand: mock.fn().mockImplementation((input) => ({ ...input, _type: 'HeadObject' })),
  PutObjectCommand: mock.fn().mockImplementation((input) => ({ ...input, _type: 'PutObject' })),
}));

// Mock node:fs
vi.mock('node:fs', () => ({
  createReadStream: mock.fn().mockReturnValue('mock-stream'),
  statSync: mock.fn().mockReturnValue({ size: 1024, isDirectory: () => false }),
}));

// Mock archiver - emits data/end events like a real archive stream
vi.mock('archiver', () => ({
  default: mock.fn().mockImplementation(() => {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const archive = {
      on: mock.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event]!.push(handler);
        return archive;
      }),
      directory: mock.fn(),
      file: mock.fn(),
      finalize: mock.fn().mockImplementation(() => {
        // Emit data then end
        const dataChunk = Buffer.from('mock-zip-data');
        for (const h of handlers['data'] ?? []) h(dataChunk);
        for (const h of handlers['end'] ?? []) h();
      }),
    };
    return archive;
  }),
}));

// Mock node:stream (no longer used by file-asset-publisher but kept for safety)
vi.mock('node:stream', () => ({
  PassThrough: mock.fn().mockImplementation(() => {
    const handlers: Record<string, Function[]> = {};
    return {
      on: mock.fn().mockImplementation((event: string, handler: Function) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(handler);
        // Auto-trigger 'end' event for zip tests
        if (event === 'end') {
          setTimeout(() => handler(), 0);
        }
        return { on: mock.fn() };
      }),
    };
  }),
}));

// Mock logger
vi.mock('../../../src/utils/logger.ts', () => ({
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

import { createReadStream, statSync } from 'node:fs';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { FileAssetPublisher } from '../../../src/assets/file-asset-publisher.ts';
import type { FileAsset } from '../../../src/types/assets.ts';

describe('FileAssetPublisher', () => {
  let publisher: FileAssetPublisher;

  const makeFileAsset = (overrides: Partial<FileAsset> = {}): FileAsset => ({
    displayName: 'TestAsset',
    source: {
      path: 'asset.abc123/index.ts',
      packaging: 'file' as const,
    },
    destinations: {
      'current-account': {
        bucketName: 'cdk-assets-${AWS::AccountId}-${AWS::Region}',
        objectKey: 'assets/abc123.ts',
      },
    },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    publisher = new FileAssetPublisher();
  });

  it('should upload file to S3', async () => {
    // HeadObject throws NotFound -> file does not exist yet
    mockS3Send.mockImplementation((cmd: { _type?: string }) => {
      if (cmd._type === 'HeadObject') {
        const err = new Error('Not Found') as Error & { name: string; $metadata: { httpStatusCode: number } };
        err.name = 'NotFound';
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      return {};
    });

    await publisher.publish(
      'abc123',
      makeFileAsset(),
      '/tmp/cdk.out',
      '123456789012',
      'us-east-1'
    );

    expect(HeadObjectCommand).toHaveBeenCalledWith({
      Bucket: 'cdk-assets-123456789012-us-east-1',
      Key: 'assets/abc123.ts',
    });
    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'cdk-assets-123456789012-us-east-1',
        Key: 'assets/abc123.ts',
        Body: 'mock-stream',
        ContentLength: 1024,
      })
    );
    expect(createReadStream).toHaveBeenCalledWith('/tmp/cdk.out/asset.abc123/index.ts');
    expect(mockS3Destroy).toHaveBeenCalled();
  });

  it('should skip upload if object already exists', async () => {
    // HeadObject succeeds -> file exists
    mockS3Send.mockResolvedValue({});

    await publisher.publish(
      'abc123',
      makeFileAsset(),
      '/tmp/cdk.out',
      '123456789012',
      'us-east-1'
    );

    expect(HeadObjectCommand).toHaveBeenCalled();
    expect(PutObjectCommand).not.toHaveBeenCalled();
    expect(createReadStream).not.toHaveBeenCalled();
  });

  it('should handle ZIP packaging', async () => {
    mockS3Send.mockImplementation((cmd: { _type?: string }) => {
      if (cmd._type === 'HeadObject') {
        const err = new Error('Not Found') as Error & { name: string; $metadata: { httpStatusCode: number } };
        err.name = 'NotFound';
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      return {};
    });

    vi.mocked(statSync).mockReturnValue({
      size: 2048,
      isDirectory: () => true,
    } as ReturnType<typeof statSync>);

    const zipAsset = makeFileAsset({
      source: { path: 'asset.zip123', packaging: 'zip' },
    });

    await publisher.publish(
      'zip123',
      zipAsset,
      '/tmp/cdk.out',
      '123456789012',
      'us-east-1'
    );

    // Should use archiver for zip packaging (PutObjectCommand called with Buffer body)
    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'cdk-assets-123456789012-us-east-1',
        Key: 'assets/abc123.ts',
      })
    );
  });

  it('should resolve placeholders', async () => {
    mockS3Send.mockResolvedValue({}); // HeadObject succeeds (skip upload)

    const asset = makeFileAsset({
      destinations: {
        dest1: {
          bucketName: 'bucket-${AWS::AccountId}-${AWS::Region}',
          objectKey: '${AWS::Partition}/assets/key.ts',
          region: '${AWS::Region}',
        },
      },
    });

    await publisher.publish(
      'hash1',
      asset,
      '/tmp/cdk.out',
      '111122223333',
      'ap-northeast-1'
    );

    expect(HeadObjectCommand).toHaveBeenCalledWith({
      Bucket: 'bucket-111122223333-ap-northeast-1',
      Key: 'aws/assets/key.ts',
    });
  });

  it('should handle S3 upload errors', async () => {
    mockS3Send.mockImplementation((cmd: { _type?: string }) => {
      if (cmd._type === 'HeadObject') {
        const err = new Error('Not Found') as Error & { name: string; $metadata: { httpStatusCode: number } };
        err.name = 'NotFound';
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      if (cmd._type === 'PutObject') {
        throw new Error('Access Denied');
      }
      return {};
    });

    await expect(
      publisher.publish(
        'abc123',
        makeFileAsset(),
        '/tmp/cdk.out',
        '123456789012',
        'us-east-1'
      )
    ).rejects.toThrow('Access Denied');

    expect(mockS3Destroy).toHaveBeenCalled();
  });
});
