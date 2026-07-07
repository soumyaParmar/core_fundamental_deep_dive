# 🧠 Module 07: Agent Evaluation & Monitoring

---

## 1. Definition
**Agent Evaluation and Monitoring** is the engineering practice of instrumenting agent workflows with span-level tracing, loop detectors, and evaluation metrics (trajectory analysis) to measure reliability, optimize costs, and catch runaway executions.
* **One-line Mental Model:** While standard logging records that a page loaded, agent monitoring visualizes the complete step-by-step thinking process, tool choices, and error responses of the agent's brain during its execution run.

---

## 2. Drill Down

### A. Trajectory Evaluation (Intermediate Steps)
Traditional NLP evaluates the final output. In agentic systems, the *path* taken is equally important:
1. **Tool Efficiency:** Did the agent retrieve the information in 2 tool calls or did it take 15 redundant calls?
2. **Path Correctness (Trajectory):** Did the agent follow safety protocols? (e.g. did it run tests before committing code?).
3. **LLM-as-a-Judge Trajectory Evaluation:** A critic LLM reviews the full trace log and scores: *Tool Choice Accuracy, Redundant Call Rate, and Logic Coherence*.

### B. Simulation-Based Testing (CI/CD)
To test agents automatically without connecting to real databases or charging actual credit cards:
* **Mock Sandboxes:** Create a local mock environment (e.g. a virtual git workspace or mock payment portal).
* **Deterministic Runs:** Seed the agent with a query and run it against the mock portal. The CI/CD suite asserts that the agent must complete the task (e.g., merging a bug fix) in $< 6$ steps and write valid code.

### C. Runaway Loop Detection
Agents can easily get stuck in infinite loops (e.g. calling a tool, receiving an error, parsing the error, calling the same tool with the same arguments).
* **Cycle Tracker:** The execution loop maintains a hash map of visited nodes and arguments: `Map<string, number>` (key: `nodeName + hash(args)`). If a key's count exceeds a threshold (e.g., 2), the system raises a safety flag and halts the workflow.

### D. Cost & Latency Controls
1. **Max Steps Guard:** Enforces a hard limit (e.g. max 10 execution loops) per run.
2. **Context Budget:** Measures input and output token counts dynamically. If the context window exceeds $80,000$ tokens, the manager halts processing to prevent massive API billing.
3. **Timeout Clamps:** Aborts worker threads if execution takes longer than a fixed duration (e.g. 2 minutes).

---

## 3. Why It Exists
Stateless software applications are deterministic. When they fail, a stack trace points directly to the line of code that threw the error.

Agentic systems are non-deterministic:
1. **Silent Failures:** The agent might run to completion and return a polite answer, but internally failed 5 tool calls and spent $100,000$ tokens on hallucinated search loops.
2. **Runaway Cost Loops:** A simple bug in a prompt can make the agent query the LLM repeatedly in a loop, running up massive API bills within minutes.
3. **Attention Degradation:** Over time, updates to base model APIs alter how the model processes prompts, introducing silent reasoning regressions.

---

## 4. Internal Working
Below is the tracing and telemetry capture architecture:

```
[ Agent Graph Runner ]
       │
       ▼ (Emit Spans: node_start, node_end, tool_start, tool_end)
[ Telemetry Collector (OpenTelemetry / LangSmith SDK) ]
       │
       ▼ (Asynchronous queue)
[ Message Broker (Kafka) ] ──► [ ClickHouse DB (Trace Store) ]
                                      │
                                      ▼
                        [ Monitoring Dashboard (Grafana) ]
       ┌──────────────────────────────┴──────────────────────────────┐
       ▼                                                             ▼
 [ Cost / Token Alerts ]                                    [ Trajectory Evaluator ]
 (Alerts Slack if run > $1)                               (Scores node transition path)
```

During execution, every node and tool call is wrapped in a "Span" tracker. The span captures:
* `span_id`, `parent_span_id` (defines the call hierarchy tree)
* `input_payload`, `output_payload`
* `token_counts` (prompt and completion)
* `latency_ms`

These spans are pushed asynchronously to a trace database (ClickHouse/Elasticsearch) for analysis.

---

## 5. Advantages
1. **Financial Security:** Loop detectors block runaway token spend.
2. **Clear Telemetry:** Trace logs expose the exact intermediate step that failed, making prompt tuning simple.
3. **Automated Testing:** Simulation runs prevent code changes from introducing logic regressions.

---

## 6. Disadvantages & Pitfalls
1. **Telemetry Latency:** Writing complete span logs to external databases in real-time can add network latency (requires async batching).
2. **Storage Costs:** Storing full conversation history and raw tool output strings for millions of daily runs creates massive database storage overhead.
3. **False Positive Loop Blocks:** Complex tasks (like analyzing a large codebase) require calling the same file-reading tools repeatedly. A naive loop detector will falsely abort valid runs (requires parameter-aware hashing).

---

## 7. Production Usage
Here is a complete, production-grade **TypeScript** implementation of a **Trajectory Tracer and Infinite Loop Detector**. It tracks graph execution paths, logs parent-child spans, builds a trace tree, and halts execution if a cycle loop is detected.

```typescript
interface Span {
  id: string;
  name: string;
  parentId: string | null;
  inputs: any;
  outputs: any;
  startTime: number;
  durationMs?: number;
}

export class AgentTelemetryTracker {
  private spans: Span[] = [];
  private nodeVisitCounts: Map<string, number> = new Map();
  private maxVisitsAllowed = 2; // Threshold to prevent infinite loops

  /**
   * Spans Lifecycle: Start tracking node execution.
   */
  public startSpan(name: string, parentId: string | null, inputs: any): string {
    const spanId = `${name}-${Math.random().toString(36).substring(7)}`;
    const span: Span = {
      id: spanId,
      name,
      parentId,
      inputs,
      outputs: null,
      startTime: Date.now()
    };
    this.spans.push(span);

    // Loop Detection Check: Count visits per unique node name
    const visits = this.nodeVisitCounts.get(name) || 0;
    if (visits >= this.maxVisitsAllowed) {
      throw new Error(`CRITICAL: Runaway Loop Detected! Node "${name}" has been visited ${visits + 1} times. Terminating execution.`);
    }
    this.nodeVisitCounts.set(name, visits + 1);

    console.log(`[Span Start] ID: ${spanId} | Node: "${name}" | Visit Count: ${visits + 1}`);
    return spanId;
  }

  /**
   * Spans Lifecycle: End tracking node execution.
   */
  public endSpan(spanId: string, outputs: any): void {
    const span = this.spans.find(s => s.id === spanId);
    if (span) {
      span.outputs = outputs;
      span.durationMs = Date.now() - span.startTime;
      console.log(`[Span End] ID: ${spanId} | Duration: ${span.durationMs}ms`);
    }
  }

  public getTraceTree(): Span[] {
    return this.spans;
  }

  public clearTelemetry(): void {
    this.spans = [];
    this.nodeVisitCounts.clear();
  }
}

// Simulation Run demonstrating loop detection
async function runLoopSimulation() {
  const tracker = new AgentTelemetryTracker();
  let parentSpanId: string | null = null;

  try {
    // Step 1: Execute planner node
    parentSpanId = tracker.startSpan("planner", null, { task: "Fix auth bug" });
    await new Promise(r => setTimeout(r, 100)); // Simulate work
    tracker.endSpan(parentSpanId, { plan: ["readCode", "runTest"] });

    // Step 2: Coder node starts and tries to read code
    const readSpan1 = tracker.startSpan("readCode", parentSpanId, { path: "auth.ts" });
    tracker.endSpan(readSpan1, { error: "File not found" });

    // Step 3: Coder gets error and retries the exact same node (Visit 2)
    const readSpan2 = tracker.startSpan("readCode", parentSpanId, { path: "auth.ts" });
    tracker.endSpan(readSpan2, { error: "File not found" });

    // Step 4: Coder gets error again and retries (Visit 3 -> Triggers Loop Exception)
    const readSpan3 = tracker.startSpan("readCode", parentSpanId, { path: "auth.ts" });
    tracker.endSpan(readSpan3, { error: "File not found" });

  } catch (error: any) {
    console.error(`\n[Execution Terminated] ${error.message}`);
  }
}

runLoopSimulation();
```

---

## 8. Interview Q&A

### 🔹 Basic Questions
#### Q1: What is "Trajectory Evaluation" in agentic systems?
Trajectory evaluation is the practice of auditing and scoring the intermediate steps, thoughts, tool calls, and transitions of an agent run (the path taken), rather than evaluating only the final response text.

#### Q2: Why are standard software unit tests insufficient to validate agents?
Agents are non-deterministic and dynamic. The same user prompt can trigger different tool sequences or phrases on every run. Standard assertions cannot validate loose natural language or variable reasoning paths.

#### Q3: What is the purpose of loop detection in agent orchestration?
Loop detection prevents the agent from getting stuck in endless cycles (e.g. repeatedly calling a failing API tool), conserving API quotas and protecting host resources.

#### Q4: What is a "Span" in LLM tracing?
A Span is the fundamental building block of tracing. It represents a single unit of work (e.g. an LLM API call, a DB query, or a node execution) containing input, output, start/end timestamps, and token usage data.

#### Q5: Name two popular tracing platforms used for agent operations (LLMOps).
Popular platforms include LangSmith, Arize Phoenix, weights & biases (Prometheus), and OpenLLMetry.

---

### 🔸 Intermediate Questions
#### Q6: How would you design a parameter-aware loop detector?
Instead of hashing only the node name, hash the combination of the node name and the serialized argument string: `hash(nodeName + JSON.stringify(args))`. If this specific hash key is visited more than twice, trigger the loop block. This allows the agent to call the same tool repeatedly with *different* parameters (e.g., reading different files) while blocking redundant, identical queries.

#### Q7: Describe how to implement simulation-based testing in a CI/CD pipeline for a git agent.
1. **Mock Workspace:** Spin up a temporary git repository containing seed files.
2. **Execute Agent:** Invoke the agent with a goal: *"Refactor user.ts to use interface X."*
3. **Validation Actions:** After execution completes, the CI/CD script runs `git diff` and executes `tsc` to verify that the code compiles, the syntax is valid, and the file was modified in under 5 agent steps.

#### Q8: What are the primary metrics to monitor to detect reasoning drift in production?
Monitor:
1. **Average Steps per Run:** A sudden increase indicates the agent is struggling to find answers.
2. **Tool Failure Rate:** Rises if APIs change or token structures drift.
3. **User Thumbs-down Rate:** Direct feedback indicating user dissatisfaction.
4. **Token Cost per Query:** Monitors cost inflation.

#### Q9: How can you implement hard context token budgets in LangGraph workflows?
Create a router edge that checks the accumulated token count:
```typescript
if (state.totalTokensUsed > 80000) return "AlertAndHaltNode";
return nextNode;
```
If the token limit is crossed, the graph transitions to a fallback safety node, returning a warning to the user to prevent expensive runs.

#### Q10: Why is storing full tracing logs directly in Elasticsearch sometimes problematic, and how do you optimize it?
* **Problem:** Elastic indexing is heavy and expensive for millions of multi-step logs.
* **Optimization:** Write real-time logs to a fast message queue (Kafka) first. Use a ClickHouse database (columnar storage) for trace storage, as it compresses text efficiently and handles high-volume write workloads at lower hardware costs.

---

### ⚡ Advanced Questions
#### Q11: Explain how you would implement a distributed tracing pipeline for an agent system using OpenTelemetry.
* **Implementation:**
  1. **Span Context:** Inject OpenTelemetry context headers (`traceparent`) into every agent request and tool call.
  2. **Inter-agent propagation:** When Agent A calls Agent B via an HTTP API, propagate the context headers.
  3. **Collector:** Run an OpenTelemetry Collector daemon on the nodes. The agent SDK writes spans to this local daemon via gRPC, which batches and routes them to a backend like Jaeger or Zipkin.

#### Q12: How do you evaluate the "Faithfulness" of an agent's trajectory programmatically?
1. **Log Analysis:** Retrieve the complete list of context chunks retrieved by the agent during its search steps.
2. **Statement Extraction:** Extract all claims written by the agent in its final output.
3. **Verification:** Use a judge LLM to verify if each claim is supported by the retrieved context. The ratio of supported claims to total claims represents the Faithfulness score.

#### Q13: What is the "Cold Start" problem in simulation-based agent testing, and how do you resolve it?
* **Problem:** Setting up the complete test environment state (database tables, docker containers, API keys) takes too long, slowing down PR checks.
* **Resolution:** Use lightweight SQL engines (like SQLite or DuckDB in-memory) instead of PostgreSQL, and mount pre-cached container volumes in Docker to bypass downloading dependencies during CI/CD.

#### Q14: Explain the difference between Online Evaluation and Offline Evaluation in LLMOps.
* **Online Evaluation:** Occurs in real-time on active production runs. Typically limited to lightweight safety checks, guardrails, and token counters.
* **Offline Evaluation:** Occurs asynchronously. Runs test datasets against new prompt releases, calculating RAGAS metrics and logic scores over hundreds of scenarios before deployment.

#### Q15: How can you implement an automated "Prompt Regression Test Suite" for an agentic system?
Create an evaluation dataset containing 100 historical queries and their ground-truth answers. When a developer modifies an agent's prompt:
1. Run the new prompt on the 100 queries inside a test runner.
2. Calculate the average accuracy and step count.
3. Assert that the new prompt must maintain or exceed the accuracy threshold (e.g. $> 92\%$) and not increase average step count before the PR can be merged.

---

### 🏛️ System Design Questions
#### Q16: Design a real-time Telemetry and Alerting system for an enterprise agent fleet, detailing database schema and Slack alert thresholds for runaway loops.
* **Architecture:**
  * **Telemetry Collector:** Agent workers write spans asynchronously to a Kafka cluster.
  * **Database (ClickHouse):** Columnar trace store partitions data by date and `tenant_id`.
  * **Alert Engine:** A continuous streaming analytics processor (like Flink or a cron runner) queries ClickHouse:
    * Selects active sessions where the step count has exceeded 12 in the last 5 minutes.
  * **Slack Alert Dispatcher:** Posts alert payload: *"Warning: Session ID X is in a potential loop. Step count: 15. Cost: $2.40. Click here to Terminate."*

```
Agent Fleet ──► [Kafka] ──► [ClickHouse DB]
                                  │
                          (Loop Detector Cron)
                                  ▼
                        [Slack Alert Dispatcher]
```

#### Q17: Design a sandboxed Agent Simulation Environment for a software company that runs regression tests on code-generation agents in a Jenkins CI/CD pipeline, ensuring complete reproducibility.
* **Architecture:**
  * **Mock Repo Generator:** Clones a base Git repository branch representing the task start state.
  * **Sandbox Runner (gVisor Docker):** Spawns the agent inside a completely network-isolated container containing the code directory.
  * **Simulated API Servers:** Spins up local, mock API servers (mocking Slack and Jira APIs) inside the container's private virtual network.
  * **Agent Execution:** The agent runs its loops, modifying files and calling the mock APIs.
  * **Evaluator Assertions:** Once completed, the CI runner:
    1. Runs `eslint` and `jest` to verify code compiles and tests pass.
    2. Reads the agent's database checkpoint to assert step count $\le 5$.
    3. Destroys the container network namespace.
