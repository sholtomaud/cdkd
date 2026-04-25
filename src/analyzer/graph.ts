/**
 * Lightweight Directed Acyclic Graph (DAG) implementation
 */
export class Graph {
  private nodeValues = new Map<string, any>();
  private adjacency = new Map<string, Set<string>>();
  private reverseAdjacency = new Map<string, Set<string>>();

  constructor(_options?: { directed: boolean }) {}

  setNode(id: string, value?: any) {
    this.nodeValues.set(id, value);
    if (!this.adjacency.has(id)) this.adjacency.set(id, new Set());
    if (!this.reverseAdjacency.has(id)) this.reverseAdjacency.set(id, new Set());
  }

  node(id: string) {
    return this.nodeValues.get(id);
  }

  hasNode(id: string) {
    return this.nodeValues.has(id);
  }

  removeNode(id: string) {
    this.nodeValues.delete(id);
    const neighbors = this.adjacency.get(id);
    if (neighbors) {
      for (const neighbor of neighbors) {
        this.reverseAdjacency.get(neighbor)?.delete(id);
      }
    }
    this.adjacency.delete(id);

    const predecessors = this.reverseAdjacency.get(id);
    if (predecessors) {
      for (const pred of predecessors) {
        this.adjacency.get(pred)?.delete(id);
      }
    }
    this.reverseAdjacency.delete(id);
  }

  setEdge(from: string, to: string) {
    if (!this.hasNode(from)) this.setNode(from);
    if (!this.hasNode(to)) this.setNode(to);
    this.adjacency.get(from)!.add(to);
    this.reverseAdjacency.get(to)!.add(from);
  }

  hasEdge(from: string, to: string): boolean {
    return this.adjacency.get(from)?.has(to) ?? false;
  }

  successors(id: string): string[] {
    const s = this.adjacency.get(id);
    return s ? Array.from(s) : [];
  }

  predecessors(id: string): string[] {
    const p = this.reverseAdjacency.get(id);
    return p ? Array.from(p) : [];
  }

  nodeCount() {
    return this.nodeValues.size;
  }

  edgeCount(): number {
    let count = 0;
    for (const neighbors of this.adjacency.values()) {
      count += neighbors.size;
    }
    return count;
  }

  nodes() {
    return Array.from(this.nodeValues.keys());
  }

  edges(): { v: string; w: string }[] {
    const e: { v: string; w: string }[] = [];
    for (const [from, toSet] of this.adjacency.entries()) {
      for (const to of toSet) {
        e.push({ v: from, w: to });
      }
    }
    return e;
  }
}

export const alg = {
  isAcyclic(graph: Graph): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (node: string): boolean => {
      visited.add(node);
      recursionStack.add(node);

      for (const neighbor of graph.successors(node)) {
        if (!visited.has(neighbor)) {
          if (hasCycle(neighbor)) return true;
        } else if (recursionStack.has(neighbor)) {
          return true;
        }
      }

      recursionStack.delete(node);
      return false;
    };

    for (const node of graph.nodes()) {
      if (!visited.has(node)) {
        if (hasCycle(node)) return false;
      }
    }

    return true;
  },
};
