import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';

// Mock AWS clients before importing the provider
const mockSend = mock.fn();

vi.mock('@aws-sdk/client-route-53', async () => {
  const actual = await vi.importActual('@aws-sdk/client-route-53');
  return {
    ...actual,
    Route53Client: mock.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

vi.mock('../../../src/utils/logger.ts', () => {
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

import { Route53Provider } from '../../../src/provisioning/providers/route53-provider.ts';

describe('Route53Provider', () => {
  let provider: Route53Provider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new Route53Provider();
  });

  // ─── AWS::Route53::HostedZone ──────────────────────────────────────

  describe('HostedZone', () => {
    describe('create', () => {
      it('should create hosted zone and return zone ID without /hostedzone/ prefix', async () => {
        mockSend.mockResolvedValueOnce({
          HostedZone: { Id: '/hostedzone/Z1234567890' },
          DelegationSet: {
            NameServers: ['ns-1.example.com', 'ns-2.example.com'],
          },
        });

        const result = await provider.create(
          'MyZone',
          'AWS::Route53::HostedZone',
          { Name: 'example.com' }
        );

        assert.strictEqual(result.physicalId, 'Z1234567890');
        expect(result.attributes).toEqual({
          Id: 'Z1234567890',
          NameServers: 'ns-1.example.com,ns-2.example.com',
        });
        expect(mockSend).toHaveBeenCalledTimes(1);

        const createCall = mockSend.mock.calls[0][0];
        assert.strictEqual(createCall.constructor.name, 'CreateHostedZoneCommand');
        assert.strictEqual(createCall.input.Name, 'example.com');
      });
    });

    describe('delete', () => {
      it('should delete hosted zone', async () => {
        // First call: ListQueryLoggingConfigs (cleanup before delete)
        mockSend.mockResolvedValueOnce({ QueryLoggingConfigs: [] });
        // Second call: DeleteHostedZone
        mockSend.mockResolvedValueOnce({});

        await provider.delete(
          'MyZone',
          'Z1234567890',
          'AWS::Route53::HostedZone'
        );

        expect(mockSend).toHaveBeenCalledTimes(2);

        const listCall = mockSend.mock.calls[0][0];
        assert.strictEqual(listCall.constructor.name, 'ListQueryLoggingConfigsCommand');

        const deleteCall = mockSend.mock.calls[1][0];
        assert.strictEqual(deleteCall.constructor.name, 'DeleteHostedZoneCommand');
        assert.strictEqual(deleteCall.input.Id, 'Z1234567890');
      });

      it('should handle NoSuchHostedZone', async () => {
        // ListQueryLoggingConfigs succeeds (or fails gracefully)
        mockSend.mockResolvedValueOnce({ QueryLoggingConfigs: [] });
        // DeleteHostedZone throws NoSuchHostedZone
        const error = new Error('No such hosted zone');
        error.name = 'NoSuchHostedZone';
        mockSend.mockRejectedValueOnce(error);

        await provider.delete(
          'MyZone',
          'Z1234567890',
          'AWS::Route53::HostedZone'
        );

        expect(mockSend).toHaveBeenCalledTimes(2);
      });
    });
  });

  // ─── AWS::Route53::RecordSet ───────────────────────────────────────

  describe('RecordSet', () => {
    describe('create', () => {
      it('should create record set with composite physicalId (zoneId|name|type)', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await provider.create(
          'MyRecord',
          'AWS::Route53::RecordSet',
          {
            HostedZoneId: 'Z1234567890',
            Name: 'www.example.com.',
            Type: 'A',
            TTL: '300',
            ResourceRecords: ['1.2.3.4'],
          }
        );

        assert.strictEqual(result.physicalId, 'Z1234567890|www.example.com.|A');
        expect(mockSend).toHaveBeenCalledTimes(1);

        const changeCall = mockSend.mock.calls[0][0];
        expect(changeCall.constructor.name).toBe(
          'ChangeResourceRecordSetsCommand'
        );
        assert.strictEqual(changeCall.input.ChangeBatch.Changes[0].Action, 'CREATE');
      });

      it('should convert ResourceRecords strings to {Value} format', async () => {
        mockSend.mockResolvedValueOnce({});

        await provider.create('MyRecord', 'AWS::Route53::RecordSet', {
          HostedZoneId: 'Z1234567890',
          Name: 'www.example.com.',
          Type: 'A',
          TTL: '300',
          ResourceRecords: ['1.2.3.4', '5.6.7.8'],
        });

        const changeCall = mockSend.mock.calls[0][0];
        const recordSet =
          changeCall.input.ChangeBatch.Changes[0].ResourceRecordSet;
        expect(recordSet.ResourceRecords).toEqual([
          { Value: '1.2.3.4' },
          { Value: '5.6.7.8' },
        ]);
      });

      it('should handle AliasTarget', async () => {
        mockSend.mockResolvedValueOnce({});

        await provider.create('MyAlias', 'AWS::Route53::RecordSet', {
          HostedZoneId: 'Z1234567890',
          Name: 'www.example.com.',
          Type: 'A',
          AliasTarget: {
            HostedZoneId: 'Z2FDTNDATAQYW2',
            DNSName: 'd123456.cloudfront.net.',
            EvaluateTargetHealth: false,
          },
        });

        const changeCall = mockSend.mock.calls[0][0];
        const recordSet =
          changeCall.input.ChangeBatch.Changes[0].ResourceRecordSet;
        expect(recordSet.AliasTarget).toEqual({
          HostedZoneId: 'Z2FDTNDATAQYW2',
          DNSName: 'd123456.cloudfront.net.',
          EvaluateTargetHealth: false,
        });
        // AliasTarget records should not have TTL or ResourceRecords
        assert.strictEqual(recordSet.TTL, undefined);
        assert.strictEqual(recordSet.ResourceRecords, undefined);
      });
    });

    describe('update', () => {
      it('should UPSERT record', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await provider.update(
          'MyRecord',
          'Z1234567890|www.example.com.|A',
          'AWS::Route53::RecordSet',
          {
            HostedZoneId: 'Z1234567890',
            Name: 'www.example.com.',
            Type: 'A',
            TTL: '600',
            ResourceRecords: ['1.2.3.4'],
          },
          {
            HostedZoneId: 'Z1234567890',
            Name: 'www.example.com.',
            Type: 'A',
            TTL: '300',
            ResourceRecords: ['1.2.3.4'],
          }
        );

        assert.strictEqual(result.physicalId, 'Z1234567890|www.example.com.|A');
        assert.strictEqual(result.wasReplaced, false);
        expect(mockSend).toHaveBeenCalledTimes(1);

        const changeCall = mockSend.mock.calls[0][0];
        assert.strictEqual(changeCall.input.ChangeBatch.Changes[0].Action, 'UPSERT');
      });
    });

    describe('delete', () => {
      it('should DELETE record', async () => {
        mockSend.mockResolvedValueOnce({});

        await provider.delete(
          'MyRecord',
          'Z1234567890|www.example.com.|A',
          'AWS::Route53::RecordSet',
          {
            HostedZoneId: 'Z1234567890',
            Name: 'www.example.com.',
            Type: 'A',
            TTL: '300',
            ResourceRecords: ['1.2.3.4'],
          }
        );

        expect(mockSend).toHaveBeenCalledTimes(1);

        const changeCall = mockSend.mock.calls[0][0];
        expect(changeCall.constructor.name).toBe(
          'ChangeResourceRecordSetsCommand'
        );
        assert.strictEqual(changeCall.input.ChangeBatch.Changes[0].Action, 'DELETE');
      });

      it('should handle not-found error (InvalidChangeBatch)', async () => {
        const error = new Error(
          'Tried to delete resource record set but it was not found'
        );
        error.name = 'InvalidChangeBatch';
        mockSend.mockRejectedValueOnce(error);

        await provider.delete(
          'MyRecord',
          'Z1234567890|www.example.com.|A',
          'AWS::Route53::RecordSet',
          {
            HostedZoneId: 'Z1234567890',
            Name: 'www.example.com.',
            Type: 'A',
            TTL: '300',
            ResourceRecords: ['1.2.3.4'],
          }
        );

        expect(mockSend).toHaveBeenCalledTimes(1);
      });
    });
  });
});
