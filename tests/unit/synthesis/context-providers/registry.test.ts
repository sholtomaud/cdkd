import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';

// Mock all provider constructors to avoid real AWS SDK usage
vi.mock('../../../../src/synthesis/context-providers/az-provider.ts', () => ({
  AZContextProvider: mock.fn().mockImplementation(() => ({
    resolve: mock.fn(),
  })),
}));

vi.mock('../../../../src/synthesis/context-providers/ssm-provider.ts', () => ({
  SSMContextProvider: mock.fn().mockImplementation(() => ({
    resolve: mock.fn(),
  })),
}));

vi.mock('../../../../src/synthesis/context-providers/hosted-zone-provider.ts', () => ({
  HostedZoneContextProvider: mock.fn().mockImplementation(() => ({
    resolve: mock.fn(),
  })),
}));

vi.mock('../../../../src/synthesis/context-providers/vpc-provider.ts', () => ({
  VpcContextProvider: mock.fn().mockImplementation(() => ({
    resolve: mock.fn(),
  })),
}));

vi.mock('../../../../src/synthesis/context-providers/cc-api-provider.ts', () => ({
  CcApiContextProvider: mock.fn().mockImplementation(() => ({
    resolve: mock.fn(),
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

import { ContextProviderRegistry } from '../../../../src/synthesis/context-providers/index.ts';
import type { MissingContext } from '../../../../src/types/assembly.ts';

describe('ContextProviderRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should resolve missing context using registered providers', async () => {
    const registry = new ContextProviderRegistry({ region: 'us-east-1' });

    // Register a custom mock provider
    const mockProvider = { resolve: mock.fn().mockResolvedValue(['us-east-1a', 'us-east-1b']) };
    registry.register('availability-zones', mockProvider);

    const missing: MissingContext[] = [
      {
        key: 'availability-zones:account=123456789012:region=us-east-1',
        provider: 'availability-zones',
        props: { account: '123456789012', region: 'us-east-1' },
      },
    ];

    const results = await registry.resolve(missing);

    expect(results['availability-zones:account=123456789012:region=us-east-1']).toEqual([
      'us-east-1a',
      'us-east-1b',
    ]);
    expect(mockProvider.resolve).toHaveBeenCalledWith({
      region: 'us-east-1',
      account: '123456789012',
    });
  });

  it('should return provider error for unknown provider types', async () => {
    const registry = new ContextProviderRegistry();

    const missing: MissingContext[] = [
      {
        key: 'unknown:key',
        provider: 'unknown-provider-type',
        props: { account: '123456789012', region: 'us-east-1' },
      },
    ];

    const results = await registry.resolve(missing);

    expect(results['unknown:key']).toEqual({
      $providerError: 'Unknown context provider: unknown-provider-type',
      $dontSaveContext: true,
    });
  });

  it('should mark provider errors as transient ($dontSaveContext)', async () => {
    const registry = new ContextProviderRegistry();

    const missing: MissingContext[] = [
      {
        key: 'some:key',
        provider: 'non-existent',
        props: { account: '123456789012', region: 'us-east-1' },
      },
    ];

    const results = await registry.resolve(missing);
    const errorResult = results['some:key'] as Record<string, unknown>;

    assert.strictEqual(errorResult['$dontSaveContext'], true);
    assert.notStrictEqual(errorResult['$providerError'], undefined);
  });

  it('should handle provider resolution failures gracefully', async () => {
    const registry = new ContextProviderRegistry();

    // Register a provider that throws
    const failingProvider = {
      resolve: mock.fn().mockRejectedValue(new Error('AWS API call failed')),
    };
    registry.register('failing-provider', failingProvider);

    const missing: MissingContext[] = [
      {
        key: 'fail:key',
        provider: 'failing-provider',
        props: { account: '123456789012', region: 'us-east-1', some: 'prop' },
      },
    ];

    const results = await registry.resolve(missing);

    expect(results['fail:key']).toEqual({
      $providerError: 'AWS API call failed',
      $dontSaveContext: true,
    });
  });

  it('should resolve multiple missing context entries', async () => {
    const registry = new ContextProviderRegistry();

    const azProvider = { resolve: mock.fn().mockResolvedValue(['us-east-1a']) };
    const ssmProvider = { resolve: mock.fn().mockResolvedValue('param-value') };
    registry.register('availability-zones', azProvider);
    registry.register('ssm', ssmProvider);

    const missing: MissingContext[] = [
      {
        key: 'az:key',
        provider: 'availability-zones',
        props: { account: '123456789012', region: 'us-east-1' },
      },
      {
        key: 'ssm:key',
        provider: 'ssm',
        props: { account: '123456789012', region: 'us-east-1', parameterName: '/my/param' },
      },
    ];

    const results = await registry.resolve(missing);

    assert.deepStrictEqual(results['az:key'], ['us-east-1a']);
    assert.strictEqual(results['ssm:key'], 'param-value');
  });
});
