import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';

// Mock node:fs before importing the module under test
vi.mock('node:fs', () => ({
  existsSync: mock.fn(),
  readFileSync: mock.fn(),
}));

// Mock logger to avoid console output in tests
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

import { existsSync, readFileSync } from 'node:fs';
import {
  loadCdkJson,
  loadUserCdkJson,
  resolveApp,
  resolveStateBucket,
  getDefaultStateBucketName,
} from '../../../src/cli/config-loader.ts';

describe('config-loader', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    // Clone env so mutations don't leak between tests
    process.env = { ...originalEnv };
    delete process.env['CDKD_APP'];
    delete process.env['CDKD_STATE_BUCKET'];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadCdkJson', () => {
    it('should return null when no cdk.json exists', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = loadCdkJson('/some/dir');

      assert.strictEqual(result, null);
      expect(existsSync).toHaveBeenCalledWith('/some/dir/cdk.json');
    });

    it('should parse valid cdk.json', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          app: 'npx ts-node bin/app.ts',
          output: 'cdk.out',
          context: { foo: 'bar' },
        })
      );

      const result = loadCdkJson('/project');

      expect(result).toEqual({
        app: 'npx ts-node bin/app.ts',
        output: 'cdk.out',
        context: { foo: 'bar' },
      });
    });

    it('should return null when cdk.json contains invalid JSON', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('{ invalid json !!!');

      const result = loadCdkJson('/project');

      assert.strictEqual(result, null);
    });

    it('should use process.cwd() when no cwd argument is provided', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      loadCdkJson();

      // Should have been called with a path ending in cdk.json based on cwd
      expect(existsSync).toHaveBeenCalledTimes(1);
      const calledPath = vi.mocked(existsSync).mock.calls[0][0] as string;
      assert.ok((/cdk\.json$/).test(calledPath));
    });
  });

  describe('resolveApp', () => {
    it('should return CLI value when provided', () => {
      const result = resolveApp('npx ts-node bin/app.ts');

      assert.strictEqual(result, 'npx ts-node bin/app.ts');
    });

    it('should fall back to CDKD_APP env var when CLI value is not provided', () => {
      process.env['CDKD_APP'] = 'npx ts-node bin/env-app.ts';

      const result = resolveApp();

      assert.strictEqual(result, 'npx ts-node bin/env-app.ts');
    });

    it('should fall back to cdk.json app field when CLI and env are not set', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ app: 'npx ts-node bin/cdk-app.ts' })
      );

      const result = resolveApp();

      assert.strictEqual(result, 'npx ts-node bin/cdk-app.ts');
    });

    it('should return undefined when no source provides a value', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = resolveApp();

      assert.strictEqual(result, undefined);
    });

    it('should prioritize CLI over env var', () => {
      process.env['CDKD_APP'] = 'env-app';

      const result = resolveApp('cli-app');

      assert.strictEqual(result, 'cli-app');
    });

    it('should prioritize env var over cdk.json', () => {
      process.env['CDKD_APP'] = 'env-app';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ app: 'cdk-json-app' }));

      const result = resolveApp();

      assert.strictEqual(result, 'env-app');
    });
  });

  describe('resolveStateBucket', () => {
    it('should return CLI value when provided', () => {
      const result = resolveStateBucket('my-cli-bucket');

      assert.strictEqual(result, 'my-cli-bucket');
    });

    it('should fall back to CDKD_STATE_BUCKET env var when CLI value is not provided', () => {
      process.env['CDKD_STATE_BUCKET'] = 'my-env-bucket';

      const result = resolveStateBucket();

      assert.strictEqual(result, 'my-env-bucket');
    });

    it('should fall back to cdk.json context when CLI and env are not set', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          app: 'npx ts-node bin/app.ts',
          context: {
            cdkd: {
              stateBucket: 'my-cdk-json-bucket',
            },
          },
        })
      );

      const result = resolveStateBucket();

      assert.strictEqual(result, 'my-cdk-json-bucket');
    });

    it('should return undefined when no source provides a value', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = resolveStateBucket();

      assert.strictEqual(result, undefined);
    });

    it('should prioritize CLI over env var', () => {
      process.env['CDKD_STATE_BUCKET'] = 'env-bucket';

      const result = resolveStateBucket('cli-bucket');

      assert.strictEqual(result, 'cli-bucket');
    });

    it('should prioritize env var over cdk.json', () => {
      process.env['CDKD_STATE_BUCKET'] = 'env-bucket';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          context: { cdkd: { stateBucket: 'cdk-json-bucket' } },
        })
      );

      const result = resolveStateBucket();

      assert.strictEqual(result, 'env-bucket');
    });

    it('should return undefined when cdk.json context.cdkd.stateBucket is not a string', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          context: { cdkd: { stateBucket: 12345 } },
        })
      );

      const result = resolveStateBucket();

      assert.strictEqual(result, undefined);
    });

    it('should return undefined when cdk.json has no cdkd context', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          app: 'npx ts-node bin/app.ts',
          context: { someOtherKey: 'value' },
        })
      );

      const result = resolveStateBucket();

      assert.strictEqual(result, undefined);
    });
  });

  describe('loadUserCdkJson', () => {
    it('should load ~/.cdk.json when it exists', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ context: { 'user-key': 'user-value' } })
      );

      const result = loadUserCdkJson();

      assert.deepStrictEqual(result, { context: { 'user-key': 'user-value' } });
      const calledPath = vi.mocked(existsSync).mock.calls[0]![0] as string;
      assert.ok((/\.cdk\.json$/).test(calledPath));
    });

    it('should return null when ~/.cdk.json does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = loadUserCdkJson();

      assert.strictEqual(result, null);
    });
  });

  describe('getDefaultStateBucketName', () => {
    it('should generate correct format with account ID and region', () => {
      const result = getDefaultStateBucketName('123456789012', 'us-east-1');

      assert.strictEqual(result, 'cdkd-state-123456789012-us-east-1');
    });

    it('should handle different regions', () => {
      const result = getDefaultStateBucketName('111122223333', 'ap-northeast-1');

      assert.strictEqual(result, 'cdkd-state-111122223333-ap-northeast-1');
    });
  });
});
