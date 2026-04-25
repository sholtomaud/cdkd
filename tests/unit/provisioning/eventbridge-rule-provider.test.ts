import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';
import { ResourceNotFoundException } from '@aws-sdk/client-eventbridge';

// Mock AWS clients before importing the provider
const mockSend = mock.fn();

vi.mock('../../../src/utils/aws-clients.ts', () => ({
  getAwsClients: () => ({
    eventBridge: { send: mockSend },
  }),
}));

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

import { EventBridgeRuleProvider } from '../../../src/provisioning/providers/eventbridge-rule-provider.ts';

describe('EventBridgeRuleProvider', () => {
  let provider: EventBridgeRuleProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new EventBridgeRuleProvider();
  });

  describe('create', () => {
    it('should create a rule without targets', async () => {
      mockSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/my-rule',
      });

      const result = await provider.create('MyRule', 'AWS::Events::Rule', {
        Name: 'my-rule',
        ScheduleExpression: 'rate(5 minutes)',
        State: 'ENABLED',
      });

      assert.strictEqual(result.physicalId, 'arn:aws:events:us-east-1:123456789012:rule/my-rule');
      expect(result.attributes).toEqual({
        Arn: 'arn:aws:events:us-east-1:123456789012:rule/my-rule',
      });
      expect(mockSend).toHaveBeenCalledTimes(1);

      const putRuleCall = mockSend.mock.calls[0][0];
      assert.strictEqual(putRuleCall.constructor.name, 'PutRuleCommand');
    });

    it('should create a rule with targets', async () => {
      // PutRule
      mockSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/my-rule',
      });
      // PutTargets
      mockSend.mockResolvedValueOnce({});

      const result = await provider.create('MyRule', 'AWS::Events::Rule', {
        Name: 'my-rule',
        ScheduleExpression: 'rate(5 minutes)',
        Targets: [
          { Id: 'Target1', Arn: 'arn:aws:lambda:us-east-1:123456789012:function:my-func' },
        ],
      });

      assert.strictEqual(result.physicalId, 'arn:aws:events:us-east-1:123456789012:rule/my-rule');
      expect(mockSend).toHaveBeenCalledTimes(2);

      const putTargetsCall = mockSend.mock.calls[1][0];
      assert.strictEqual(putTargetsCall.constructor.name, 'PutTargetsCommand');
    });

    it('should use logicalId as rule name when Name is not provided', async () => {
      mockSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/MyRule',
      });

      await provider.create('MyRule', 'AWS::Events::Rule', {
        ScheduleExpression: 'rate(1 hour)',
      });

      const putRuleCall = mockSend.mock.calls[0][0];
      assert.strictEqual(putRuleCall.input.Name, 'MyRule');
    });

    it('should stringify EventPattern if it is an object', async () => {
      mockSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/my-rule',
      });

      const eventPattern = { source: ['aws.s3'], 'detail-type': ['Object Created'] };

      await provider.create('MyRule', 'AWS::Events::Rule', {
        Name: 'my-rule',
        EventPattern: eventPattern,
      });

      const putRuleCall = mockSend.mock.calls[0][0];
      assert.strictEqual(putRuleCall.input.EventPattern, JSON.stringify(eventPattern));
    });

    it('should pass EventPattern as-is if it is already a string', async () => {
      mockSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/my-rule',
      });

      const eventPattern = '{"source":["aws.s3"]}';

      await provider.create('MyRule', 'AWS::Events::Rule', {
        Name: 'my-rule',
        EventPattern: eventPattern,
      });

      const putRuleCall = mockSend.mock.calls[0][0];
      assert.strictEqual(putRuleCall.input.EventPattern, eventPattern);
    });

    it('should pass all supported properties to PutRuleCommand', async () => {
      mockSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/my-rule',
      });

      await provider.create('MyRule', 'AWS::Events::Rule', {
        Name: 'my-rule',
        Description: 'My test rule',
        EventBusName: 'custom-bus',
        State: 'DISABLED',
        ScheduleExpression: 'rate(1 hour)',
        RoleArn: 'arn:aws:iam::123456789012:role/my-role',
      });

      const putRuleCall = mockSend.mock.calls[0][0];
      assert.strictEqual(putRuleCall.input.Name, 'my-rule');
      assert.strictEqual(putRuleCall.input.Description, 'My test rule');
      assert.strictEqual(putRuleCall.input.EventBusName, 'custom-bus');
      assert.strictEqual(putRuleCall.input.State, 'DISABLED');
      assert.strictEqual(putRuleCall.input.ScheduleExpression, 'rate(1 hour)');
      assert.strictEqual(putRuleCall.input.RoleArn, 'arn:aws:iam::123456789012:role/my-role');
    });

    it('should throw ProvisioningError on failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      await expect(
        provider.create('MyRule', 'AWS::Events::Rule', {
          Name: 'my-rule',
          ScheduleExpression: 'rate(5 minutes)',
        })
      ).rejects.toThrow('Failed to create EventBridge rule MyRule');
    });
  });

  describe('update', () => {
    it('should update rule properties', async () => {
      // PutRule
      mockSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/my-rule',
      });

      const result = await provider.update(
        'MyRule',
        'arn:aws:events:us-east-1:123456789012:rule/my-rule',
        'AWS::Events::Rule',
        {
          Name: 'my-rule',
          ScheduleExpression: 'rate(10 minutes)',
          State: 'ENABLED',
        },
        {
          Name: 'my-rule',
          ScheduleExpression: 'rate(5 minutes)',
          State: 'ENABLED',
        }
      );

      assert.strictEqual(result.physicalId, 'arn:aws:events:us-east-1:123456789012:rule/my-rule');
      assert.strictEqual(result.wasReplaced, false);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should remove old targets and add new targets', async () => {
      // PutRule
      mockSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/my-rule',
      });
      // RemoveTargets (old target not in new list)
      mockSend.mockResolvedValueOnce({});
      // PutTargets (new targets)
      mockSend.mockResolvedValueOnce({});

      const result = await provider.update(
        'MyRule',
        'arn:aws:events:us-east-1:123456789012:rule/my-rule',
        'AWS::Events::Rule',
        {
          Name: 'my-rule',
          ScheduleExpression: 'rate(5 minutes)',
          Targets: [
            { Id: 'Target2', Arn: 'arn:aws:lambda:us-east-1:123456789012:function:new-func' },
          ],
        },
        {
          Name: 'my-rule',
          ScheduleExpression: 'rate(5 minutes)',
          Targets: [
            { Id: 'Target1', Arn: 'arn:aws:lambda:us-east-1:123456789012:function:old-func' },
          ],
        }
      );

      assert.strictEqual(result.wasReplaced, false);
      expect(mockSend).toHaveBeenCalledTimes(3);

      const removeTargetsCall = mockSend.mock.calls[1][0];
      assert.strictEqual(removeTargetsCall.constructor.name, 'RemoveTargetsCommand');
      assert.deepStrictEqual(removeTargetsCall.input.Ids, ['Target1']);

      const putTargetsCall = mockSend.mock.calls[2][0];
      assert.strictEqual(putTargetsCall.constructor.name, 'PutTargetsCommand');
    });

    it('should not call RemoveTargets if no old targets need removal', async () => {
      // PutRule
      mockSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/my-rule',
      });
      // PutTargets
      mockSend.mockResolvedValueOnce({});

      await provider.update(
        'MyRule',
        'arn:aws:events:us-east-1:123456789012:rule/my-rule',
        'AWS::Events::Rule',
        {
          Name: 'my-rule',
          Targets: [
            { Id: 'Target1', Arn: 'arn:aws:lambda:us-east-1:123456789012:function:func' },
          ],
        },
        {
          Name: 'my-rule',
          Targets: [
            { Id: 'Target1', Arn: 'arn:aws:lambda:us-east-1:123456789012:function:func-old' },
          ],
        }
      );

      // PutRule + PutTargets only (no RemoveTargets since Target1 is still present)
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should throw ProvisioningError on failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      await expect(
        provider.update(
          'MyRule',
          'arn:aws:events:us-east-1:123456789012:rule/my-rule',
          'AWS::Events::Rule',
          { Name: 'my-rule' },
          { Name: 'my-rule' }
        )
      ).rejects.toThrow('Failed to update EventBridge rule MyRule');
    });
  });

  describe('delete', () => {
    it('should remove targets and delete rule', async () => {
      // ListTargetsByRule
      mockSend.mockResolvedValueOnce({
        Targets: [
          { Id: 'Target1', Arn: 'arn:aws:lambda:us-east-1:123456789012:function:func' },
        ],
      });
      // RemoveTargets
      mockSend.mockResolvedValueOnce({});
      // DeleteRule
      mockSend.mockResolvedValueOnce({});

      await provider.delete(
        'MyRule',
        'arn:aws:events:us-east-1:123456789012:rule/my-rule',
        'AWS::Events::Rule'
      );

      expect(mockSend).toHaveBeenCalledTimes(3);

      const listTargetsCall = mockSend.mock.calls[0][0];
      assert.strictEqual(listTargetsCall.constructor.name, 'ListTargetsByRuleCommand');

      const removeTargetsCall = mockSend.mock.calls[1][0];
      assert.strictEqual(removeTargetsCall.constructor.name, 'RemoveTargetsCommand');
      assert.deepStrictEqual(removeTargetsCall.input.Ids, ['Target1']);

      const deleteRuleCall = mockSend.mock.calls[2][0];
      assert.strictEqual(deleteRuleCall.constructor.name, 'DeleteRuleCommand');
      assert.strictEqual(deleteRuleCall.input.Name, 'my-rule');
    });

    it('should delete rule with no targets', async () => {
      // ListTargetsByRule - empty
      mockSend.mockResolvedValueOnce({ Targets: [] });
      // DeleteRule
      mockSend.mockResolvedValueOnce({});

      await provider.delete(
        'MyRule',
        'arn:aws:events:us-east-1:123456789012:rule/my-rule',
        'AWS::Events::Rule'
      );

      // ListTargets + DeleteRule (no RemoveTargets)
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should skip deletion when rule does not exist (ResourceNotFoundException on ListTargets)', async () => {
      mockSend.mockRejectedValueOnce(
        new ResourceNotFoundException({ $metadata: {}, message: 'not found' })
      );

      await provider.delete(
        'MyRule',
        'arn:aws:events:us-east-1:123456789012:rule/my-rule',
        'AWS::Events::Rule'
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle ResourceNotFoundException during DeleteRule gracefully', async () => {
      // ListTargetsByRule - empty
      mockSend.mockResolvedValueOnce({ Targets: [] });
      // DeleteRule - rule already gone
      mockSend.mockRejectedValueOnce(
        new ResourceNotFoundException({ $metadata: {}, message: 'not found' })
      );

      await provider.delete(
        'MyRule',
        'arn:aws:events:us-east-1:123456789012:rule/my-rule',
        'AWS::Events::Rule'
      );

      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should extract rule name from ARN correctly', async () => {
      // ListTargetsByRule
      mockSend.mockResolvedValueOnce({ Targets: [] });
      // DeleteRule
      mockSend.mockResolvedValueOnce({});

      await provider.delete(
        'MyRule',
        'arn:aws:events:us-east-1:123456789012:rule/custom-bus/my-rule',
        'AWS::Events::Rule'
      );

      const listTargetsCall = mockSend.mock.calls[0][0];
      assert.strictEqual(listTargetsCall.input.Rule, 'my-rule');

      const deleteRuleCall = mockSend.mock.calls[1][0];
      assert.strictEqual(deleteRuleCall.input.Name, 'my-rule');
    });

    it('should handle non-ARN physicalId (already a rule name)', async () => {
      // ListTargetsByRule
      mockSend.mockResolvedValueOnce({ Targets: [] });
      // DeleteRule
      mockSend.mockResolvedValueOnce({});

      await provider.delete('MyRule', 'my-rule', 'AWS::Events::Rule');

      const listTargetsCall = mockSend.mock.calls[0][0];
      assert.strictEqual(listTargetsCall.input.Rule, 'my-rule');
    });

    it('should throw ProvisioningError on unexpected failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      await expect(
        provider.delete(
          'MyRule',
          'arn:aws:events:us-east-1:123456789012:rule/my-rule',
          'AWS::Events::Rule'
        )
      ).rejects.toThrow('Failed to delete EventBridge rule MyRule');
    });
  });

  describe('getAttribute', () => {
    it('should return Arn from DescribeRule', async () => {
      mockSend.mockResolvedValueOnce({
        Arn: 'arn:aws:events:us-east-1:123456789012:rule/my-rule',
      });

      const arn = await provider.getAttribute(
        'arn:aws:events:us-east-1:123456789012:rule/my-rule',
        'AWS::Events::Rule',
        'Arn'
      );

      assert.strictEqual(arn, 'arn:aws:events:us-east-1:123456789012:rule/my-rule');

      const describeCall = mockSend.mock.calls[0][0];
      assert.strictEqual(describeCall.constructor.name, 'DescribeRuleCommand');
    });

    it('should throw for unsupported attribute', async () => {
      await expect(
        provider.getAttribute(
          'arn:aws:events:us-east-1:123456789012:rule/my-rule',
          'AWS::Events::Rule',
          'UnsupportedAttr'
        )
      ).rejects.toThrow('Unsupported attribute: UnsupportedAttr');
    });
  });
});
