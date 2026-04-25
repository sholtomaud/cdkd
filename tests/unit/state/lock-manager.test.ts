import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';
import { S3Client, S3ServiceException, NoSuchKey } from '@aws-sdk/client-s3';
import { LockManager } from '../../../src/state/lock-manager.ts';
import type { LockInfo } from '../../../src/types/state.ts';
import type { StateBackendConfig } from '../../../src/types/config.ts';
import { LockError } from '../../../src/utils/error-handler.ts';

// Mock the S3Client
vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-s3')>('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: mock.fn().mockImplementation(() => ({
      send: mock.fn(),
    })),
  };
});

// Mock logger to suppress output during tests
vi.mock('../../../src/utils/logger.ts', () => ({
  getLogger: () => ({
    child: () => ({
      debug: mock.fn(),
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
    }),
    debug: mock.fn(),
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
  }),
}));

describe('LockManager', () => {
  let s3Client: { send: ReturnType<typeof vi.fn> };
  let lockManager: LockManager;
  const config: StateBackendConfig = {
    bucket: 'test-bucket',
    prefix: 'stacks',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    s3Client = { send: mock.fn() };
    lockManager = new LockManager(s3Client as unknown as S3Client, config);
  });

  describe('constructor with TTL options', () => {
    it('should use default TTL of 30 minutes', async () => {
      const manager = new LockManager(s3Client as unknown as S3Client, config);

      // Acquire lock and verify expiresAt is ~30 minutes from now
      s3Client.send.mockResolvedValueOnce({});

      const now = Date.now();
      await manager.acquireLock('test-stack');

      const putCall = s3Client.send.mock.calls[0][0];
      const lockBody = JSON.parse(putCall.input.Body) as LockInfo;
      const expectedExpiry = now + 30 * 60 * 1000;

      // Allow 1 second tolerance
      expect(lockBody.expiresAt).toBeGreaterThanOrEqual(expectedExpiry - 1000);
      expect(lockBody.expiresAt).toBeLessThanOrEqual(expectedExpiry + 1000);
    });

    it('should use custom TTL when specified', async () => {
      const manager = new LockManager(s3Client as unknown as S3Client, config, {
        ttlMinutes: 10,
      });

      s3Client.send.mockResolvedValueOnce({});

      const now = Date.now();
      await manager.acquireLock('test-stack');

      const putCall = s3Client.send.mock.calls[0][0];
      const lockBody = JSON.parse(putCall.input.Body) as LockInfo;
      const expectedExpiry = now + 10 * 60 * 1000;

      expect(lockBody.expiresAt).toBeGreaterThanOrEqual(expectedExpiry - 1000);
      expect(lockBody.expiresAt).toBeLessThanOrEqual(expectedExpiry + 1000);
    });
  });

  describe('acquireLock', () => {
    it('should acquire lock successfully with expiresAt', async () => {
      s3Client.send.mockResolvedValueOnce({});

      const result = await lockManager.acquireLock('test-stack', 'test-owner', 'deploy');

      assert.strictEqual(result, true);

      const putCall = s3Client.send.mock.calls[0][0];
      assert.strictEqual(putCall.input.Bucket, 'test-bucket');
      assert.strictEqual(putCall.input.Key, 'stacks/test-stack/lock.json');
      assert.strictEqual(putCall.input.IfNoneMatch, '*');

      const lockBody = JSON.parse(putCall.input.Body) as LockInfo;
      assert.strictEqual(lockBody.owner, 'test-owner');
      assert.strictEqual(lockBody.operation, 'deploy');
      assert.notStrictEqual(lockBody.timestamp, undefined);
      assert.notStrictEqual(lockBody.expiresAt, undefined);
      expect(lockBody.expiresAt).toBeGreaterThan(lockBody.timestamp);
    });

    it('should return false when lock exists and is not expired', async () => {
      // First call: PutObject fails (lock exists)
      const preconditionError = new S3ServiceException({ name: 'PreconditionFailed', $fault: 'client', $metadata: {} });
      s3Client.send.mockRejectedValueOnce(preconditionError);

      // Second call: GetObject returns a valid non-expired lock
      const existingLock: LockInfo = {
        owner: 'other-user@host:123',
        timestamp: Date.now(),
        expiresAt: Date.now() + 30 * 60 * 1000, // 30 min from now
        operation: 'deploy',
      };
      s3Client.send.mockResolvedValueOnce({
        Body: { transformToString: () => Promise.resolve(JSON.stringify(existingLock)) },
      });

      const result = await lockManager.acquireLock('test-stack', 'my-user');

      assert.strictEqual(result, false);
    });

    it('should clean up expired lock and re-acquire', async () => {
      // First call: PutObject fails (lock exists)
      const preconditionError = new S3ServiceException({ name: 'PreconditionFailed', $fault: 'client', $metadata: {} });
      s3Client.send.mockRejectedValueOnce(preconditionError);

      // Second call: GetObject returns an expired lock
      const expiredLock: LockInfo = {
        owner: 'old-user@host:123',
        timestamp: Date.now() - 60 * 60 * 1000, // 1 hour ago
        expiresAt: Date.now() - 30 * 60 * 1000, // expired 30 min ago
        operation: 'deploy',
      };
      s3Client.send.mockResolvedValueOnce({
        Body: { transformToString: () => Promise.resolve(JSON.stringify(expiredLock)) },
      });

      // Third call: DeleteObject (clean up expired lock)
      s3Client.send.mockResolvedValueOnce({});

      // Fourth call: PutObject retry succeeds
      s3Client.send.mockResolvedValueOnce({});

      const result = await lockManager.acquireLock('test-stack', 'new-user');

      assert.strictEqual(result, true);
      // Verify 4 S3 calls: PutObject(fail), GetObject, DeleteObject, PutObject(success)
      expect(s3Client.send).toHaveBeenCalledTimes(4);
    });

    it('should return false if another process acquires lock during expired lock cleanup', async () => {
      // First call: PutObject fails
      const preconditionError1 = new S3ServiceException({ name: 'PreconditionFailed', $fault: 'client', $metadata: {} });
      s3Client.send.mockRejectedValueOnce(preconditionError1);

      // Second call: GetObject returns expired lock
      const expiredLock: LockInfo = {
        owner: 'old-user@host:123',
        timestamp: Date.now() - 60 * 60 * 1000,
        expiresAt: Date.now() - 30 * 60 * 1000,
      };
      s3Client.send.mockResolvedValueOnce({
        Body: { transformToString: () => Promise.resolve(JSON.stringify(expiredLock)) },
      });

      // Third call: DeleteObject succeeds
      s3Client.send.mockResolvedValueOnce({});

      // Fourth call: PutObject fails again (another process got the lock)
      const preconditionError2 = new S3ServiceException({ name: 'PreconditionFailed', $fault: 'client', $metadata: {} });
      s3Client.send.mockRejectedValueOnce(preconditionError2);

      const result = await lockManager.acquireLock('test-stack', 'my-user');

      assert.strictEqual(result, false);
    });

    it('should throw LockError on unexpected S3 error', async () => {
      const s3Error = new Error('Access Denied');
      s3Error.name = 'AccessDenied';
      s3Client.send.mockRejectedValueOnce(s3Error);

      await assert.rejects(async () => { await lockManager.acquireLock('test-stack'); }, LockError);
    });
  });

  describe('getLockInfo', () => {
    it('should return lock info when lock exists', async () => {
      const lockInfo: LockInfo = {
        owner: 'user@host:123',
        timestamp: Date.now(),
        expiresAt: Date.now() + 30 * 60 * 1000,
        operation: 'deploy',
      };

      s3Client.send.mockResolvedValueOnce({
        Body: { transformToString: () => Promise.resolve(JSON.stringify(lockInfo)) },
      });

      const result = await lockManager.getLockInfo('test-stack');

      assert.deepStrictEqual(result, lockInfo);
    });

    it('should return null when no lock exists', async () => {
      const noSuchKeyError = new NoSuchKey({ message: 'NoSuchKey', $metadata: {} });
      s3Client.send.mockRejectedValueOnce(noSuchKeyError);

      const result = await lockManager.getLockInfo('test-stack');

      assert.strictEqual(result, null);
    });
  });

  describe('releaseLock', () => {
    it('should delete the lock file', async () => {
      s3Client.send.mockResolvedValueOnce({});

      await lockManager.releaseLock('test-stack');

      const deleteCall = s3Client.send.mock.calls[0][0];
      assert.strictEqual(deleteCall.input.Bucket, 'test-bucket');
      assert.strictEqual(deleteCall.input.Key, 'stacks/test-stack/lock.json');
    });

    it('should throw LockError on failure', async () => {
      s3Client.send.mockRejectedValueOnce(new Error('Network error'));

      await assert.rejects(async () => { await lockManager.releaseLock('test-stack'); }, LockError);
    });
  });

  describe('forceReleaseLock', () => {
    it('should release lock regardless of expiry status', async () => {
      // Non-expired lock
      const freshLock: LockInfo = {
        owner: 'other-user@host:456',
        timestamp: Date.now(),
        expiresAt: Date.now() + 30 * 60 * 1000,
        operation: 'deploy',
      };

      // GetObject returns the lock
      s3Client.send.mockResolvedValueOnce({
        Body: { transformToString: () => Promise.resolve(JSON.stringify(freshLock)) },
      });

      // DeleteObject succeeds
      s3Client.send.mockResolvedValueOnce({});

      await lockManager.forceReleaseLock('test-stack');

      // Should have called GetObject + DeleteObject
      expect(s3Client.send).toHaveBeenCalledTimes(2);
    });

    it('should release expired lock', async () => {
      const expiredLock: LockInfo = {
        owner: 'old-user@host:789',
        timestamp: Date.now() - 60 * 60 * 1000,
        expiresAt: Date.now() - 30 * 60 * 1000,
        operation: 'destroy',
      };

      s3Client.send.mockResolvedValueOnce({
        Body: { transformToString: () => Promise.resolve(JSON.stringify(expiredLock)) },
      });
      s3Client.send.mockResolvedValueOnce({});

      await lockManager.forceReleaseLock('test-stack');

      expect(s3Client.send).toHaveBeenCalledTimes(2);
    });

    it('should do nothing when no lock exists', async () => {
      const noSuchKeyError = new NoSuchKey({ message: 'NoSuchKey', $metadata: {} });
      s3Client.send.mockRejectedValueOnce(noSuchKeyError);

      await lockManager.forceReleaseLock('test-stack');

      // Only GetObject was called, no DeleteObject
      expect(s3Client.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('acquireLockWithRetry', () => {
    it('should acquire on first attempt', async () => {
      s3Client.send.mockResolvedValueOnce({});

      await lockManager.acquireLockWithRetry('test-stack', 'user', 'deploy');

      expect(s3Client.send).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed on second attempt', async () => {
      // First attempt: PutObject fails
      const preconditionError = new S3ServiceException({ name: 'PreconditionFailed', $fault: 'client', $metadata: {} });
      s3Client.send.mockRejectedValueOnce(preconditionError);

      // getLockInfo for first failed attempt: lock not expired
      const activeLock: LockInfo = {
        owner: 'other@host:100',
        timestamp: Date.now(),
        expiresAt: Date.now() + 30 * 60 * 1000,
        operation: 'deploy',
      };
      s3Client.send.mockResolvedValueOnce({
        Body: { transformToString: () => Promise.resolve(JSON.stringify(activeLock)) },
      });

      // getLockInfo called by acquireLock's check (after PreconditionFailed returns false)
      // then acquireLockWithRetry calls getLockInfo again for the message
      s3Client.send.mockResolvedValueOnce({
        Body: { transformToString: () => Promise.resolve(JSON.stringify(activeLock)) },
      });

      // Second attempt: PutObject succeeds
      s3Client.send.mockResolvedValueOnce({});

      await lockManager.acquireLockWithRetry('test-stack', 'user', 'deploy', 3, 10);
    });

    it('should clean up expired lock during retry and acquire', async () => {
      // First attempt: PutObject fails
      const preconditionError = new S3ServiceException({ name: 'PreconditionFailed', $fault: 'client', $metadata: {} });
      s3Client.send.mockRejectedValueOnce(preconditionError);

      // GetObject: expired lock
      const expiredLock: LockInfo = {
        owner: 'dead-process@host:999',
        timestamp: Date.now() - 60 * 60 * 1000,
        expiresAt: Date.now() - 30 * 60 * 1000,
      };
      s3Client.send.mockResolvedValueOnce({
        Body: { transformToString: () => Promise.resolve(JSON.stringify(expiredLock)) },
      });

      // DeleteObject (cleanup)
      s3Client.send.mockResolvedValueOnce({});

      // PutObject retry succeeds (inside acquireLock)
      s3Client.send.mockResolvedValueOnce({});

      await lockManager.acquireLockWithRetry('test-stack', 'user', 'deploy', 3, 10);
    });

    it('should throw LockError after all retries exhausted', async () => {
      // Setup: lock is always held by another process (not expired)
      const activeLock: LockInfo = {
        owner: 'busy-user@host:200',
        timestamp: Date.now(),
        expiresAt: Date.now() + 30 * 60 * 1000,
        operation: 'deploy',
      };

      // Each attempt: PutObject fails + GetObject returns non-expired lock
      // acquireLock checks for expired lock internally, so each acquireLock call = 2 S3 calls
      // Then acquireLockWithRetry calls getLockInfo again for the retry message = 1 more S3 call
      // Total per attempt: 3 S3 calls
      // Plus final getLockInfo for the error message
      for (let i = 0; i < 20; i++) {
        const err = new Error('PreconditionFailed');
        err.name = 'PreconditionFailed';
        s3Client.send.mockRejectedValueOnce(err);
        s3Client.send.mockResolvedValueOnce({
          Body: { transformToString: () => Promise.resolve(JSON.stringify(activeLock)) },
        });
        s3Client.send.mockResolvedValueOnce({
          Body: { transformToString: () => Promise.resolve(JSON.stringify(activeLock)) },
        });
      }

      await expect(
        lockManager.acquireLockWithRetry('test-stack', 'user', 'deploy', 3, 10)
      ).rejects.toThrow(LockError);
    });

    it('should throw LockError with helpful message after retries exhausted', async () => {
      // All attempts fail with PreconditionFailed (lock held)
      const err = new Error('PreconditionFailed');
      err.name = 'PreconditionFailed';
      s3Client.send.mockRejectedValue(err);

      try {
        await lockManager.acquireLockWithRetry('test-stack', 'user', 'deploy', 1, 10);
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LockError);
        const lockError = error as LockError;
        assert.ok((lockError.message).includes('test-stack'));
      }
    });
  });

  describe('lock.json format', () => {
    it('should write lock with correct JSON structure', async () => {
      s3Client.send.mockResolvedValueOnce({});

      await lockManager.acquireLock('test-stack', 'user@host:123', 'deploy');

      const putCall = s3Client.send.mock.calls[0][0];
      const lockBody = JSON.parse(putCall.input.Body);

      // Verify the exact lock.json structure
      expect(lockBody).toHaveProperty('owner', 'user@host:123');
      expect(lockBody).toHaveProperty('operation', 'deploy');
      expect(lockBody).toHaveProperty('timestamp');
      expect(lockBody).toHaveProperty('expiresAt');
      assert.strictEqual(typeof lockBody.timestamp, 'number');
      assert.strictEqual(typeof lockBody.expiresAt, 'number');
      expect(lockBody.expiresAt).toBeGreaterThan(lockBody.timestamp);
    });

    it('should omit operation when not provided', async () => {
      s3Client.send.mockResolvedValueOnce({});

      await lockManager.acquireLock('test-stack', 'user@host:123');

      const putCall = s3Client.send.mock.calls[0][0];
      const lockBody = JSON.parse(putCall.input.Body);

      expect(lockBody).not.toHaveProperty('operation');
      expect(lockBody).toHaveProperty('owner');
      expect(lockBody).toHaveProperty('timestamp');
      expect(lockBody).toHaveProperty('expiresAt');
    });
  });
});
