import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { DagBuilder } from '../../../src/analyzer/dag-builder.ts';
import { DependencyError } from '../../../src/utils/error-handler.ts';

describe('DagBuilder', () => {
  let dagBuilder: DagBuilder;
  beforeEach(() => {
    dagBuilder = new DagBuilder();
  });
  it('should build a graph with independent resources', () => {
    const template: any = {
      Resources: {
        BucketA: { Type: 'AWS::S3::Bucket', Properties: {} },
        BucketB: { Type: 'AWS::S3::Bucket', Properties: {} },
      },
    };
    const graph = dagBuilder.buildGraph(template);
    assert.strictEqual(graph.nodeCount(), 2);
  });
});
