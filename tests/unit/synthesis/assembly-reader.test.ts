import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';

// Mock node:fs
vi.mock('node:fs', () => ({
  readFileSync: mock.fn(),
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

import { readFileSync } from 'node:fs';
import { AssemblyReader } from '../../../src/synthesis/assembly-reader.ts';
import type { AssemblyManifest } from '../../../src/types/assembly.ts';
import { SynthesisError } from '../../../src/utils/error-handler.ts';

/** Sample manifest with one stack and one asset manifest */
function createSampleManifest(): AssemblyManifest {
  return {
    version: '38.0.0',
    artifacts: {
      'MyStackAssets': {
        type: 'cdk:asset-manifest',
        properties: {
          file: 'MyStackAssets.assets.json',
        },
      },
      'MyStack': {
        type: 'aws:cloudformation:stack',
        environment: 'aws://123456789012/us-east-1',
        properties: {
          templateFile: 'MyStack.template.json',
          stackName: 'MyStack',
        },
        dependencies: ['MyStackAssets'],
      },
      'Tree': {
        type: 'cdk:tree',
        properties: {
          file: 'tree.json',
        },
      },
    },
  };
}

/** Sample manifest with two stacks that have a dependency */
function createMultiStackManifest(): AssemblyManifest {
  return {
    version: '38.0.0',
    artifacts: {
      'SharedStackAssets': {
        type: 'cdk:asset-manifest',
        properties: {
          file: 'SharedStackAssets.assets.json',
        },
      },
      'SharedStack': {
        type: 'aws:cloudformation:stack',
        environment: 'aws://123456789012/us-east-1',
        properties: {
          templateFile: 'SharedStack.template.json',
          stackName: 'SharedStack',
        },
        dependencies: ['SharedStackAssets'],
      },
      'AppStack': {
        type: 'aws:cloudformation:stack',
        environment: 'aws://123456789012/us-east-1',
        properties: {
          templateFile: 'AppStack.template.json',
          stackName: 'AppStack',
        },
        dependencies: ['SharedStack'],
      },
    },
  };
}

/** Sample CloudFormation template */
const sampleTemplate = {
  Resources: {
    MyBucket: {
      Type: 'AWS::S3::Bucket',
      Properties: {
        BucketName: 'my-bucket',
      },
    },
  },
};

describe('AssemblyReader', () => {
  let reader: AssemblyReader;

  beforeEach(() => {
    vi.resetAllMocks();
    reader = new AssemblyReader();
  });

  describe('readManifest', () => {
    it('should read and parse manifest.json', () => {
      const manifest = createSampleManifest();
      vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(manifest));

      const result = reader.readManifest('/tmp/cdk.out');

      expect(readFileSync).toHaveBeenCalledWith('/tmp/cdk.out/manifest.json', 'utf-8');
      assert.strictEqual(result.version, '38.0.0');
      assert.notStrictEqual(result.artifacts, undefined);
    });

    it('should throw SynthesisError when manifest.json not found', () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      expect(() => reader.readManifest('/tmp/cdk.out')).toThrow(SynthesisError);
      expect(() => reader.readManifest('/tmp/cdk.out')).toThrow(
        /Failed to read cloud assembly manifest/
      );
    });
  });

  describe('getAllStacks', () => {
    it('should extract stacks from manifest (type aws:cloudformation:stack)', () => {
      const manifest = createSampleManifest();
      // readFileSync called for the template file
      vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(sampleTemplate));

      const stacks = reader.getAllStacks('/tmp/cdk.out', manifest);

      assert.strictEqual((stacks).length, 1);
      assert.strictEqual(stacks[0].stackName, 'MyStack');
      assert.strictEqual(stacks[0].artifactId, 'MyStack');
      assert.deepStrictEqual(stacks[0].template, sampleTemplate);
    });

    it('should extract asset manifest paths (type cdk:asset-manifest)', () => {
      const manifest = createSampleManifest();
      vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(sampleTemplate));

      const stacks = reader.getAllStacks('/tmp/cdk.out', manifest);

      assert.strictEqual(stacks[0].assetManifestPath, '/tmp/cdk.out/MyStackAssets.assets.json');
    });

    it('should extract stack dependencies', () => {
      const manifest = createMultiStackManifest();
      // First call for SharedStack template, second for AppStack template
      vi.mocked(readFileSync)
        .mockReturnValueOnce(JSON.stringify(sampleTemplate))
        .mockReturnValueOnce(JSON.stringify(sampleTemplate));

      const stacks = reader.getAllStacks('/tmp/cdk.out', manifest);

      const appStack = stacks.find((s) => s.stackName === 'AppStack');
      assert.notStrictEqual(appStack, undefined);
      assert.ok((appStack!.dependencyNames).includes('SharedStack'));

      const sharedStack = stacks.find((s) => s.stackName === 'SharedStack');
      assert.notStrictEqual(sharedStack, undefined);
      assert.strictEqual((sharedStack!.dependencyNames).length, 0);
    });

    it('should parse environment string (aws://account/region)', () => {
      const manifest = createSampleManifest();
      vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(sampleTemplate));

      const stacks = reader.getAllStacks('/tmp/cdk.out', manifest);

      assert.strictEqual(stacks[0].region, 'us-east-1');
      assert.strictEqual(stacks[0].account, '123456789012');
    });

    it('should return empty array when manifest has no artifacts', () => {
      const manifest: AssemblyManifest = { version: '38.0.0' };

      const stacks = reader.getAllStacks('/tmp/cdk.out', manifest);

      assert.strictEqual((stacks).length, 0);
    });

    it('should handle unknown-account and unknown-region', () => {
      const manifest: AssemblyManifest = {
        version: '38.0.0',
        artifacts: {
          'MyStack': {
            type: 'aws:cloudformation:stack',
            environment: 'aws://unknown-account/unknown-region',
            properties: {
              templateFile: 'MyStack.template.json',
              stackName: 'MyStack',
            },
          },
        },
      };
      vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(sampleTemplate));

      const stacks = reader.getAllStacks('/tmp/cdk.out', manifest);

      assert.strictEqual(stacks[0].region, undefined);
      assert.strictEqual(stacks[0].account, undefined);
    });

    it('should traverse nested assemblies (Stages) to find stacks', () => {
      // Top-level manifest has a nested cloud assembly (Stage), no direct stacks
      const topManifest: AssemblyManifest = {
        version: '38.0.0',
        artifacts: {
          'assembly-MyStage': {
            type: 'cdk:cloud-assembly',
            properties: {
              directoryName: 'assembly-MyStage',
              displayName: 'MyStage',
            },
          },
          'Tree': {
            type: 'cdk:tree',
            properties: { file: 'tree.json' },
          },
        },
      };

      // Nested manifest inside assembly-MyStage/
      const nestedManifest: AssemblyManifest = {
        version: '38.0.0',
        artifacts: {
          'MyStageCdkSampleStackAssets': {
            type: 'cdk:asset-manifest',
            properties: {
              file: 'MyStageCdkSampleStack.assets.json',
            },
          },
          'MyStageCdkSampleStack': {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: {
              templateFile: 'MyStageCdkSampleStack.template.json',
              stackName: 'MyStage-CdkSampleStack',
            },
            dependencies: ['MyStageCdkSampleStackAssets'],
          },
        },
      };

      vi.mocked(readFileSync)
        // 1st call: nested manifest.json
        .mockReturnValueOnce(JSON.stringify(nestedManifest))
        // 2nd call: stack template
        .mockReturnValueOnce(JSON.stringify(sampleTemplate));

      const stacks = reader.getAllStacks('/tmp/cdk.out', topManifest);

      assert.strictEqual((stacks).length, 1);
      assert.strictEqual(stacks[0].stackName, 'MyStage-CdkSampleStack');
      expect(stacks[0].assetManifestPath).toBe(
        '/tmp/cdk.out/assembly-MyStage/MyStageCdkSampleStack.assets.json'
      );
    });

    it('should combine stacks from top-level and nested assemblies', () => {
      const topManifest: AssemblyManifest = {
        version: '38.0.0',
        artifacts: {
          'TopStack': {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: {
              templateFile: 'TopStack.template.json',
              stackName: 'TopStack',
            },
          },
          'assembly-MyStage': {
            type: 'cdk:cloud-assembly',
            properties: {
              directoryName: 'assembly-MyStage',
            },
          },
        },
      };

      const nestedManifest: AssemblyManifest = {
        version: '38.0.0',
        artifacts: {
          'NestedStack': {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: {
              templateFile: 'NestedStack.template.json',
              stackName: 'NestedStack',
            },
          },
        },
      };

      vi.mocked(readFileSync)
        // 1st call: TopStack template
        .mockReturnValueOnce(JSON.stringify(sampleTemplate))
        // 2nd call: nested manifest.json
        .mockReturnValueOnce(JSON.stringify(nestedManifest))
        // 3rd call: NestedStack template
        .mockReturnValueOnce(JSON.stringify(sampleTemplate));

      const stacks = reader.getAllStacks('/tmp/cdk.out', topManifest);

      assert.strictEqual((stacks).length, 2);
      assert.deepStrictEqual(stacks.map((s) => s.stackName).sort(), ['NestedStack', 'TopStack']);
    });

    it('should handle nested assembly read failure gracefully', () => {
      const topManifest: AssemblyManifest = {
        version: '38.0.0',
        artifacts: {
          'assembly-BadStage': {
            type: 'cdk:cloud-assembly',
            properties: {
              directoryName: 'assembly-BadStage',
            },
          },
        },
      };

      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const stacks = reader.getAllStacks('/tmp/cdk.out', topManifest);

      assert.strictEqual((stacks).length, 0);
    });

    it('should use artifactId as stackName when stackName property is missing', () => {
      const manifest: AssemblyManifest = {
        version: '38.0.0',
        artifacts: {
          'MyArtifactId': {
            type: 'aws:cloudformation:stack',
            properties: {
              templateFile: 'MyStack.template.json',
            },
          },
        },
      };
      vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(sampleTemplate));

      const stacks = reader.getAllStacks('/tmp/cdk.out', manifest);

      assert.strictEqual(stacks[0].stackName, 'MyArtifactId');
    });
  });

  describe('getStack', () => {
    it('should throw SynthesisError when stack not found', () => {
      const manifest = createSampleManifest();
      // readFileSync is called for each template when getAllStacks runs internally
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(sampleTemplate));

      expect(() => reader.getStack('/tmp/cdk.out', manifest, 'NonExistent')).toThrow(
        SynthesisError
      );
      expect(() => reader.getStack('/tmp/cdk.out', manifest, 'NonExistent')).toThrow(
        /Stack 'NonExistent' not found/
      );
    });

    it('should return matching stack by name', () => {
      const manifest = createSampleManifest();
      // Called twice: once for getStack (which calls getAllStacks internally)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(sampleTemplate));

      const stack = reader.getStack('/tmp/cdk.out', manifest, 'MyStack');

      assert.strictEqual(stack.stackName, 'MyStack');
    });
  });

  describe('hasAssets', () => {
    it('should detect stacks with assets', () => {
      const manifest = createSampleManifest();
      vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(sampleTemplate));

      const stacks = reader.getAllStacks('/tmp/cdk.out', manifest);

      assert.strictEqual(reader.hasAssets(stacks[0]), true);
    });

    it('should return false for stacks without assets', () => {
      const manifest: AssemblyManifest = {
        version: '38.0.0',
        artifacts: {
          'MyStack': {
            type: 'aws:cloudformation:stack',
            properties: {
              templateFile: 'MyStack.template.json',
              stackName: 'MyStack',
            },
          },
        },
      };
      vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(sampleTemplate));

      const stacks = reader.getAllStacks('/tmp/cdk.out', manifest);

      assert.strictEqual(reader.hasAssets(stacks[0]), false);
    });
  });
});
