import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

// Mock node:child_process
vi.mock('node:child_process', () => ({
  spawn: mock.fn(),
}));

// Mock node:fs
vi.mock('node:fs', () => ({
  writeFileSync: mock.fn(),
  mkdtempSync: mock.fn(),
  rmSync: mock.fn(),
}));

// Note: node:os is NOT mocked - tmpdir() uses real OS temp directory

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

import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { AppExecutor } from '../../../src/synthesis/app-executor.ts';
import { SynthesisError } from '../../../src/utils/error-handler.ts';

/**
 * Helper to create a mock ChildProcess that emits events
 */
function createMockProcess(): ChildProcess & {
  _stdout: EventEmitter;
  _stderr: EventEmitter;
} {
  const proc = new EventEmitter() as ChildProcess & {
    _stdout: EventEmitter;
    _stderr: EventEmitter;
  };
  proc._stdout = new EventEmitter();
  proc._stderr = new EventEmitter();
  (proc as unknown as Record<string, unknown>).stdout = proc._stdout;
  (proc as unknown as Record<string, unknown>).stderr = proc._stderr;
  return proc;
}

describe('AppExecutor', () => {
  let executor: AppExecutor;

  beforeEach(() => {
    vi.resetAllMocks();
    executor = new AppExecutor();
  });

  describe('execute', () => {
    it('should execute CDK app command via subprocess', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executor.execute({
        app: 'npx ts-node bin/app.ts',
        outputDir: '/tmp/cdk.out',
        context: { foo: 'bar' },
      });

      // Simulate successful exit
      mockProc.emit('close', 0);

      await promise;

      expect(spawn).toHaveBeenCalledWith(
        'npx ts-node bin/app.ts',
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true,
        })
      );
    });

    it('should pass proper environment variables', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executor.execute({
        app: 'npx ts-node bin/app.ts',
        outputDir: '/tmp/cdk.out',
        context: { key: 'value' },
        region: 'us-east-1',
        accountId: '123456789012',
      });

      mockProc.emit('close', 0);
      await promise;

      const callEnv = vi.mocked(spawn).mock.calls[0][1] as { env: Record<string, string> };
      const env = callEnv.env;

      assert.strictEqual(env['CDK_OUTDIR'], '/tmp/cdk.out');
      assert.strictEqual(env['CDK_DEFAULT_REGION'], 'us-east-1');
      assert.strictEqual(env['CDK_DEFAULT_ACCOUNT'], '123456789012');
      assert.strictEqual(env['CDK_CLI_ASM_VERSION'], '38.0.0');
      assert.strictEqual(env['CDK_CONTEXT_JSON'], JSON.stringify({ key: 'value' }));
    });

    it('should handle large context by writing to temp file', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);
      const fakeTempDir = '/fake/cdkd-context-abc123';
      vi.mocked(mkdtempSync).mockReturnValue(fakeTempDir);

      // Create a context larger than 32KB
      const largeContext: Record<string, string> = {};
      for (let i = 0; i < 2000; i++) {
        largeContext[`key-${i}`] = 'x'.repeat(20);
      }

      const promise = executor.execute({
        app: 'npx ts-node bin/app.ts',
        outputDir: '/tmp/cdk.out',
        context: largeContext,
      });

      mockProc.emit('close', 0);
      await promise;

      // Should have written context to temp file
      expect(mkdtempSync).toHaveBeenCalled();
      expect(writeFileSync).toHaveBeenCalledWith(
        `${fakeTempDir}/context.json`,
        JSON.stringify(largeContext),
        'utf-8'
      );

      // Should set CONTEXT_OVERFLOW_LOCATION_ENV instead of CDK_CONTEXT_JSON
      const callEnv = vi.mocked(spawn).mock.calls[0][1] as { env: Record<string, string> };
      const env = callEnv.env;
      assert.strictEqual(env['CONTEXT_OVERFLOW_LOCATION_ENV'], `${fakeTempDir}/context.json`);
      assert.strictEqual(env['CDK_CONTEXT_JSON'], undefined);

      // Should clean up temp dir
      expect(rmSync).toHaveBeenCalledWith(fakeTempDir, {
        recursive: true,
        force: true,
      });
    });

    it('should prepend node for .js files', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executor.execute({
        app: 'bin/app.ts',
        outputDir: '/tmp/cdk.out',
        context: {},
      });

      mockProc.emit('close', 0);
      await promise;

      const commandLine = vi.mocked(spawn).mock.calls[0][0] as string;
      assert.ok((commandLine).includes(process.execPath));
      assert.ok((commandLine).includes('bin/app.ts'));
    });

    it('should throw SynthesisError on non-zero exit code', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executor.execute({
        app: 'npx ts-node bin/app.ts',
        outputDir: '/tmp/cdk.out',
        context: {},
      });

      mockProc.emit('close', 1);

      await assert.rejects(async () => { await promise; }, SynthesisError);
      await assert.rejects(async () => { await promise; }, /exited with code 1/);
    });

    it('should include stderr in error message on failure', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executor.execute({
        app: 'npx ts-node bin/app.ts',
        outputDir: '/tmp/cdk.out',
        context: {},
      });

      // Emit stderr data before exit
      mockProc._stderr.emit('data', Buffer.from('Error: something went wrong'));
      mockProc.emit('close', 1);

      await assert.rejects(async () => { await promise; }, /something went wrong/);
    });

    it('should throw SynthesisError on spawn error', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executor.execute({
        app: 'nonexistent-command',
        outputDir: '/tmp/cdk.out',
        context: {},
      });

      mockProc.emit('error', new Error('spawn ENOENT'));

      await assert.rejects(async () => { await promise; }, SynthesisError);
      await assert.rejects(async () => { await promise; }, /Failed to execute CDK app/);
    });

    it('should not set CDK_DEFAULT_REGION when region is not provided', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executor.execute({
        app: 'npx ts-node bin/app.ts',
        outputDir: '/tmp/cdk.out',
        context: {},
      });

      mockProc.emit('close', 0);
      await promise;

      const callEnv = vi.mocked(spawn).mock.calls[0][1] as { env: Record<string, string> };
      const env = callEnv.env;
      assert.strictEqual(env['CDK_DEFAULT_REGION'], undefined);
      assert.strictEqual(env['CDK_DEFAULT_ACCOUNT'], undefined);
    });
  });
});
