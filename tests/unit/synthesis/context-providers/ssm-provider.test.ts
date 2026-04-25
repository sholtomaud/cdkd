import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';

// Mock AWS SDK
const mockSend = mock.fn();
const mockDestroy = mock.fn();
vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: mock.fn().mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  })),
  GetParameterCommand: mock.fn().mockImplementation((input) => ({
    ...input,
    _type: 'GetParameterCommand',
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

import { SSMContextProvider } from '../../../../src/synthesis/context-providers/ssm-provider.ts';

describe('SSMContextProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return SSM parameter value', async () => {
    mockSend.mockResolvedValue({
      Parameter: {
        Name: '/my/param',
        Value: 'my-value',
      },
    });

    const provider = new SSMContextProvider({ region: 'us-east-1' });
    const result = await provider.resolve({ parameterName: '/my/param' });

    assert.strictEqual(result, 'my-value');
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('should throw when parameterName not provided', async () => {
    const provider = new SSMContextProvider({ region: 'us-east-1' });

    await expect(provider.resolve({})).rejects.toThrow(
      'SSM context provider requires parameterName property'
    );
  });

  it('should throw when parameter not found', async () => {
    mockSend.mockResolvedValue({
      Parameter: undefined,
    });

    const provider = new SSMContextProvider({ region: 'us-east-1' });

    await expect(
      provider.resolve({ parameterName: '/nonexistent/param' })
    ).rejects.toThrow('SSM parameter not found: /nonexistent/param');
  });

  it('should throw when parameter value is undefined', async () => {
    mockSend.mockResolvedValue({
      Parameter: {
        Name: '/my/param',
        Value: undefined,
      },
    });

    const provider = new SSMContextProvider({ region: 'us-east-1' });

    await expect(
      provider.resolve({ parameterName: '/my/param' })
    ).rejects.toThrow('SSM parameter not found: /my/param');
  });

  it('should return dummyValue when ignoreErrorOnMissingContext is true and parameter missing', async () => {
    mockSend.mockResolvedValue({
      Parameter: undefined,
    });

    const provider = new SSMContextProvider({ region: 'us-east-1' });
    const result = await provider.resolve({
      parameterName: '/nonexistent/param',
      ignoreErrorOnMissingContext: true,
      dummyValue: 'fallback-value',
    });

    assert.strictEqual(result, 'fallback-value');
  });

  it('should throw when ignoreErrorOnMissingContext is true but dummyValue is not set', async () => {
    mockSend.mockResolvedValue({
      Parameter: undefined,
    });

    const provider = new SSMContextProvider({ region: 'us-east-1' });

    await expect(
      provider.resolve({
        parameterName: '/nonexistent/param',
        ignoreErrorOnMissingContext: true,
      })
    ).rejects.toThrow('SSM parameter not found: /nonexistent/param');
  });

  it('should use region from props over awsConfig', async () => {
    mockSend.mockResolvedValue({
      Parameter: { Name: '/p', Value: 'v' },
    });

    const { SSMClient } = await import('@aws-sdk/client-ssm');

    const provider = new SSMContextProvider({ region: 'us-east-1' });
    await provider.resolve({
      parameterName: '/p',
      region: 'eu-west-1',
    });

    expect(SSMClient).toHaveBeenCalledWith({ region: 'eu-west-1' });
  });
});
