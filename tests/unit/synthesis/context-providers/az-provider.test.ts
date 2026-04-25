import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';

// Mock AWS SDK
const mockSend = mock.fn();
const mockDestroy = mock.fn();
vi.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: mock.fn().mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  })),
  DescribeAvailabilityZonesCommand: mock.fn().mockImplementation((input) => ({
    ...input,
    _type: 'DescribeAvailabilityZonesCommand',
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

import { AZContextProvider } from '../../../../src/synthesis/context-providers/az-provider.ts';

describe('AZContextProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return available AZ names sorted', async () => {
    mockSend.mockResolvedValue({
      AvailabilityZones: [
        { ZoneName: 'us-east-1c', State: 'available' },
        { ZoneName: 'us-east-1a', State: 'available' },
        { ZoneName: 'us-east-1b', State: 'available' },
      ],
    });

    const provider = new AZContextProvider({ region: 'us-east-1' });
    const result = await provider.resolve({});

    assert.deepStrictEqual(result, ['us-east-1a', 'us-east-1b', 'us-east-1c']);
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('should filter out non-available zones', async () => {
    mockSend.mockResolvedValue({
      AvailabilityZones: [
        { ZoneName: 'us-east-1a', State: 'available' },
        { ZoneName: 'us-east-1b', State: 'impaired' },
        { ZoneName: 'us-east-1c', State: 'unavailable' },
        { ZoneName: 'us-east-1d', State: 'available' },
      ],
    });

    const provider = new AZContextProvider();
    const result = await provider.resolve({});

    assert.deepStrictEqual(result, ['us-east-1a', 'us-east-1d']);
  });

  it('should use region from props', async () => {
    mockSend.mockResolvedValue({
      AvailabilityZones: [
        { ZoneName: 'ap-northeast-1a', State: 'available' },
      ],
    });

    const { EC2Client } = await import('@aws-sdk/client-ec2');

    const provider = new AZContextProvider({ region: 'us-east-1' });
    await provider.resolve({ region: 'ap-northeast-1' });

    // Props region should be used (passed to EC2Client constructor)
    expect(EC2Client).toHaveBeenCalledWith({ region: 'ap-northeast-1' });
  });

  it('should handle empty AvailabilityZones response', async () => {
    mockSend.mockResolvedValue({
      AvailabilityZones: [],
    });

    const provider = new AZContextProvider({ region: 'us-east-1' });
    const result = await provider.resolve({});

    assert.deepStrictEqual(result, []);
  });

  it('should handle undefined AvailabilityZones response', async () => {
    mockSend.mockResolvedValue({});

    const provider = new AZContextProvider({ region: 'us-east-1' });
    const result = await provider.resolve({});

    assert.deepStrictEqual(result, []);
  });
});
