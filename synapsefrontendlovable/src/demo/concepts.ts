export type MasteryState = "strong" | "developing" | "review" | "unassessed";

export interface Concept {
  id: string;
  name: string;
  category: string;
  description: string;
  /** Arjun's baseline mastery 0–100, null = unassessed */
  mastery: number | null;
  trend: number; // change over last 2 weeks
  links: string[];
}

const c = (
  id: string,
  name: string,
  category: string,
  mastery: number | null,
  trend: number,
  links: string[],
  description: string,
): Concept => ({ id, name, category, mastery, trend, links, description });

export const concepts: Concept[] = [
  c("programming", "Programming", "Foundations", 88, 2, ["data-structures", "algorithms", "complexity", "recursion", "functions"], "The practice of expressing computation as precise, executable instructions."),
  c("functions", "Functions", "Foundations", 91, 1, ["recursion", "closures"], "Named, reusable units of computation that map inputs to outputs."),
  c("closures", "Closures", "Foundations", 64, 5, [], "Functions that capture variables from the scope in which they were defined."),
  c("recursion", "Recursion", "Foundations", 48, -4, ["dynamic-programming", "trees", "dfs", "divide-conquer", "backtracking"], "Solving a problem by reducing it to smaller instances of itself, anchored by base cases."),
  c("data-structures", "Data Structures", "Data Structures", 74, 3, ["arrays", "linked-lists", "stacks", "queues", "trees", "graphs", "hash-tables", "heaps"], "Ways of organising data so operations on it become efficient."),
  c("arrays", "Arrays", "Data Structures", 92, 1, ["binary-search", "sorting", "two-pointers", "sliding-window"], "Contiguous, index-addressable sequences of elements."),
  c("linked-lists", "Linked Lists", "Data Structures", 78, 0, ["stacks", "queues"], "Chains of nodes where each node references the next."),
  c("stacks", "Stacks", "Data Structures", 85, 2, ["dfs", "backtracking"], "Last-in, first-out collections supporting push and pop."),
  c("queues", "Queues", "Data Structures", 81, 1, ["bfs"], "First-in, first-out collections supporting enqueue and dequeue."),
  c("hash-tables", "Hash Tables", "Data Structures", 70, 4, ["hashing"], "Key–value maps offering average O(1) lookup via hashing."),
  c("hashing", "Hashing", "Data Structures", 58, 2, [], "Deterministic mapping of keys to fixed-size integers."),
  c("heaps", "Heaps", "Data Structures", 55, -2, ["priority-queues", "heap-sort"], "Complete binary trees maintaining a parent–child ordering."),
  c("priority-queues", "Priority Queues", "Data Structures", 52, 0, ["dijkstra"], "Queues that always dequeue the element of highest priority."),
  c("trees", "Trees", "Data Structures", 66, 3, ["binary-tree", "bst", "dfs", "bfs", "tries"], "Hierarchical, acyclic structures of parent and child nodes."),
  c("binary-tree", "Binary Tree", "Data Structures", 69, 2, ["bst", "heaps"], "Trees where every node has at most two children."),
  c("bst", "Binary Search Tree", "Data Structures", 57, -1, ["binary-search", "avl-trees"], "Binary trees ordered so left < node < right."),
  c("avl-trees", "AVL Trees", "Data Structures", null, 0, [], "Self-balancing BSTs that keep height logarithmic via rotations."),
  c("tries", "Tries", "Data Structures", null, 0, [], "Prefix trees for efficient string storage and lookup."),
  c("graphs", "Graphs", "Data Structures", 61, 4, ["bfs", "dfs", "dijkstra", "topological-sort", "mst"], "Sets of vertices connected by edges, directed or undirected."),
  c("algorithms", "Algorithms", "Algorithms", 72, 2, ["sorting", "binary-search", "bfs", "dfs", "dynamic-programming", "greedy", "divide-conquer"], "Finite, well-defined procedures for solving computational problems."),
  c("sorting", "Sorting", "Algorithms", 83, 1, ["binary-search", "merge-sort", "quick-sort", "heap-sort"], "Arranging elements into a defined order."),
  c("merge-sort", "Merge Sort", "Algorithms", 79, 2, [], "Divide-and-conquer sort that merges sorted halves in O(n log n)."),
  c("quick-sort", "Quick Sort", "Algorithms", 71, 0, [], "Partition-based sort with O(n log n) average time."),
  c("heap-sort", "Heap Sort", "Algorithms", 50, -3, [], "In-place sort that repeatedly extracts the max from a heap."),
  c("binary-search", "Binary Search", "Algorithms", 42, -6, ["two-pointers"], "Halving a sorted search space each step to find a target in O(log n)."),
  c("two-pointers", "Two Pointers", "Algorithms", 67, 3, ["sliding-window"], "Traversing a sequence with two coordinated indices."),
  c("sliding-window", "Sliding Window", "Algorithms", 54, 5, [], "Maintaining a moving subrange to solve contiguous-subarray problems."),
  c("bfs", "BFS", "Algorithms", 76, 4, ["dijkstra"], "Breadth-first search explores a graph level by level using a queue."),
  c("dfs", "DFS", "Algorithms", 45, -2, ["topological-sort", "backtracking"], "Depth-first search explores as deep as possible before backtracking."),
  c("dijkstra", "Dijkstra's Algorithm", "Algorithms", null, 0, [], "Shortest paths from a source in graphs with non-negative weights."),
  c("topological-sort", "Topological Sort", "Algorithms", null, 0, [], "Linear ordering of a DAG's vertices respecting edge direction."),
  c("mst", "Minimum Spanning Tree", "Algorithms", null, 0, ["greedy"], "A subset of edges connecting all vertices with minimum total weight."),
  c("greedy", "Greedy Algorithms", "Algorithms", 60, 1, [], "Making the locally optimal choice at each step."),
  c("divide-conquer", "Divide & Conquer", "Algorithms", 73, 2, ["merge-sort", "quick-sort"], "Split, solve recursively, then combine."),
  c("backtracking", "Backtracking", "Algorithms", 38, -1, [], "Incrementally building candidates and abandoning dead ends."),
  c("dynamic-programming", "Dynamic Programming", "Algorithms", 35, 2, ["memoization", "tabulation"], "Solving overlapping subproblems once and reusing their answers."),
  c("memoization", "Memoization", "Algorithms", 47, 3, [], "Top-down caching of recursive results."),
  c("tabulation", "Tabulation", "Algorithms", 40, 1, [], "Bottom-up filling of a table of subproblem results."),
  c("complexity", "Complexity", "Complexity", 77, 2, ["big-o", "time-complexity", "space-complexity"], "The study of the resources an algorithm consumes."),
  c("big-o", "Big O", "Complexity", 86, 1, ["time-complexity", "space-complexity", "amortized"], "Asymptotic upper bound on growth rate."),
  c("time-complexity", "Time Complexity", "Complexity", 80, 2, [], "How running time grows with input size."),
  c("space-complexity", "Space Complexity", "Complexity", 63, 0, [], "How memory usage grows with input size."),
  c("amortized", "Amortized Analysis", "Complexity", null, 0, [], "Average cost per operation over a worst-case sequence."),
];

export const conceptById = Object.fromEntries(concepts.map((x) => [x.id, x])) as Record<string, Concept>;

export function masteryState(m: number | null | undefined): MasteryState {
  if (m == null) return "unassessed";
  if (m >= 75) return "strong";
  if (m >= 55) return "developing";
  return "review";
}

export const masteryLabel: Record<MasteryState, string> = {
  strong: "Strong",
  developing: "Developing",
  review: "Needs review",
  unassessed: "Unassessed",
};

export const edges: [string, string][] = (() => {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const x of concepts)
    for (const l of x.links) {
      const k = [x.id, l].sort().join("|");
      if (!seen.has(k) && conceptById[l]) {
        seen.add(k);
        out.push([x.id, l]);
      }
    }
  return out;
})();

export function neighbours(id: string): string[] {
  return edges.filter(([a, b]) => a === id || b === id).map(([a, b]) => (a === id ? b : a));
}
