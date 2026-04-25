import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';

// Capture what AppExecutor.execute receives
const mockExecute = mock.fn();
const mockReadManifest = mock.fn();
const mockGetAllStacks = mock.fn();
const mockContextStoreLoad = mock.fn();
const mockContextStoreSave = mock.fn();

// Mock AppExecutor
vi.mock('../../../src/synthesis/app-executor.ts', () => ({
  AppExecutor: mock.fn().mockImplementation(() => ({
    execute: mockExecute,
  })),
}));

// Mock AssemblyReader
vi.mock('../../../src/synthesis/assembly-reader.ts', () => ({
  AssemblyReader: mock.fn().mockImplementation(() => ({
    readManifest: mockReadManifest,
    getAllStacks: mockGetAllStacks,
  })),
}));

// Mock ContextStore
vi.mock('../../../src/synthesis/context-store.ts', () => ({
  ContextStore: mock.fn().mockImplementation(() => ({
    load: mockContextStoreLoad,
    save: mockContextStoreSave,
  })),
}));

// Mock ContextProviderRegistry
vi.mock('../../../src/synthesis/context-providers/index.ts', () => ({
  ContextProviderRegistry: mock.fn().mockImplementation(() => ({
    resolve: mock.fn().mockResolvedValue({}),
  })),
}));

// Mock config-loader
const mockLoadCdkJson = mock.fn();
const mockLoadUserCdkJson = mock.fn();
vi.mock('../../../src/cli/config-loader.ts', () => ({
  loadCdkJson: () => mockLoadCdkJson(),
  loadUserCdkJson: () => mockLoadUserCdkJson(),
}));

// Mock STS
vi.mock('@aws-sdk/client-sts', () => ({
  STSClient: mock.fn().mockImplementation(() => ({
    send: mock.fn().mockResolvedValue({ Account: '123456789012' }),
    destroy: mock.fn(),
  })),
  GetCallerIdentityCommand: mock.fn(),
}));

// Mock node:fs
vi.mock('node:fs', () => ({
  mkdirSync: mock.fn(),
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

import { Synthesizer } from '../../../src/synthesis/synthesizer.ts';

describe('Synthesizer', () => {
  let synthesizer: Synthesizer;

  beforeEach(() => {
    vi.clearAllMocks();
    synthesizer = new Synthesizer();

    // Default: no missing context, return empty stacks
    mockReadManifest.mockReturnValue({ version: '38.0.0', artifacts: {} });
    mockGetAllStacks.mockReturnValue([]);
    mockExecute.mockResolvedValue(undefined);
    mockContextStoreLoad.mockReturnValue({});
    mockLoadCdkJson.mockReturnValue(null);
    mockLoadUserCdkJson.mockReturnValue(null);
  });

  describe('context merge order', () => {
    it('should include CDK default context values (bundling-stacks, metadata flags)', async () => {
      await synthesizer.synthesize({ app: 'npx ts-node app.ts' });

      const passedContext = mockExecute.mock.calls[0]![0].context as Record<string, unknown>;
      assert.strictEqual(passedContext['aws:cdk:enable-path-metadata'], true);
      assert.strictEqual(passedContext['aws:cdk:enable-asset-metadata'], true);
      assert.strictEqual(passedContext['aws:cdk:version-reporting'], true);
      assert.deepStrictEqual(passedContext['aws:cdk:bundling-stacks'], ['**']);
    });

    it('should merge ~/.cdk.json context', async () => {
      mockLoadUserCdkJson.mockReturnValue({
        context: { 'user-default': 'from-home' },
      });

      await synthesizer.synthesize({ app: 'npx ts-node app.ts' });

      const passedContext = mockExecute.mock.calls[0]![0].context as Record<string, unknown>;
      assert.strictEqual(passedContext['user-default'], 'from-home');
    });

    it('should merge cdk.json context over ~/.cdk.json', async () => {
      mockLoadUserCdkJson.mockReturnValue({
        context: { shared: 'from-home', 'home-only': 'value' },
      });
      mockLoadCdkJson.mockReturnValue({
        context: { shared: 'from-project', 'project-only': 'value' },
      });

      await synthesizer.synthesize({ app: 'npx ts-node app.ts' });

      const passedContext = mockExecute.mock.calls[0]![0].context as Record<string, unknown>;
      assert.strictEqual(passedContext['shared'], 'from-project');
      assert.strictEqual(passedContext['home-only'], 'value');
      assert.strictEqual(passedContext['project-only'], 'value');
    });

    it('should merge cdk.context.json over cdk.json', async () => {
      mockLoadCdkJson.mockReturnValue({
        context: { key: 'from-cdk-json' },
      });
      mockContextStoreLoad.mockReturnValue({
        key: 'from-cdk-context-json',
      });

      await synthesizer.synthesize({ app: 'npx ts-node app.ts' });

      const passedContext = mockExecute.mock.calls[0]![0].context as Record<string, unknown>;
      assert.strictEqual(passedContext['key'], 'from-cdk-context-json');
    });

    it('should merge CLI -c context over everything', async () => {
      mockLoadUserCdkJson.mockReturnValue({ context: { key: 'home' } });
      mockLoadCdkJson.mockReturnValue({ context: { key: 'project' } });
      mockContextStoreLoad.mockReturnValue({ key: 'cached' });

      await synthesizer.synthesize({
        app: 'npx ts-node app.ts',
        context: { key: 'cli' },
      });

      const passedContext = mockExecute.mock.calls[0]![0].context as Record<string, unknown>;
      assert.strictEqual(passedContext['key'], 'cli');
    });

    it('should apply full priority: defaults < ~/.cdk.json < cdk.json < cdk.context.json < CLI', async () => {
      mockLoadUserCdkJson.mockReturnValue({
        context: { a: 'home', b: 'home', c: 'home', d: 'home' },
      });
      mockLoadCdkJson.mockReturnValue({
        context: { b: 'project', c: 'project', d: 'project' },
      });
      mockContextStoreLoad.mockReturnValue({
        c: 'cached',
        d: 'cached',
      });

      await synthesizer.synthesize({
        app: 'npx ts-node app.ts',
        context: { d: 'cli' },
      });

      const passedContext = mockExecute.mock.calls[0]![0].context as Record<string, unknown>;
      assert.strictEqual(passedContext['a'], 'home');
      assert.strictEqual(passedContext['b'], 'project');
      assert.strictEqual(passedContext['c'], 'cached');
      assert.strictEqual(passedContext['d'], 'cli');
      // CDK defaults should still be present
      assert.deepStrictEqual(passedContext['aws:cdk:bundling-stacks'], ['**']);
    });

    it('should allow cdk.json to override CDK default context values', async () => {
      mockLoadCdkJson.mockReturnValue({
        context: { 'aws:cdk:enable-path-metadata': false },
      });

      await synthesizer.synthesize({ app: 'npx ts-node app.ts' });

      const passedContext = mockExecute.mock.calls[0]![0].context as Record<string, unknown>;
      assert.strictEqual(passedContext['aws:cdk:enable-path-metadata'], false);
    });

    it('should pass cdk.json feature flags to CDK app', async () => {
      mockLoadCdkJson.mockReturnValue({
        context: {
          '@aws-cdk/aws-lambda:recognizeLayerVersion': true,
          '@aws-cdk/core:newStyleStackSynthesis': true,
          '@aws-cdk/aws-s3:serverAccessLogsUseBucketPolicy': true,
        },
      });

      await synthesizer.synthesize({ app: 'npx ts-node app.ts' });

      const passedContext = mockExecute.mock.calls[0]![0].context as Record<string, unknown>;
      assert.strictEqual(passedContext['@aws-cdk/aws-lambda:recognizeLayerVersion'], true);
      assert.strictEqual(passedContext['@aws-cdk/core:newStyleStackSynthesis'], true);
      assert.strictEqual(passedContext['@aws-cdk/aws-s3:serverAccessLogsUseBucketPolicy'], true);
    });
  });
});
