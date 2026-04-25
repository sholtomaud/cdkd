import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';
import { ResourceNotFoundException } from '@aws-sdk/client-bedrock-agentcore-control';

// Mock AWS clients before importing the provider
const mockSend = mock.fn();

vi.mock('../../../src/utils/aws-clients.ts', () => ({
  getAwsClients: () => ({
    bedrockAgentCoreControl: { send: mockSend },
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

import { AgentCoreRuntimeProvider } from '../../../src/provisioning/providers/agentcore-runtime-provider.ts';

describe('AgentCoreRuntimeProvider', () => {
  let provider: AgentCoreRuntimeProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AgentCoreRuntimeProvider();
  });

  describe('create', () => {
    it('should create a runtime with required properties', async () => {
      mockSend.mockResolvedValueOnce({
        agentRuntimeId: 'runtime-12345',
        agentRuntimeArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/runtime-12345',
        status: 'CREATING',
      });

      const result = await provider.create(
        'MyRuntime',
        'AWS::BedrockAgentCore::Runtime',
        {
          AgentRuntimeName: 'my-runtime',
          RoleArn: 'arn:aws:iam::123456789012:role/my-role',
        }
      );

      assert.strictEqual(result.physicalId, 'runtime-12345');
      expect(result.attributes).toEqual({
        Arn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/runtime-12345',
        AgentRuntimeId: 'runtime-12345',
        AgentRuntimeName: 'my-runtime',
      });
      expect(mockSend).toHaveBeenCalledTimes(1);

      const createCall = mockSend.mock.calls[0][0];
      assert.strictEqual(createCall.constructor.name, 'CreateAgentRuntimeCommand');
      assert.strictEqual(createCall.input.agentRuntimeName, 'my-runtime');
      assert.strictEqual(createCall.input.roleArn, 'arn:aws:iam::123456789012:role/my-role');
    });

    it('should pass optional properties to CreateAgentRuntimeCommand', async () => {
      mockSend.mockResolvedValueOnce({
        agentRuntimeId: 'runtime-12345',
        agentRuntimeArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/runtime-12345',
        status: 'CREATING',
      });

      await provider.create('MyRuntime', 'AWS::BedrockAgentCore::Runtime', {
        AgentRuntimeName: 'my-runtime',
        RoleArn: 'arn:aws:iam::123456789012:role/my-role',
        Description: 'Test runtime',
        NetworkConfiguration: { networkMode: 'PUBLIC' },
        ProtocolConfiguration: { serverProtocol: 'MCP' },
        EnvironmentVariables: { ENV_VAR: 'value' },
      });

      const createCall = mockSend.mock.calls[0][0];
      assert.strictEqual(createCall.input.description, 'Test runtime');
      assert.deepStrictEqual(createCall.input.networkConfiguration, { networkMode: 'PUBLIC' });
      assert.deepStrictEqual(createCall.input.protocolConfiguration, { serverProtocol: 'MCP' });
      assert.deepStrictEqual(createCall.input.environmentVariables, { ENV_VAR: 'value' });
    });

    it('should throw ProvisioningError when AgentRuntimeName is missing', async () => {
      await expect(
        provider.create('MyRuntime', 'AWS::BedrockAgentCore::Runtime', {
          RoleArn: 'arn:aws:iam::123456789012:role/my-role',
        })
      ).rejects.toThrow('AgentRuntimeName is required for MyRuntime');
    });

    it('should throw ProvisioningError when RoleArn is missing', async () => {
      await expect(
        provider.create('MyRuntime', 'AWS::BedrockAgentCore::Runtime', {
          AgentRuntimeName: 'my-runtime',
        })
      ).rejects.toThrow('RoleArn is required for MyRuntime');
    });

    it('should throw ProvisioningError on SDK failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      await expect(
        provider.create('MyRuntime', 'AWS::BedrockAgentCore::Runtime', {
          AgentRuntimeName: 'my-runtime',
          RoleArn: 'arn:aws:iam::123456789012:role/my-role',
        })
      ).rejects.toThrow('Failed to create BedrockAgentCore Runtime MyRuntime');
    });
  });

  describe('update', () => {
    it('should update a runtime', async () => {
      mockSend.mockResolvedValueOnce({
        agentRuntimeId: 'runtime-12345',
        agentRuntimeArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/runtime-12345',
        status: 'UPDATING',
      });

      const result = await provider.update(
        'MyRuntime',
        'runtime-12345',
        'AWS::BedrockAgentCore::Runtime',
        {
          AgentRuntimeName: 'my-runtime',
          RoleArn: 'arn:aws:iam::123456789012:role/my-role',
          Description: 'Updated description',
        },
        {
          AgentRuntimeName: 'my-runtime',
          RoleArn: 'arn:aws:iam::123456789012:role/my-role',
          Description: 'Old description',
        }
      );

      assert.strictEqual(result.physicalId, 'runtime-12345');
      assert.strictEqual(result.wasReplaced, false);
      expect(result.attributes).toEqual({
        Arn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/runtime-12345',
        AgentRuntimeId: 'runtime-12345',
        AgentRuntimeName: 'my-runtime',
      });
      expect(mockSend).toHaveBeenCalledTimes(1);

      const updateCall = mockSend.mock.calls[0][0];
      assert.strictEqual(updateCall.constructor.name, 'UpdateAgentRuntimeCommand');
      assert.strictEqual(updateCall.input.agentRuntimeId, 'runtime-12345');
      assert.strictEqual(updateCall.input.description, 'Updated description');
    });

    it('should throw ProvisioningError when RoleArn is missing', async () => {
      await expect(
        provider.update(
          'MyRuntime',
          'runtime-12345',
          'AWS::BedrockAgentCore::Runtime',
          { AgentRuntimeName: 'my-runtime' },
          { AgentRuntimeName: 'my-runtime' }
        )
      ).rejects.toThrow('RoleArn is required for MyRuntime');
    });

    it('should throw ProvisioningError on SDK failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Throttling'));

      await expect(
        provider.update(
          'MyRuntime',
          'runtime-12345',
          'AWS::BedrockAgentCore::Runtime',
          {
            AgentRuntimeName: 'my-runtime',
            RoleArn: 'arn:aws:iam::123456789012:role/my-role',
          },
          {
            AgentRuntimeName: 'my-runtime',
            RoleArn: 'arn:aws:iam::123456789012:role/my-role',
          }
        )
      ).rejects.toThrow('Failed to update BedrockAgentCore Runtime MyRuntime');
    });
  });

  describe('delete', () => {
    it('should delete a runtime', async () => {
      mockSend.mockResolvedValueOnce({
        agentRuntimeId: 'runtime-12345',
        status: 'DELETING',
      });

      await provider.delete(
        'MyRuntime',
        'runtime-12345',
        'AWS::BedrockAgentCore::Runtime'
      );

      expect(mockSend).toHaveBeenCalledTimes(1);

      const deleteCall = mockSend.mock.calls[0][0];
      assert.strictEqual(deleteCall.constructor.name, 'DeleteAgentRuntimeCommand');
      assert.strictEqual(deleteCall.input.agentRuntimeId, 'runtime-12345');
    });

    it('should skip deletion when runtime does not exist (ResourceNotFoundException)', async () => {
      mockSend.mockRejectedValueOnce(
        new ResourceNotFoundException({ $metadata: {}, message: 'not found' })
      );

      await provider.delete(
        'MyRuntime',
        'runtime-12345',
        'AWS::BedrockAgentCore::Runtime'
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should throw ProvisioningError on unexpected failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access Denied'));

      await expect(
        provider.delete(
          'MyRuntime',
          'runtime-12345',
          'AWS::BedrockAgentCore::Runtime'
        )
      ).rejects.toThrow('Failed to delete BedrockAgentCore Runtime MyRuntime');
    });
  });

  describe('getAttribute', () => {
    it('should return Arn from GetAgentRuntime', async () => {
      mockSend.mockResolvedValueOnce({
        agentRuntimeArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/runtime-12345',
        agentRuntimeName: 'my-runtime',
      });

      const arn = await provider.getAttribute(
        'runtime-12345',
        'AWS::BedrockAgentCore::Runtime',
        'Arn'
      );

      expect(arn).toBe(
        'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/runtime-12345'
      );

      const getCall = mockSend.mock.calls[0][0];
      assert.strictEqual(getCall.constructor.name, 'GetAgentRuntimeCommand');
      assert.strictEqual(getCall.input.agentRuntimeId, 'runtime-12345');
    });

    it('should return AgentRuntimeArn from GetAgentRuntime', async () => {
      mockSend.mockResolvedValueOnce({
        agentRuntimeArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/runtime-12345',
      });

      const arn = await provider.getAttribute(
        'runtime-12345',
        'AWS::BedrockAgentCore::Runtime',
        'AgentRuntimeArn'
      );

      expect(arn).toBe(
        'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/runtime-12345'
      );
    });

    it('should return AgentRuntimeId directly from physicalId', async () => {
      const id = await provider.getAttribute(
        'runtime-12345',
        'AWS::BedrockAgentCore::Runtime',
        'AgentRuntimeId'
      );

      assert.strictEqual(id, 'runtime-12345');
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should return AgentRuntimeName from GetAgentRuntime', async () => {
      mockSend.mockResolvedValueOnce({
        agentRuntimeArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/runtime-12345',
        agentRuntimeName: 'my-runtime',
      });

      const name = await provider.getAttribute(
        'runtime-12345',
        'AWS::BedrockAgentCore::Runtime',
        'AgentRuntimeName'
      );

      assert.strictEqual(name, 'my-runtime');
    });

    it('should throw for unsupported attribute', async () => {
      await expect(
        provider.getAttribute(
          'runtime-12345',
          'AWS::BedrockAgentCore::Runtime',
          'UnsupportedAttr'
        )
      ).rejects.toThrow('Unsupported attribute: UnsupportedAttr');
    });
  });
});
