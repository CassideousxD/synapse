// Seeded demo dataset. Replace with REST adapter when the backend is connected.

export interface Teacher { id: string; name: string; department: string }
export interface Student {
  id: string; name: string; testsCompleted: number; avgScore: number; mastery: number;
  strongest: string; weakest: string; trend: number[];
}
export interface Activity { id: string; who: string; what: string; when: string }
export interface Classroom {
  id: string; name: string; subject: string; joinCode: string; teacherId: string;
  studentIds: string[]; conceptIds: string[]; activity: Activity[]; description: string;
}
export interface NoteSection { id: string; heading: string; body: string; conceptId?: string | undefined }
export interface Note {
  id: string; title: string; classroomId: string; conceptIds: string[]; published: boolean;
  updated: string; summary: string; content?: string; sections: NoteSection[];
  status?: "PROCESSING" | "READY" | "FAILED";
}
export interface Question {
  id: string; type: "mcq" | "short"; prompt: string; options?: string[] | undefined; answer: string; conceptId: string;
}
export interface Test {
  id: string; title: string; classroomId: string; conceptIds: string[]; durationMin: number;
  due: string; dueAt?: string; isOverdue?: boolean; status: "published" | "draft"; questions: Question[];
}
export interface Submission { testId: string; studentId: string; score: number; date: string; isLate?: boolean }
export interface NotificationItem {
  id: string;
  recipientId: string;
  classroomId: string;
  type: string;
  title: string;
  message: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  createdAt: string;
  readAt?: string | null;
  isRead: boolean;
}

export const teacher: Teacher = { id: "t-raman", name: "Dr. Ananya Raman", department: "Computer Science & Mathematics" };
export const DEMO_STUDENT_ID = "s-arjun";

const s = (id: string, name: string, tc: number, avg: number, m: number, st: string, wk: string, trend: number[]): Student =>
  ({ id, name, testsCompleted: tc, avgScore: avg, mastery: m, strongest: st, weakest: wk, trend });

export const students: Student[] = [
  s("s-arjun", "Arjun Kumar", 4, 71, 64, "arrays", "binary-search", [58, 61, 66, 64, 71]),
  s("s-priya", "Priya Sharma", 5, 88, 82, "dynamic-programming", "graphs", [80, 84, 83, 87, 90]),
  s("s-karthik", "Karthik Iyer", 5, 64, 58, "sorting", "recursion", [70, 66, 62, 60, 64]),
  s("s-meera", "Meera Nair", 4, 79, 74, "trees", "heaps", [72, 75, 78, 77, 81]),
  s("s-rahul", "Rahul Verma", 3, 52, 47, "arrays", "dynamic-programming", [55, 50, 49, 53, 52]),
  s("s-sneha", "Sneha Reddy", 5, 91, 86, "graphs", "backtracking", [85, 88, 90, 92, 91]),
  s("s-aditya", "Aditya Menon", 4, 68, 63, "big-o", "dfs", [60, 64, 65, 70, 68]),
  s("s-nikhil", "Nikhil Joshi", 2, 59, 51, "stacks", "binary-search", [62, 58, 57, 59, 59]),
  s("s-kavya", "Kavya Pillai", 3, 84, 78, "big-o", "space-complexity", [78, 80, 83, 85, 84]),
  s("s-rohan", "Rohan Desai", 3, 73, 66, "sorting", "greedy", [66, 70, 71, 72, 73]),
  s("s-isha", "Isha Kapoor", 4, 77, 70, "hash-tables", "recursion", [70, 73, 76, 75, 77]),
  s("s-vikram", "Vikram Rao", 2, 61, 55, "arrays", "trees", [58, 60, 59, 62, 61]),
  s("s-ananya", "Ananya Gupta", 3, 86, 80, "complexity", "tabulation", [81, 83, 85, 87, 86]),
];

export const classrooms: Classroom[] = [
  {
    id: "dsa", name: "Data Structures & Algorithms", subject: "Computer Science", joinCode: "D7S4A1", teacherId: teacher.id,
    description: "Core structures and algorithmic techniques with an emphasis on reasoning about correctness and cost.",
    studentIds: ["s-arjun", "s-priya", "s-karthik", "s-meera", "s-rahul", "s-sneha", "s-aditya", "s-nikhil"],
    conceptIds: ["arrays", "linked-lists", "stacks", "queues", "trees", "graphs", "sorting", "binary-search", "bfs", "dfs", "recursion", "dynamic-programming", "big-o", "time-complexity"],
    activity: [
      { id: "a1", who: "Priya Sharma", what: "scored 94% on Trees & Traversals", when: "2h ago" },
      { id: "a2", who: "Karthik Iyer", what: "opened notes on Recursion", when: "4h ago" },
      { id: "a3", who: "Sneha Reddy", what: "submitted Graph Foundations quiz", when: "Yesterday" },
      { id: "a4", who: "Rahul Verma", what: "revisited Binary Search boundaries", when: "Yesterday" },
    ],
  },
  {
    id: "ml", name: "Machine Learning Fundamentals", subject: "Computer Science", joinCode: "K9X2P4", teacherId: teacher.id,
    description: "Optimisation, complexity and the algorithmic backbone behind classical learning methods.",
    studentIds: ["s-kavya", "s-rohan", "s-isha", "s-vikram", "s-ananya", "s-priya"],
    conceptIds: ["complexity", "big-o", "space-complexity", "greedy", "dynamic-programming", "hash-tables", "graphs"],
    activity: [
      { id: "a5", who: "Ananya Gupta", what: "completed Complexity Checkpoint", when: "3h ago" },
      { id: "a6", who: "Isha Kapoor", what: "joined the classroom", when: "2 days ago" },
    ],
  },
  {
    id: "discrete", name: "Discrete Mathematics", subject: "Mathematics", joinCode: "M3T8H6", teacherId: teacher.id,
    description: "Logic, sets, combinatorics and graph theory for computer scientists.",
    studentIds: ["s-arjun", "s-meera", "s-aditya", "s-kavya", "s-rohan"],
    conceptIds: ["graphs", "trees", "recursion", "mst", "topological-sort"],
    activity: [
      { id: "a7", who: "Meera Nair", what: "asked about spanning trees", when: "5h ago" },
      { id: "a8", who: "Arjun Kumar", what: "read Graph Theory Primer", when: "Yesterday" },
    ],
  },
];

const sec = (id: string, heading: string, body: string, conceptId?: string): NoteSection => ({ id, heading, body, conceptId });

export const notes: Note[] = [
  {
    id: "binary-search", title: "Binary Search", classroomId: "dsa", conceptIds: ["binary-search", "arrays", "sorting"], published: true, updated: "Sep 18",
    summary: "Halving a sorted search space, loop invariants, and the boundary conditions that trip everyone up.",
    sections: [
      sec("idea", "The core idea", "Given a sorted array, compare the target with the middle element. If equal, you are done; if smaller, discard the right half; otherwise discard the left half. Each step halves the remaining range, so at most ⌈log₂ n⌉ + 1 comparisons are needed.", "binary-search"),
      sec("invariant", "Loop invariant", "Maintain that if the target exists, it lies within [lo, hi]. Every update to lo or hi must preserve this. Writing the invariant down before coding eliminates most off-by-one errors."),
      sec("boundaries", "Boundary conditions", "Use lo ≤ hi for a closed interval and lo < hi for a half-open one — never mix them. Compute mid as lo + (hi − lo) / 2 to avoid overflow. When searching for the first occurrence, keep moving hi = mid even on equality."),
      sec("complexity", "Complexity", "Time O(log n), space O(1) iteratively. It requires random access, which is why it pairs naturally with arrays rather than linked lists.", "time-complexity"),
    ],
  },
  {
    id: "time-complexity", title: "Time Complexity", classroomId: "dsa", conceptIds: ["time-complexity", "big-o", "complexity"], published: true, updated: "Sep 10",
    summary: "Counting operations, dominant terms and reading growth rates from code.",
    sections: [
      sec("count", "Counting operations", "Estimate how the number of primitive operations grows with n. Constants and lower-order terms are dropped because they stop mattering at scale.", "big-o"),
      sec("patterns", "Common patterns", "A single loop is O(n); nested loops over the same range are O(n²); halving the problem each step gives O(log n); divide-and-conquer that does linear work per level gives O(n log n)."),
    ],
  },
  {
    id: "sorting", title: "Sorting Algorithms", classroomId: "dsa", conceptIds: ["sorting", "merge-sort", "quick-sort", "heap-sort"], published: true, updated: "Sep 12",
    summary: "Comparison sorts, stability and when each algorithm earns its place.",
    sections: [
      sec("merge", "Merge sort", "Split the array in half, sort each half recursively, and merge. Stable, predictable O(n log n), but uses O(n) extra space.", "merge-sort"),
      sec("quick", "Quick sort", "Choose a pivot, partition, recurse. O(n log n) on average, O(n²) worst case; randomised pivots make the worst case vanishingly unlikely.", "quick-sort"),
      sec("heap", "Heap sort", "Build a max-heap, then repeatedly swap the root to the end. In-place O(n log n), not stable.", "heap-sort"),
    ],
  },
  {
    id: "trees", title: "Trees", classroomId: "dsa", conceptIds: ["trees", "binary-tree", "bst"], published: true, updated: "Sep 15",
    summary: "Terminology, traversals and the binary search tree property.",
    sections: [
      sec("terms", "Terminology", "A tree has a root, internal nodes and leaves. Depth counts edges from the root; height is the longest root-to-leaf path.", "trees"),
      sec("traverse", "Traversals", "Pre-order, in-order and post-order are depth-first; level-order is breadth-first. In-order traversal of a BST yields sorted output.", "dfs"),
      sec("bst", "BST property", "For every node, keys in the left subtree are smaller and keys in the right subtree are larger. Search, insert and delete run in O(h).", "bst"),
    ],
  },
  {
    id: "graphs", title: "Graphs", classroomId: "dsa", conceptIds: ["graphs", "bfs", "dfs"], published: true, updated: "Sep 20",
    summary: "Representations, BFS, DFS and what each traversal reveals.",
    sections: [
      sec("repr", "Representations", "Adjacency lists use O(V + E) space and suit sparse graphs; adjacency matrices use O(V²) and allow O(1) edge lookup.", "graphs"),
      sec("bfs", "Breadth-first search", "Use a queue. BFS visits vertices in order of distance and finds shortest paths in unweighted graphs.", "bfs"),
      sec("dfs", "Depth-first search", "Use recursion or an explicit stack. Record discovery and finish times to detect cycles and produce topological orderings.", "dfs"),
    ],
  },
  {
    id: "dynamic-programming", title: "Dynamic Programming", classroomId: "dsa", conceptIds: ["dynamic-programming", "memoization", "tabulation", "recursion"], published: false, updated: "Sep 22",
    summary: "Overlapping subproblems, optimal substructure, and choosing a state.",
    sections: [
      sec("state", "Defining the state", "The hardest part is choosing what a subproblem is. Write dp[i] in words before writing any code.", "dynamic-programming"),
      sec("memo", "Top-down memoization", "Start from the recursive solution and cache results by state.", "memoization"),
      sec("tab", "Bottom-up tabulation", "Fill the table in dependency order; this often allows space optimisation.", "tabulation"),
    ],
  },
  {
    id: "recursion", title: "Recursion", classroomId: "dsa", conceptIds: ["recursion", "functions"], published: true, updated: "Sep 05",
    summary: "Base cases, recursive state and trusting the recursive leap.",
    sections: [
      sec("base", "Base cases", "Every recursive function needs at least one case that returns without recursing. Missing or unreachable base cases cause infinite recursion.", "recursion"),
      sec("state", "Recursive state", "Identify exactly what changes between calls. Each call should move strictly closer to a base case."),
    ],
  },
  {
    id: "complexity-ml", title: "Complexity in Learning Systems", classroomId: "ml", conceptIds: ["complexity", "space-complexity"], published: true, updated: "Sep 14",
    summary: "Why training cost scales the way it does.",
    sections: [sec("cost", "Training cost", "Gradient descent costs O(n·d) per epoch for n samples and d features.", "complexity")],
  },
  {
    id: "graph-theory", title: "Graph Theory Primer", classroomId: "discrete", conceptIds: ["graphs", "trees", "mst"], published: true, updated: "Sep 16",
    summary: "Vertices, edges, degrees and spanning trees.",
    sections: [sec("basics", "Basics", "A graph G = (V, E). The handshake lemma: the sum of degrees equals 2|E|.", "graphs"), sec("mst", "Spanning trees", "A spanning tree connects all vertices with exactly |V| − 1 edges.", "mst")],
  },
];

const mcq = (id: string, prompt: string, options: string[], answer: string, conceptId: string): Question => ({ id, type: "mcq", prompt, options, answer, conceptId });
const short = (id: string, prompt: string, answer: string, conceptId: string): Question => ({ id, type: "short", prompt, answer, conceptId });

export const tests: Test[] = [
  {
    id: "search-sort", title: "Searching & Sorting Checkpoint", classroomId: "dsa", conceptIds: ["binary-search", "sorting", "time-complexity"], durationMin: 20, due: "Sep 28", status: "published",
    questions: [
      mcq("q1", "What is the worst-case time complexity of binary search on a sorted array of n elements?", ["O(n)", "O(log n)", "O(n log n)", "O(1)"], "O(log n)", "binary-search"),
      mcq("q2", "Using a closed interval [lo, hi], which loop condition is correct?", ["lo < hi", "lo <= hi", "lo != hi", "hi - lo > 1"], "lo <= hi", "binary-search"),
      mcq("q3", "Which sorting algorithm is stable and guarantees O(n log n)?", ["Quick sort", "Heap sort", "Merge sort", "Selection sort"], "Merge sort", "sorting"),
      short("q4", "Name the traversal that visits a BST's keys in sorted order.", "in-order", "trees"),
      mcq("q5", "Two nested loops each running n times give:", ["O(n)", "O(2n)", "O(n²)", "O(log n)"], "O(n²)", "time-complexity"),
    ],
  },
  {
    id: "graph-foundations", title: "Graph Foundations Quiz", classroomId: "dsa", conceptIds: ["graphs", "bfs", "dfs"], durationMin: 15, due: "Oct 02", status: "published",
    questions: [
      mcq("g1", "Which data structure does BFS rely on?", ["Stack", "Queue", "Heap", "Hash table"], "Queue", "bfs"),
      mcq("g2", "DFS can be implemented iteratively using a:", ["Queue", "Stack", "Deque only", "Priority queue"], "Stack", "dfs"),
      mcq("g3", "Space used by an adjacency list:", ["O(V²)", "O(V + E)", "O(E²)", "O(V log E)"], "O(V + E)", "graphs"),
      short("g4", "Which traversal finds shortest paths in an unweighted graph?", "bfs", "bfs"),
    ],
  },
  {
    id: "recursion-dp", title: "Recursion & DP Drill", classroomId: "dsa", conceptIds: ["recursion", "dynamic-programming"], durationMin: 25, due: "Oct 06", status: "draft",
    questions: [mcq("r1", "What must every recursive function have?", ["A loop", "A base case", "A global variable", "Two parameters"], "A base case", "recursion")],
  },
  {
    id: "trees-traversals", title: "Trees & Traversals", classroomId: "dsa", conceptIds: ["trees", "bst"], durationMin: 15, due: "Sep 19", status: "published",
    questions: [mcq("t1", "Height of a single-node tree?", ["0", "1", "-1", "Undefined"], "0", "trees")],
  },
  {
    id: "complexity-check", title: "Complexity Checkpoint", classroomId: "ml", conceptIds: ["big-o", "space-complexity"], durationMin: 15, due: "Sep 30", status: "published",
    questions: [mcq("c1", "O(3n + 5) simplifies to:", ["O(3n)", "O(n)", "O(5)", "O(n + 5)"], "O(n)", "big-o")],
  },
  {
    id: "graph-theory-quiz", title: "Graph Theory Quiz", classroomId: "discrete", conceptIds: ["graphs", "mst"], durationMin: 20, due: "Oct 04", status: "published",
    questions: [
      mcq("d1", "A spanning tree on 10 vertices has how many edges?", ["10", "9", "11", "45"], "9", "mst"),
      mcq("d2", "Sum of all vertex degrees equals:", ["|E|", "2|E|", "|V|", "|V|·|E|"], "2|E|", "graphs"),
    ],
  },
];

export const submissions: Submission[] = [
  { testId: "trees-traversals", studentId: "s-arjun", score: 73, date: "Sep 19" },
  { testId: "trees-traversals", studentId: "s-priya", score: 94, date: "Sep 19" },
  { testId: "trees-traversals", studentId: "s-meera", score: 86, date: "Sep 19" },
  { testId: "trees-traversals", studentId: "s-karthik", score: 61, date: "Sep 19" },
  { testId: "trees-traversals", studentId: "s-sneha", score: 90, date: "Sep 19" },
  { testId: "trees-traversals", studentId: "s-rahul", score: 48, date: "Sep 20" },
  { testId: "trees-traversals", studentId: "s-aditya", score: 70, date: "Sep 20" },
  { testId: "complexity-check", studentId: "s-ananya", score: 92, date: "Sep 23" },
  { testId: "complexity-check", studentId: "s-kavya", score: 85, date: "Sep 23" },
];

/** Arjun's historical scores for trend charts */
export const arjunHistory = [
  { label: "Arrays Quiz", date: "Aug 22", score: 58 },
  { label: "Stacks & Queues", date: "Aug 30", score: 66 },
  { label: "Complexity Basics", date: "Sep 06", score: 74 },
  { label: "Recursion Warm-up", date: "Sep 12", score: 52 },
  { label: "Trees & Traversals", date: "Sep 19", score: 73 },
];

export const tailoredReasons: Record<string, { why: string; points: string[]; example: string }> = {
  "binary-search": {
    why: "You missed 3 of 4 boundary-condition questions across your last two tests, and your mastery dropped 6 points this fortnight.",
    points: ["Pick one interval convention (closed or half-open) and stick to it.", "Write the loop invariant before the loop.", "Test with arrays of length 0, 1 and 2."],
    example: "lo, hi = 0, n - 1\nwhile lo <= hi:\n    mid = lo + (hi - lo) // 2\n    if a[mid] == t: return mid\n    if a[mid] < t: lo = mid + 1\n    else: hi = mid - 1",
  },
  recursion: {
    why: "Your Recursion Warm-up score (52%) was your lowest, mostly on questions about base cases and recursive state.",
    points: ["Identify the smallest input first — that is your base case.", "State exactly what each call receives and returns.", "Trust the recursive call to solve the smaller problem."],
    example: "def depth(node):\n    if node is None: return 0\n    return 1 + max(depth(node.left), depth(node.right))",
  },
  dfs: {
    why: "You answer BFS questions confidently (76%) but DFS questions lag behind (45%), especially iterative versions.",
    points: ["DFS = stack; BFS = queue.", "Mark vertices visited when pushed, not only when popped, to avoid duplicates.", "Recursion uses the call stack implicitly."],
    example: "stack = [start]\nwhile stack:\n    v = stack.pop()\n    for w in adj[v]:\n        if w not in seen:\n            seen.add(w); stack.append(w)",
  },
  "dynamic-programming": {
    why: "Dynamic Programming is your lowest-mastery assessed concept and several upcoming topics depend on it.",
    points: ["Define dp[i] in plain words first.", "Find the recurrence from the last decision made.", "Choose memoization or tabulation, then optimise space."],
    example: "dp = [0, 1]\nfor i in range(2, n + 1):\n    dp.append(dp[-1] + dp[-2])",
  },
  backtracking: {
    why: "Backtracking appeared in two practice sets where you stopped early.",
    points: ["Choose → explore → un-choose.", "Prune as early as possible."],
    example: "def bt(path):\n    if done(path): out.append(path[:]); return\n    for c in choices(path):\n        path.append(c); bt(path); path.pop()",
  },
};
