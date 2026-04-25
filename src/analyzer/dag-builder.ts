import { Graph, alg } from './graph.js';
import type { CloudFormationTemplate } from '../types/resource.js';
import { TemplateParser } from './template-parser.js';
import { getLogger } from '../utils/logger.js';
import { DependencyError } from '../utils/error-handler.js';

export class DagBuilder {
  private logger = getLogger().child('DagBuilder');
  private parser = new TemplateParser();

  buildGraph(template: CloudFormationTemplate): Graph {
    this.logger.debug('Building DAG for template');
    const graph = new Graph({ directed: true });
    const resourceIds = this.parser.getResourceIds(template);
    resourceIds.forEach((logicalId) => {
      const resource = this.parser.getResource(template, logicalId);
      graph.setNode(logicalId, resource);
    });
    for (const logicalId of resourceIds) {
      const resource = this.parser.getResource(template, logicalId);
      if (!resource) continue;
      const dependencies = this.parser.extractDependencies(resource);
      for (const depId of dependencies) {
        if (graph.hasNode(depId)) {
          graph.setEdge(depId, logicalId);
        }
      }
    }
    if (!alg.isAcyclic(graph)) {
      throw new DependencyError('Circular dependency detected');
    }
    return graph;
  }

  getExecutionLevels(graph: Graph): string[][] {
    const levels: string[][] = [];
    const graphCopy = new Graph({ directed: true });
    graph.nodes().forEach((node) => graphCopy.setNode(node, graph.node(node)));
    graph.edges().forEach((edge) => graphCopy.setEdge(edge.v, edge.w));
    while (graphCopy.nodeCount() > 0) {
      const readyNodes = graphCopy
        .nodes()
        .filter((node) => graphCopy.predecessors(node).length === 0);
      if (readyNodes.length === 0) throw new DependencyError('Circular dependency detected');
      levels.push(readyNodes);
      readyNodes.forEach((node) => graphCopy.removeNode(node));
    }
    return levels;
  }

  getAllDependencies(graph: Graph, logicalId: string): Set<string> {
    const dependencies = new Set<string>();
    const visit = (node: string) => {
      graph.predecessors(node).forEach((pred) => {
        if (!dependencies.has(pred)) {
          dependencies.add(pred);
          visit(pred);
        }
      });
    };
    visit(logicalId);
    return dependencies;
  }

  getAllDependents(graph: Graph, logicalId: string): Set<string> {
    const dependents = new Set<string>();
    const visit = (node: string) => {
      graph.successors(node).forEach((succ) => {
        if (!dependents.has(succ)) {
          dependents.add(succ);
          visit(succ);
        }
      });
    };
    visit(logicalId);
    return dependents;
  }

  getDirectDependencies(graph: Graph, logicalId: string): string[] {
    return graph.predecessors(logicalId);
  }

  getDirectDependents(graph: Graph, logicalId: string): string[] {
    return graph.successors(logicalId);
  }

  dependsOn(graph: Graph, resourceA: string, resourceB: string): boolean {
    return this.getAllDependencies(graph, resourceA).has(resourceB);
  }
}
