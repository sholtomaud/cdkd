import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';

const mockSend = vi.hoisted(() => mock.fn());

vi.mock('@aws-sdk/client-codebuild', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-codebuild')>();
  return {
    ...actual,
    CodeBuildClient: mock.fn().mockImplementation(() => ({
      send: mockSend,
    })),
  };
});

vi.mock('../../../../src/utils/logger.ts', () => {
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

import { CodeBuildProvider } from '../../../../src/provisioning/providers/codebuild-provider.ts';
import {
  CreateProjectCommand,
  DeleteProjectCommand,
  UpdateProjectCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-codebuild';

describe('CodeBuildProvider', () => {
  let provider: CodeBuildProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CodeBuildProvider();
  });

  // ─── create ─────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create project with basic properties', async () => {
      mockSend.mockResolvedValue({
        project: {
          name: 'my-project',
          arn: 'arn:aws:codebuild:us-east-1:123456789012:project/my-project',
        },
      });

      const result = await provider.create('MyProject', 'AWS::CodeBuild::Project', {
        Name: 'my-project',
        Source: { Type: 'NO_SOURCE', BuildSpec: 'version: 0.2\nphases:\n  build:\n    commands:\n      - echo hello' },
        Environment: { Type: 'LINUX_CONTAINER', ComputeType: 'BUILD_GENERAL1_SMALL', Image: 'aws/codebuild/standard:7.0' },
        ServiceRole: 'arn:aws:iam::123456789012:role/codebuild-role',
        Artifacts: { Type: 'NO_ARTIFACTS' },
      });

      assert.strictEqual(result.physicalId, 'my-project');
      expect(result.attributes).toEqual({
        Arn: 'arn:aws:codebuild:us-east-1:123456789012:project/my-project',
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(CreateProjectCommand);
      assert.strictEqual(command.input.name, 'my-project');
      expect(command.input.source).toEqual({
        type: 'NO_SOURCE',
        buildspec: 'version: 0.2\nphases:\n  build:\n    commands:\n      - echo hello',
        location: undefined,
      });
      expect(command.input.environment).toEqual({
        type: 'LINUX_CONTAINER',
        computeType: 'BUILD_GENERAL1_SMALL',
        image: 'aws/codebuild/standard:7.0',
        environmentVariables: undefined,
      });
      assert.strictEqual(command.input.serviceRole, 'arn:aws:iam::123456789012:role/codebuild-role');
      assert.deepStrictEqual(command.input.artifacts, { type: 'NO_ARTIFACTS' });
    });

    it('should JSON.stringify buildspec when it is an object', async () => {
      const buildspecObj = {
        version: 0.2,
        phases: { build: { commands: ['echo hello'] } },
      };

      mockSend.mockResolvedValue({
        project: {
          name: 'my-project',
          arn: 'arn:aws:codebuild:us-east-1:123456789012:project/my-project',
        },
      });

      await provider.create('MyProject', 'AWS::CodeBuild::Project', {
        Name: 'my-project',
        Source: { Type: 'NO_SOURCE', BuildSpec: buildspecObj },
        Environment: { Type: 'LINUX_CONTAINER', ComputeType: 'BUILD_GENERAL1_SMALL', Image: 'aws/codebuild/standard:7.0' },
        ServiceRole: 'arn:aws:iam::123456789012:role/codebuild-role',
        Artifacts: { Type: 'NO_ARTIFACTS' },
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(CreateProjectCommand);
      assert.strictEqual(command.input.source.buildspec, JSON.stringify(buildspecObj));
    });
  });

  // ─── update ─────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update project properties', async () => {
      mockSend.mockResolvedValue({
        project: {
          name: 'my-project',
          arn: 'arn:aws:codebuild:us-east-1:123456789012:project/my-project',
        },
      });

      const result = await provider.update(
        'MyProject',
        'my-project',
        'AWS::CodeBuild::Project',
        {
          Name: 'my-project',
          Source: { Type: 'CODECOMMIT', Location: 'https://git-codecommit.us-east-1.amazonaws.com/v1/repos/my-repo' },
          Environment: { Type: 'LINUX_CONTAINER', ComputeType: 'BUILD_GENERAL1_MEDIUM', Image: 'aws/codebuild/standard:7.0' },
          ServiceRole: 'arn:aws:iam::123456789012:role/codebuild-role',
          Artifacts: { Type: 'NO_ARTIFACTS' },
        },
        {
          Name: 'my-project',
          Source: { Type: 'NO_SOURCE' },
          Environment: { Type: 'LINUX_CONTAINER', ComputeType: 'BUILD_GENERAL1_SMALL', Image: 'aws/codebuild/standard:7.0' },
          ServiceRole: 'arn:aws:iam::123456789012:role/codebuild-role',
          Artifacts: { Type: 'NO_ARTIFACTS' },
        }
      );

      assert.strictEqual(result.physicalId, 'my-project');
      assert.strictEqual(result.wasReplaced, false);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(UpdateProjectCommand);
      assert.strictEqual(command.input.name, 'my-project');
      assert.strictEqual(command.input.source.type, 'CODECOMMIT');
      assert.strictEqual(command.input.environment.computeType, 'BUILD_GENERAL1_MEDIUM');
    });
  });

  // ─── delete ─────────────────────────────────────────────────────────

  describe('delete', () => {
    it('should delete project', async () => {
      mockSend.mockResolvedValue({});

      await provider.delete('MyProject', 'my-project', 'AWS::CodeBuild::Project');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(DeleteProjectCommand);
      assert.deepStrictEqual(command.input, { name: 'my-project' });
    });

    it('should not throw when project is not found', async () => {
      mockSend.mockRejectedValue(
        new ResourceNotFoundException({ $metadata: {}, message: 'not found' })
      );

      await expect(
        provider.delete('MyProject', 'my-project', 'AWS::CodeBuild::Project')
      ).resolves.not.toThrow();
    });
  });
});
