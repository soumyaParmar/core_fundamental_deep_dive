# 🧠 Module 05: Multi-Agent Collaboration

---

## 1. Definition
**Multi-Agent Collaboration** is the architectural pattern of dividing a complex workflow among multiple, specialized autonomous agents that coordinate tasks, share context, and transfer execution control using structured state graphs or event-driven communication protocols.
* **One-line Mental Model:** Instead of hiring one developer to write, test, and deploy code in isolation (Single Agent), a multi-agent system builds a software team consisting of a product manager (Supervisor), a coder (Worker A), and a QA tester (Worker B) communicating over a shared project board (State Graph).

---

## 2. Drill Down

### A. Multi-Agent Topologies
1. **Supervisor-Worker (Hierarchical):** A central supervisor agent orchestrates the workflow. It receives the user query, determines the best worker to invoke, delegates the task, captures the worker's output, and decides the next step. Excellent for open-ended, complex tasks.
2. **Sequential Choreography (Chain):** Agents execute in a linear pipeline (e.g., `Researcher` ──► `Writer` ──► `Editor`). Each agent receives the output of the previous agent, performs its job, updates the state, and passes it forward.
3. **Peer-to-Peer Network (Colleague):** Agents communicate dynamically with each other without a central manager. A `CodeGenerator` agent can directly query a `DatabaseHelper` agent for schema information whenever it needs it.

```
Supervisor-Worker               Sequential Chain                 Peer-to-Peer
   [Supervisor]                 [Researcher]                     [Agent A] ◄───► [Agent B]
   ┌────┼────┐                       │                                ▲             ▲
   ▼    ▼    ▼                       ▼                                └───► [Agent C] ┘
  [W1] [W2] [W3]                 [Writer] ──► [Editor]
```

### B. Routing and Hand-offs
Control is transferred between agents in a graph:
* **Static Hand-off:** An edge dictates that once Node A finishes, Node B always executes.
* **Dynamic Routing:** A node returns a payload containing the next target node name (e.g., `return { next: "Reviewer" }`). The conditional edge reads this key and routes the thread accordingly.

### C. State Propagation (Shared vs. Partitioned)
* **Shared State:** All agents read from and write to the exact same global state object. Easy to implement but can lead to context pollution (unrelated worker logs cluttering the prompt).
* **Partitioned State (Local Memory):** The orchestrator extracts only a subset of the global state (e.g., passing only the draft text, not the database tables) to send to the worker. The worker updates its local state, and the orchestrator merges the updates back into the global state.

---

## 3. Why It Exists
Single agents given dozens of tools and long system prompts suffer from several limitations:
1. **Tool Selection Degradation:** As the number of registered tools increases, the LLM's accuracy in choosing the correct tool and formatting parameters drops significantly (tool attention confusion).
2. **Context Dilution:** Mixing system instructions for writing, testing, and formatting in a single prompt makes the model lose track of specific constraints.
3. **Monolithic Testing:** Testing and debugging a single massive prompt is highly difficult, as fixing one behavior often breaks another.

Dividing the system into modular sub-agents with narrow scopes, targeted tool registries, and simple prompts makes development, unit testing, and deployment scalable.

---

## 4. Internal Working
Below is the execution flow of a Supervisor-directed Multi-Agent system:

```
[ User Prompt: "Write a function to fetch logs and review it" ]
                       │
                       ▼
               [ Supervisor Node ] ◄─────────────────────────────────────┐
  (LLM decides: Next = "Writer" or "Reviewer" or "END")                  │
                       │                                                 │
        ┌──────────────┴──────────────┐                                  │
        ▼                             ▼                                  │
  [ Writer Node ]             [ Reviewer Node ]                          │
 (Writes JS code)            (Runs static checks)                        │
        │                             │                                  │
        ▼ (Updates state.code)        ▼ (Updates state.feedback/status)  │
  [ Save Checkpoint ]         [ Save Checkpoint ]                        │
        │                             │                                  │
        └─────────────────────────────┴──────────────────────────────────┘
```

The Supervisor inspects the current state. If `state.code` is empty, it outputs a command to route to the `Writer`. The Writer writes code and updates `state.code`. The Supervisor runs again, sees that code exists but `state.feedback` is empty, and routes to `Reviewer`. The Reviewer evaluates the code, writes `feedback`, and sets `state.status = 'approved'`. The Supervisor runs a final time, reads the approval status, and routes to `END`, returning the code.

---

## 5. Advantages
1. **High Precision:** Specialized agents with small toolsets make fewer mistakes in tool execution.
2. **Modular Architecture:** Prompts and configurations are isolated, allowing team members to work on separate agents independently.
3. **Token Conservation:** Partitioned state prevents passing massive context history to every worker.

---

## 6. Disadvantages & Pitfalls
1. **Infinite Chatter Loops:** If the Writer and Reviewer disagree (e.g., Coder generates code, Tester flags a style warn, Coder writes it slightly differently, Tester flags it again), they can run back and forth in an endless loop, exhausting API limits.
2. **Latency Accumulation:** Running multiple agent loops sequentially multiplies execution latency, making it unsuitable for real-time APIs.
3. **State Sync Overhead:** Merging conflicting data written by parallel worker nodes requires writing custom state reducers.

---

## 7. Production Usage
Here is a complete, production-grade **TypeScript** implementation of a **Supervisor-driven Multi-Agent Graph** matching LangGraph-style execution. It partitions state updates and manages dynamic routing based on agent evaluations.

```typescript
// 1. Define the Global State Schema
interface TeamState {
  task: string;
  code: string;
  feedback: string;
  status: "pending" | "revised" | "approved";
  nextAgent: string;
}

// Helper representing individual Worker nodes
type WorkerNode = (state: TeamState) => Promise<Partial<TeamState>>;

export class MultiAgentTeam {
  private state: TeamState;
  private nodes: Map<string, WorkerNode> = new Map();
  private maxLoops = 5;
  private currentLoop = 0;

  constructor(task: string) {
    this.state = {
      task,
      code: "",
      feedback: "",
      status: "pending",
      nextAgent: "supervisor"
    };
    this.initializeNodes();
  }

  private initializeNodes() {
    // Node A: Supervisor - Decides who runs next
    this.nodes.set("supervisor", async (state) => {
      console.log(`[Supervisor] Evaluating state. Current Status: "${state.status}"`);
      
      if (!state.code) {
        return { nextAgent: "coder" };
      }
      if (state.status === "pending" || state.status === "revised") {
        return { nextAgent: "tester" };
      }
      if (state.status === "approved") {
        return { nextAgent: "END" };
      }
      return { nextAgent: "END" };
    });

    // Node B: Coder Worker - Writes or updates code
    this.nodes.set("coder", async (state) => {
      console.log("[Coder] Writing code draft...");
      let codeDraft = "";
      
      if (state.status === "pending") {
        codeDraft = `function calculateTotal(price, tax) { return price + tax; }`;
      } else {
        console.log(`[Coder] Fixing code based on feedback: "${state.feedback}"`);
        codeDraft = `function calculateTotal(price, tax) { if (typeof price !== 'number') throw new Error('Invalid type'); return price + tax; }`;
      }

      return {
        code: codeDraft,
        status: "revised",
        nextAgent: "supervisor" // Route back to supervisor
      };
    });

    // Node C: Tester Worker - Audits code
    this.nodes.set("tester", async (state) => {
      console.log("[Tester] Running validations on code...");
      
      if (!state.code.includes("typeof")) {
        console.log("[Tester] Quality checks failed: No parameter validation.");
        return {
          feedback: "Add parameter type validation checks.",
          status: "pending", // Revert status to trigger rewrite
          nextAgent: "supervisor"
        };
      } else {
        console.log("[Tester] Quality checks passed. Code approved.");
        return {
          feedback: "All tests passed.",
          status: "approved",
          nextAgent: "supervisor"
        };
      }
    });
  }

  /**
   * Runs the multi-agent graph execution loop.
   */
  public async execute(): Promise<TeamState> {
    console.log(`[Team Start] Goal: "${this.state.task}"`);
    
    while (this.state.nextAgent !== "END" && this.currentLoop < this.maxLoops) {
      const current = this.state.nextAgent;
      const nodeFn = this.nodes.get(current);
      
      if (!nodeFn) {
        throw new Error(`Node "${current}" is not registered.`);
      }

      console.log(`\n--- Loop Step ${this.currentLoop + 1}: Executing ${current.toUpperCase()} ---`);
      const updates = await nodeFn(this.state);
      
      // Merge updates into state
      this.state = { ...this.state, ...updates };
      this.currentLoop++;
    }

    if (this.currentLoop >= this.maxLoops) {
      console.log("\n[Team Warning] Loop terminated due to execution step limit.");
    } else {
      console.log("\n[Team Success] Goal accomplished.");
    }

    return this.state;
  }
}

// Run the team simulation
const team = new MultiAgentTeam("Write calculateTotal function with validation");
team.execute().then(finalState => {
  console.log("\nFinal Team Code Output:\n", finalState.code);
});
```

---

## 8. Interview Q&A

### 🔹 Basic Questions
#### Q1: What is a multi-agent system, and why is it used?
A multi-agent system partitions a complex problem space into multiple specialized agents with distinct system prompts and tools. It is used because single agents get overwhelmed by too many instructions, losing focus and failing tool selection tasks.

#### Q2: What is the difference between Supervisor-Worker and Chain multi-agent topologies?
* **Supervisor-Worker:** A central supervisor LLM dynamically decides which agent to invoke next, acting as a manager.
* **Chain Topology:** Agents execute in a fixed linear order, passing their outputs directly to the next node in the pipeline.

#### Q3: What is a "state hand-off" in agent graphs?
A state hand-off is the transition of execution control from one node (agent) to another. It occurs by updating the target node key in the state, which is evaluated by the routing edges.

#### Q4: Why is it important to use local (partitioned) states for sub-agents?
Passing the entire global state to every agent clutters the context window with irrelevant data, diluting attention. Partitioning ensures agents only receive the inputs they need to perform their specific task, conserving tokens.

#### Q5: What is "Agent Chatter" in multi-agent workflows?
Agent chatter is an infinite feedback loop where two agents (e.g. Coder and Reviewer) repeatedly modify and reject each other's outputs without reaching a consensus, draining API tokens.

---

### 🔸 Intermediate Questions
#### Q6: How do you implement loop detection to prevent endless agent chatter?
Implement a step-tracker inside the state schema or the graph router. Keep count of how many times Node A and Node B exchange state. If the transition between Node A and Node B occurs more than $N$ times (e.g. 3 times), force a routing transition to a validation node or human approval gate.

#### Q7: Describe the Peer-to-Peer (colleague) multi-agent communication pattern.
In this pattern, there is no central supervisor. Agents execute and call each other directly as tools. For example, a `WriterAgent` executing a prompt can call a `ResearchAgent` as an external API tool, passing sub-questions and waiting for responses dynamically.

#### Q8: How can you optimize multi-agent latency when executing tasks that do not depend on each other?
Configure the orchestrator to run independent agent nodes in parallel (e.g. using `Promise.all` in TypeScript). The supervisor splits the task, launches the sub-agents concurrently, collects their updates, and merges them using custom array-reducer functions once they all complete.

#### Q9: What is the difference between "Shared State" and "Local State" variables in agent graphs?
* **Shared State:** Variables that are visible and mutable by all nodes in the graph (e.g., project config).
* **Local State:** Temporary variables that exist only within the context of a single node's execution (e.g., model raw completion response).

#### Q10: How would you design a conflict-resolution policy for parallel agents writing to a shared document?
Use a diff-and-merge or schema reducer strategy:
1. **Branching:** Have each agent write updates to a unique key (e.g., `draft_agent_1`, `draft_agent_2`).
2. **Merge Node:** Route both outputs to a `MergeAgent` (or Git-like diff engine) that resolves conflicts, consolidates the changes, and updates the main `draft` key.

---

### ⚡ Advanced Questions
#### Q11: Explain how you would implement a distributed message bus architecture (like RabbitMQ) to manage asynchronous multi-agent choreography.
* **Architecture:**
  * **Event Bus:** Define RabbitMQ exchanges (e.g., `agent.events`).
  * **Queues:** Create queues for each agent class (`queue.coder`, `queue.tester`).
  * **Choreography Flow:** When the Coder finishes a task, it publishes an `agent.code.written` event containing the session ID and code pointer. The Tester queue listens to this event routing key, receives the message, spawns a worker to compile and run tests, and publishes `agent.code.tested` event, keeping agents decoupled.

#### Q12: How do you prevent data leakage when a multi-agent system handles user requests containing private company data?
1. **Context Filtering:** Mask PII and sensitive data before propagating state to sub-agents.
2. **Isolated Tool Keys:** Ensure sub-agents do not share system credentials. A `WebSearchAgent` has no database access keys, and a `DBAgent` has no external internet access, enforcing network isolation.
3. **Data Sandboxing:** Execute database agents in read-only replicas restricted to the active tenant's schema namespace.

#### Q13: What is "State Grafting" in hierarchical multi-agent workflows?
State grafting is the process of taking the output state of a sub-graph execution (e.g., a 10-step sub-agent code debug run) and mapping its final values back into a single key of the parent graph state (e.g., writing the compiled code string back to `state.finalCode`), discarding all transient logs and compiler steps of the sub-graph.

#### Q14: Explain the trade-offs between using a single LLM with 20 tools vs 5 specialized agents with 4 tools each.
* **Single LLM (20 Tools):** Lower latency (no inter-agent hand-offs), simpler code. However, tool selection accuracy drops significantly, prompts are bloated, and debugging is difficult.
* **5 Specialized Agents:** High precision (each agent has a targeted system prompt and small tool schema), modular testing. However, latency increases due to multi-hop LLM routing, and network transfer sizes are larger.

#### Q15: How can you implement dynamic task allocation in a Supervisor agent without hardcoding the routing paths?
Instead of hardcoding routing tables, prompt the Supervisor LLM with a list of available worker agent profiles (name, specialty, input requirements) and the current state. Instruct the LLM to output a JSON block indicating the chosen agent and the input payload (e.g., `{"invoke": "CoderAgent", "payload": { "fix": "..." }}`). The graph engine parses this JSON, locates the matching node dynamically, and executes it.

---

### 🏛️ System Design Questions
#### Q16: Design a Multi-Agent Software Development team pipeline containing a PM Agent, Coder Agent, and QA Agent, demonstrating state transition logic, test runner execution, and automated loop limits.
* **Architecture:**
  * **State Schema:** `task`, `spec`, `code`, `errors`, `status`, `next`.
  * **PM Node:** Receives user goal, writes detailed specification Markdown, routes to Coder.
  * **Coder Node:** Reads spec and errors, generates JS code inside Docker sandbox, routes to QA.
  * **QA Node:** Runs test suite inside sandbox.
    * If tests pass: sets `status = 'approved'`, routes to PM.
    * If tests fail: writes stack trace to `errors`, routes to Coder.
  * **Loop Limit Guard:** If loop step counter $> 6$, the router intercepts execution, posts a warning alert to a Slack channel, and routes to `END` to prevent token drains.

```
Goal ──► [PM Agent] ──► [Coder Agent] ◄── (Update with errors)
                              │
                              ▼
                         [QA Sandbox]
                           │      │
                           │      └─── Fail ──► [Reflector Node]
                           ▼
                       [Success] ──► [Deploy Node]
```

#### Q17: Design an Enterprise Translation and Localization Pipeline using multi-agent choreography, where specialized agents translate text, check grammar, audit safety compliance, and align formatting concurrently.
* **Architecture:**
  * **Orchestrator Node:** Receives raw text and splits it into parallel paragraphs.
  * **Concurrency Fan-out:** Launches parallel branches for each paragraph.
    * **Translation Agent:** Translates paragraph to target language.
    * **Reviewer Agent:** Concurrently audits translation for grammar.
    * **Safety Agent:** Concurrently reviews translation for regulatory/safety compliance.
  * **Synchronization Gateway (Fan-in):** A sync barrier waits for all parallel tasks to complete (`Promise.all`).
  * **Consolidator Agent:** Combines paragraphs back into a single document, ensures original formatting (markdown/HTML) is retained, and writes the output file.
