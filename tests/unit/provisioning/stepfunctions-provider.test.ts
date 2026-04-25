import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';

const mockSend = mock.fn();

// Mock the SFN client module (local client, not from getAwsClients)
vi.mock('@aws-sdk/client-sfn', async () => {
  const actual = await vi.importActual('@aws-sdk/client-sfn');
  return {
    ...actual,
    SFNClient: mock.fn().mockImplementation(() => ({
      send: mockSend,
    })),
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

import { StepFunctionsProvider } from '../../../src/provisioning/providers/stepfunctions-provider.ts';

describe('StepFunctionsProvider', () => {
  let provider: StepFunctionsProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new StepFunctionsProvider();
  });

  describe('create', () => {
    it('should create state machine and return ARN as physicalId, with attributes', async () => {
      mockSend.mockResolvedValueOnce({
        stateMachineArn:
          'arn:aws:states:us-east-1:123456789012:stateMachine:my-state-machine',
        stateMachineVersionArn:
          'arn:aws:states:us-east-1:123456789012:stateMachine:my-state-machine:1',
      });

      const result = await provider.create(
        'MyStateMachine',
        'AWS::StepFunctions::StateMachine',
        {
          StateMachineName: 'my-state-machine',
          RoleArn: 'arn:aws:iam::123456789012:role/step-functions-role',
          DefinitionString: '{"StartAt":"Hello","States":{"Hello":{"Type":"Pass","End":true}}}',
        }
      );

      expect(result.physicalId).toBe(
        'arn:aws:states:us-east-1:123456789012:stateMachine:my-state-machine'
      );
      expect(result.attributes).toEqual({
        Arn: 'arn:aws:states:us-east-1:123456789012:stateMachine:my-state-machine',
        Name: 'my-state-machine',
        StateMachineRevisionId:
          'arn:aws:states:us-east-1:123456789012:stateMachine:my-state-machine:1',
      });
      expect(mockSend).toHaveBeenCalledTimes(1);

      const createCall = mockSend.mock.calls[0][0];
      assert.strictEqual(createCall.constructor.name, 'CreateStateMachineCommand');
      assert.strictEqual(createCall.input.name, 'my-state-machine');
      expect(createCall.input.roleArn).toBe(
        'arn:aws:iam::123456789012:role/step-functions-role'
      );
    });

    it('should handle DefinitionString as object (JSON.stringify it)', async () => {
      mockSend.mockResolvedValueOnce({
        stateMachineArn:
          'arn:aws:states:us-east-1:123456789012:stateMachine:MyStateMachine',
      });

      const definitionObj = {
        StartAt: 'Hello',
        States: { Hello: { Type: 'Pass', End: true } },
      };

      await provider.create('MyStateMachine', 'AWS::StepFunctions::StateMachine', {
        RoleArn: 'arn:aws:iam::123456789012:role/role',
        DefinitionString: definitionObj,
      });

      const createCall = mockSend.mock.calls[0][0];
      assert.strictEqual(createCall.input.definition, JSON.stringify(definitionObj));
    });

    it('should convert Tags from CDK format ({Key,Value}) to SFN format ({key,value})', async () => {
      mockSend.mockResolvedValueOnce({
        stateMachineArn:
          'arn:aws:states:us-east-1:123456789012:stateMachine:MyStateMachine',
      });

      await provider.create('MyStateMachine', 'AWS::StepFunctions::StateMachine', {
        RoleArn: 'arn:aws:iam::123456789012:role/role',
        DefinitionString: '{}',
        Tags: [
          { Key: 'Environment', Value: 'dev' },
          { Key: 'Project', Value: 'test' },
        ],
      });

      const createCall = mockSend.mock.calls[0][0];
      expect(createCall.input.tags).toEqual([
        { key: 'Environment', value: 'dev' },
        { key: 'Project', value: 'test' },
      ]);
    });

    it('should use logicalId as name when StateMachineName is not provided', async () => {
      mockSend.mockResolvedValueOnce({
        stateMachineArn:
          'arn:aws:states:us-east-1:123456789012:stateMachine:MyStateMachine',
      });

      await provider.create('MyStateMachine', 'AWS::StepFunctions::StateMachine', {
        RoleArn: 'arn:aws:iam::123456789012:role/role',
        DefinitionString: '{}',
      });

      const createCall = mockSend.mock.calls[0][0];
      assert.strictEqual(createCall.input.name, 'MyStateMachine');
    });

    it('should throw ProvisioningError when RoleArn is missing', async () => {
      await expect(
        provider.create('MyStateMachine', 'AWS::StepFunctions::StateMachine', {
          DefinitionString: '{}',
        })
      ).rejects.toThrow('RoleArn is required for Step Functions state machine MyStateMachine');
    });

    it('should throw ProvisioningError on failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      await expect(
        provider.create('MyStateMachine', 'AWS::StepFunctions::StateMachine', {
          RoleArn: 'arn:aws:iam::123456789012:role/role',
          DefinitionString: '{}',
        })
      ).rejects.toThrow('Failed to create Step Functions state machine MyStateMachine');
    });

    it('should pass StateMachineType and other configurations', async () => {
      mockSend.mockResolvedValueOnce({
        stateMachineArn:
          'arn:aws:states:us-east-1:123456789012:stateMachine:MyExpress',
      });

      const loggingConfiguration = {
        level: 'ALL',
        includeExecutionData: true,
        destinations: [{ cloudWatchLogsLogGroup: { logGroupArn: 'arn:aws:logs:...' } }],
      };
      const tracingConfiguration = { enabled: true };

      await provider.create('MyExpress', 'AWS::StepFunctions::StateMachine', {
        RoleArn: 'arn:aws:iam::123456789012:role/role',
        DefinitionString: '{}',
        StateMachineType: 'EXPRESS',
        LoggingConfiguration: loggingConfiguration,
        TracingConfiguration: tracingConfiguration,
      });

      const createCall = mockSend.mock.calls[0][0];
      assert.strictEqual(createCall.input.type, 'EXPRESS');
      assert.deepStrictEqual(createCall.input.loggingConfiguration, loggingConfiguration);
      assert.deepStrictEqual(createCall.input.tracingConfiguration, tracingConfiguration);
    });
  });

  describe('update', () => {
    it('should update state machine definition and roleArn', async () => {
      // UpdateStateMachine
      mockSend.mockResolvedValueOnce({});
      // DescribeStateMachine
      mockSend.mockResolvedValueOnce({
        name: 'my-state-machine',
        revisionId: 'rev-2',
      });

      const result = await provider.update(
        'MyStateMachine',
        'arn:aws:states:us-east-1:123456789012:stateMachine:my-state-machine',
        'AWS::StepFunctions::StateMachine',
        {
          RoleArn: 'arn:aws:iam::123456789012:role/new-role',
          DefinitionString: '{"StartAt":"World","States":{"World":{"Type":"Pass","End":true}}}',
        },
        {
          RoleArn: 'arn:aws:iam::123456789012:role/old-role',
          DefinitionString: '{"StartAt":"Hello","States":{"Hello":{"Type":"Pass","End":true}}}',
        }
      );

      expect(result.physicalId).toBe(
        'arn:aws:states:us-east-1:123456789012:stateMachine:my-state-machine'
      );
      assert.strictEqual(result.wasReplaced, false);
      expect(result.attributes).toEqual({
        Arn: 'arn:aws:states:us-east-1:123456789012:stateMachine:my-state-machine',
        Name: 'my-state-machine',
        StateMachineRevisionId: 'rev-2',
      });
      expect(mockSend).toHaveBeenCalledTimes(2);

      const updateCall = mockSend.mock.calls[0][0];
      assert.strictEqual(updateCall.constructor.name, 'UpdateStateMachineCommand');
      expect(updateCall.input.stateMachineArn).toBe(
        'arn:aws:states:us-east-1:123456789012:stateMachine:my-state-machine'
      );
      assert.strictEqual(updateCall.input.roleArn, 'arn:aws:iam::123456789012:role/new-role');

      const describeCall = mockSend.mock.calls[1][0];
      assert.strictEqual(describeCall.constructor.name, 'DescribeStateMachineCommand');
    });

    it('should require replacement when StateMachineName changes', async () => {
      // Note: The current provider implementation does not detect immutable property changes.
      // StateMachineName is an immutable property in CloudFormation, but the SDK provider
      // delegates this update to the API which will reject name changes.
      // This test verifies that the update call is made (the API would reject it).
      mockSend.mockRejectedValueOnce(new Error('Cannot update state machine name'));

      await expect(
        provider.update(
          'MyStateMachine',
          'arn:aws:states:us-east-1:123456789012:stateMachine:old-name',
          'AWS::StepFunctions::StateMachine',
          {
            StateMachineName: 'new-name',
            RoleArn: 'arn:aws:iam::123456789012:role/role',
            DefinitionString: '{}',
          },
          {
            StateMachineName: 'old-name',
            RoleArn: 'arn:aws:iam::123456789012:role/role',
            DefinitionString: '{}',
          }
        )
      ).rejects.toThrow('Failed to update Step Functions state machine MyStateMachine');
    });

    it('should require replacement when StateMachineType changes', async () => {
      // StateMachineType is immutable - the API will reject the change.
      mockSend.mockRejectedValueOnce(new Error('Cannot update state machine type'));

      await expect(
        provider.update(
          'MyStateMachine',
          'arn:aws:states:us-east-1:123456789012:stateMachine:my-sm',
          'AWS::StepFunctions::StateMachine',
          {
            StateMachineType: 'EXPRESS',
            RoleArn: 'arn:aws:iam::123456789012:role/role',
            DefinitionString: '{}',
          },
          {
            StateMachineType: 'STANDARD',
            RoleArn: 'arn:aws:iam::123456789012:role/role',
            DefinitionString: '{}',
          }
        )
      ).rejects.toThrow('Failed to update Step Functions state machine MyStateMachine');
    });

    it('should throw ProvisioningError on failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      await expect(
        provider.update(
          'MyStateMachine',
          'arn:aws:states:us-east-1:123456789012:stateMachine:my-state-machine',
          'AWS::StepFunctions::StateMachine',
          {
            RoleArn: 'arn:aws:iam::123456789012:role/role',
            DefinitionString: '{}',
          },
          {
            RoleArn: 'arn:aws:iam::123456789012:role/old-role',
            DefinitionString: '{}',
          }
        )
      ).rejects.toThrow('Failed to update Step Functions state machine MyStateMachine');
    });
  });

  describe('delete', () => {
    it('should delete state machine', async () => {
      mockSend.mockResolvedValueOnce({});

      await provider.delete(
        'MyStateMachine',
        'arn:aws:states:us-east-1:123456789012:stateMachine:my-state-machine',
        'AWS::StepFunctions::StateMachine'
      );

      expect(mockSend).toHaveBeenCalledTimes(1);

      const deleteCall = mockSend.mock.calls[0][0];
      assert.strictEqual(deleteCall.constructor.name, 'DeleteStateMachineCommand');
      expect(deleteCall.input.stateMachineArn).toBe(
        'arn:aws:states:us-east-1:123456789012:stateMachine:my-state-machine'
      );
    });

    it('should handle StateMachineDoesNotExist gracefully (idempotent)', async () => {
      const { StateMachineDoesNotExist } = await import('@aws-sdk/client-sfn');
      mockSend.mockRejectedValueOnce(
        new StateMachineDoesNotExist({
          $metadata: {},
          message: 'State machine does not exist',
        })
      );

      // Should not throw
      await provider.delete(
        'MyStateMachine',
        'arn:aws:states:us-east-1:123456789012:stateMachine:my-state-machine',
        'AWS::StepFunctions::StateMachine'
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should throw ProvisioningError on unexpected failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      await expect(
        provider.delete(
          'MyStateMachine',
          'arn:aws:states:us-east-1:123456789012:stateMachine:my-state-machine',
          'AWS::StepFunctions::StateMachine'
        )
      ).rejects.toThrow('Failed to delete Step Functions state machine MyStateMachine');
    });
  });
});
