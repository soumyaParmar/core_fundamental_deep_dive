# 🧠 Module 04: Agentic Memory Systems

---

## 1. Definition
An **Agentic Memory System** is a multi-tiered data storage and recall architecture that separates real-time conversational context (short-term) from persisted profiles, facts, and past execution trajectories (long-term) to maintain state across infinite time horizons.
* **One-line Mental Model:** Short-term memory is the active whiteboard the agent uses during a single conversation; long-term memory is its persistent database of filing cabinets containing consolidated user profiles and past lessons learned.

---

## 2. Drill Down

### A. The Multi-Tier Memory Hierarchy
1. **Short-Term (Conversational) Memory:** Stores the active, chronological message log. It is loaded directly into the LLM context window. Optimized via token truncation or rolling sliding windows.
2. **Long-Term (Semantic) Memory:** Stores structured or unstructured facts and rules (e.g. *"User prefers dark mode"*). Queried using vector embeddings based on the semantic similarity of the user's current prompt.
3. **Episodic Memory:** Stores traces of *how* an agent solved a task in the past (e.g., intermediate thoughts, tools used, and code syntax). If a new task looks similar, the agent queries episodic memory to replicate the successful execution trajectory.

### B. Memory Consolidation (Background Processing)
If an agent adds every single conversation statement directly to its vector database, the DB becomes cluttered with redundant, conversational noise (e.g. *"Hello," "Thank you," "Okay"*).
* **Asynchronous Consolidation:** A separate background worker listens for session-end events. It runs the conversation logs through a summarizer model that extracts key facts, checks for conflicts with existing database records, and updates the user's long-term profile index (semantic compression).

```
[ Active Chat Log ] ──► [ Session Closed ] ──► [ Kafka / BullMQ Event ]
                                                         │
                                                         ▼
                                             [ Consolidation Worker ]
                                             (LLM parses & extracts facts)
                                                         │
                                                         ▼
[ Vector DB / Long-term Memory ] ◄── [ Upsert / Merge into User Profile ]
```

### C. Context Trimming & Windowing
To prevent context overflow, memory managers apply algorithms:
* **Summarization Fallback:** Once context size exceeds $80\%$ of limits, summarize the oldest $50\%$ of messages, delete the raw messages, and prepend the summary card to the prompt.
* **Semantic Retrieval Pruning:** Only retrieve vector memories whose cosine similarity score exceeds a minimum threshold (e.g. $> 0.82$), filtering out low-value matches.

---

## 3. Why It Exists
LLMs have a fixed context window limit (e.g., 8k, 32k, or 128k tokens). Passing every single message from a three-month-old customer relationship to the prompt is impossible:
1. **Token Exhaustion:** The input size quickly exceeds the model limits.
2. **Cost Escalation:** Token billing scales linearly/quadratically. Re-sending massive history arrays is commercially unviable.
3. **Parametric Decay:** LLMs struggle to locate relevant details when drowned in massive, irrelevant context buffers (attention dilution).

---

## 4. Internal Working
Below is the data flow of the Multi-Tier Memory and Consolidation pipeline:

```
                  [ User Input: "Book my usual flight to JFK" ]
                                      │
                                      ▼
                        [ Memory Retrieval Phase ]
        ┌─────────────────────────────┼─────────────────────────────┐
        ▼                             ▼                             ▼
 [ Short-term Buffer ]       [ Semantic Profile ]          [ Episodic Log ]
 (Last 5 messages)         (Queries: "flight prefer")    (Queries: "booking trajectory")
        │                             │                             │
        └─────────────────────────────┼─────────────────────────────┘
                                      ▼
                       [ Synthesized Prompt Context ]
                                      │
                                      ▼
                                [ Generator LLM ]
                                      │
                                      ▼
[ Output Action ] ──► [ Asynchronous background consolidate trigger ]
```

During retrieval, the query is split. The vector database matches against "flight preference" (retrieving: *"Prefer evening flights on JetBlue"*) and episodic traces (retrieving the tool parameters for booking flights). The final prompt maps:
1. System Instructions
2. Consolidated Profile Memories
3. Previous 5 raw messages
4. New User Input

---

## 5. Advantages
1. **Infinite Scope:** Maintains context across days, weeks, and multiple distinct chat sessions.
2. **Token Efficiency:** Only pulls relevant details, keeping prompt size small.
3. **Hyper-Personalization:** Remembers user preferences, style, and rules permanently.

---

## 6. Disadvantages & Pitfalls
1. **Stale Memory Conflict:** If the database contains: *"User hates typescript,"* but the user prompt is: *"Write this code in TypeScript,"* the agent might refuse or argue due to outdated profile records (requires a recency weight decay).
2. **Memory Hallucinations:** An LLM parser might extract false facts from hypothetical statements (e.g., user says: *"If I were rich, I'd fly first class,"* and the system registers: *"User prefers first class tickets"*).
3. **Security Data Leaks:** If user profiles are not isolated at the DB tenant layer, user A's queries can match and retrieve private memories belonging to user B.

---

## 7. Production Usage
Here is a complete, production-grade **TypeScript** implementation of an **Agentic Memory System**. It manages a short-term conversation array, queries a mock semantic memory database, and runs an asynchronous consolidation step that extracts user facts and merges them into a profile.

```typescript
interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

interface UserProfile {
  userId: string;
  preferences: string[];
  lastConsolidated: number; // Timestamp
}

export class AgentMemoryManager {
  private shortTermBuffer: Message[] = [];
  private longTermProfiles: Map<string, UserProfile> = new Map();
  private maxBufferMessages: number;

  constructor(maxBufferMessages = 5) {
    this.maxBufferMessages = maxBufferMessages;
  }

  public addMessage(role: "user" | "assistant", content: string): void {
    this.shortTermBuffer.push({ role, content });
    
    // Automatically slide the window to enforce token/size constraints
    if (this.shortTermBuffer.length > this.maxBufferMessages) {
      const removed = this.shortTermBuffer.shift();
      console.log(`[Short-Term sliding] Pruned message from active window: "${removed?.content.substring(0, 30)}..."`);
    }
  }

  public getMessages(): Message[] {
    return this.shortTermBuffer;
  }

  // Simulates vector search on long-term profile data
  public retrieveLongTermMemory(userId: string, query: string): string[] {
    const profile = this.longTermProfiles.get(userId);
    if (!profile) return [];

    console.log(`[Semantic Memory Query] Searching profile for userId: "${userId}" on query: "${query}"`);
    // Mock simple keyword similarity matching for demonstration
    const keywords = query.toLowerCase().split(" ");
    return profile.preferences.filter(pref => 
      keywords.some(kw => pref.toLowerCase().includes(kw))
    );
  }

  /**
   * Memory Consolidation Node (Asynchronous Task Simulator).
   * Runs asynchronously when a chat session terminates.
   * Extracts user preferences and merges them into the database, resolving conflicts.
   */
  public async consolidateSessionMemory(userId: string): Promise<void> {
    console.log(`\n[Asynchronous Worker] Starting memory consolidation for user: ${userId}...`);

    // In production, this call would pass the chat history to an LLM with instructions
    // to extract key preference facts like "Prefers typescript", "Works at Google".
    const mockExtractedPreferences = [
      "User prefers TypeScript over Python for coding tasks",
      "User likes dark mode theme"
    ];

    let profile = this.longTermProfiles.get(userId);
    if (!profile) {
      profile = { userId, preferences: [], lastConsolidated: Date.now() };
    }

    // Merge logic: Deduplicate and update
    const updatedPreferences = [...profile.preferences];
    for (const newPref of mockExtractedPreferences) {
      // Very basic deduplication: check if preference already exists
      const normalizedNew = newPref.toLowerCase();
      const exists = updatedPreferences.some(p => p.toLowerCase().includes(normalizedNew.substring(0, 15)));
      if (!exists) {
        updatedPreferences.push(newPref);
        console.log(`[Consolidation Save] Added new fact: "${newPref}"`);
      }
    }

    profile.preferences = updatedPreferences;
    profile.lastConsolidated = Date.now();
    this.longTermProfiles.set(userId, profile);
    console.log(`[Consolidation Complete] User ${userId} profile updated. Total facts: ${profile.preferences.length}`);
  }
}

// Inline demonstration execution
const memory = new AgentMemoryManager(4);
memory.addMessage("user", "Hello! I am soumy. I am working on a TypeScript project.");
memory.addMessage("assistant", "Hi soumy! I will help you write TypeScript code.");
memory.addMessage("user", "Can you use standard camelCase naming?");
memory.addMessage("assistant", "Got it. camelCase naming rules applied.");

// Trigger background consolidation
memory.consolidateSessionMemory("USER-909").then(() => {
  const matchingMemories = memory.retrieveLongTermMemory("USER-909", "What language does the user use?");
  console.log("Retrieved Memories:", matchingMemories);
});
```

---

## 8. Interview Q&A

### 🔹 Basic Questions
#### Q1: What is the primary limitation of relying solely on a short-term message buffer?
Short-term buffer memory keeps raw message logs in active RAM. It is limited by the LLM's context window. As the conversation continues, older messages must be pruned, causing the agent to lose context of earlier topics.

#### Q2: What is the difference between semantic memory and episodic memory in AI agents?
* **Semantic Memory:** Persists general facts, rules, and user preferences (e.g. "User lives in New York").
* **Episodic Memory:** Persists the history of execution paths and actions (e.g., "Step 1: SQL call, Step 2: format JSON").

#### Q3: Why is it bad practice to write every chat message directly to a long-term vector database?
Conversational noise (e.g. "hello", "yes", "thanks") clutter the database. Searching this cluttered index yields low-relevance results, bloating prompt sizes and degrading agent focus.

#### Q4: What does "sliding window memory" do?
Sliding window memory retains only the most recent $N$ messages in the active context, discarding older ones to conserve token limits and maintain latency goals.

#### Q5: What is context window decay?
Context window decay is the performance degradation that occurs when an LLM is flooded with massive amounts of text. The model's attention layers dilute, causing it to ignore instructions located in the middle of the prompt.

---

### 🔸 Intermediate Questions
#### Q6: Explain how asynchronous memory consolidation works and why it is preferred in production.
Instead of forcing the user to wait for memory updates during the active chat session (which adds latency), the session-end triggers a background event. A worker thread parses the chat logs, extracts new preferences, resolves conflicts, and writes updates to the vector database asynchronously, keeping user UI latency low.

#### Q7: How would you resolve conflicts in memory (e.g., database says "User prefers Python", but new chat says "I hate Python, use TypeScript")?
Implement a weight decay or recency-based override:
1. **Timestamping:** Every preference memory is saved with an edit timestamp.
2. **Conflict Evaluation:** When extracting facts, run a conflict-detector prompt: *"Does fact X contradict existing fact Y?"*
3. **Override:** If a contradiction exists, update the record with the newer timestamped fact and mark the older fact as deprecated or delete it.

#### Q8: Describe the "Summarized Memory" algorithm.
1. The message buffer tracks token count.
2. When tokens exceed $80\%$ of limits, slice the first $50\%$ of messages.
3. Prompt an LLM asynchronously to write a running summary of these sliced messages.
4. Prepend this summary (e.g., `Summary: User is debugging a Node app`) to the beginning of the context window, keeping the raw remaining messages in the active buffer.

#### Q9: How can Role-Based Access Control (RBAC) be enforced at the memory retrieval layer?
When storing memories in the vector database, save an Access Control List (ACL) field containing allowed user group IDs (e.g. `allowed_groups: ["Finance-Admins"]`). When querying, pass a metadata filter matching the user's active directory groups, skipping unauthorized memory chunks during HNSW graph traversal.

#### Q10: What is the risk of using high temperatures (e.g., 0.8+) when executing a memory extraction agent?
High temperature increases creativity, which can cause the extraction agent to hallucinate user preferences (e.g. converting a user's joke or hypothetical question into a static factual preference in the database). Extraction agents must run at temperature 0.

---

### ⚡ Advanced Questions
#### Q11: Explain how you would implement a memory consolidation pipeline that handles semantic clustering using HDBSCAN.
* **Mechanism:** Group incoming raw chat snippets.
* **Implementation:** Instead of writing single facts, dump raw conversation logs to cold storage. Every 24 hours, run an offline worker that reads the logs, generates embeddings, and applies HDBSCAN clustering to group similar semantic topics. For each cluster, prompt an LLM to generate a single, consolidated synthesis statement (e.g., *"Summarized topic: User was troubleshooting docker networking errors between 2 PM and 4 PM"*), write that synthesis to long-term memory, and archive the raw logs to save database space.

#### Q12: How do you design an Episodic Memory system that allows an agent to choose the optimal tool sequence based on past runs?
1. **Serialization:** Save completed, successful agent execution logs (User Query, Tool Sequence, Final Answer) inside a vector database.
2. **Query:** When a new query arrives, search the Episodic index using the query embedding.
3. **Few-Shot Injection:** Retrieve the top 2 execution traces and inject them into the system prompt as few-shot examples: *"Here is how you successfully solved a similar task in the past: [Trace 1]..."*. The model reads these steps to replicate the successful execution flow.

#### Q13: What is "Memory Leakage" in multi-tenant environments, and how do you write automated tests to detect it?
* **Concept:** User A's private memories showing up in User B's search queries.
* **Automated Test:** Write a security test script. Ingest a mock private fact for User A (e.g. *"User A's credit card pin is 1234"*). Then, query the database using User B's credentials asking: *"What is my credit card pin?"* Assert that the similarity search returns 0 results and no data matches User A's namespaces.

#### Q14: Explain the difference between Vector DB index searches and Knowledge Graph-based memory retrieval.
* **Vector DB Search:** Finds chunks based on global semantic similarity. It misses logical linkages between entities (e.g., it matches "Alice" and "Google" but doesn't map that Alice reports to Bob at Google).
* **Knowledge Graph Memory:** Stores memory as nodes (Entities) and edges (Relationships, e.g., `Alice --[ReportsTo]--> Bob`). It allows graph queries (e.g. Cypher) to resolve complex relational queries (e.g., "Find all tools used by Alice's manager").

#### Q15: How can semantic drift inside user profiles be measured and corrected?
Semantic drift is the shifting meaning of vector clusters over time as user preferences evolve. Measure it by calculating the centroid distance of a user's memory vectors over time. Correct it by running an LLM-based profile audit node every 30 days: it reads the user's top 100 memory statements, removes duplicate/contradictory facts, clusters similar records, and consolidates them into a clean profile.

---

### 🏛️ System Design Questions
#### Q16: Design a Multi-Session Agent Memory Service that serves 10,000 active users, using Redis for short-term buffers, PostgreSQL (pgvector) for profiles, and RabbitMQ to trigger consolidation.
* **Architecture:**
  * **Short-Term Cache (Redis):** Stores active chat logs as a list data structure keyed by `session_id`. Fast read/writes (sub-1ms).
  * **Event Bus (RabbitMQ):** When a user closes the chat window or remains idle for 15 minutes, publish a `SessionClosedEvent` containing `session_id` and `user_id`.
  * **Consolidation Workers:** Consumers pull events, read the logs from Redis, call an LLM to extract facts, querypgvector for current preferences, merge the data, write updates, and flush the Redis logs to cold storage.
  * **Retrieval Service:** When a new session starts, the orchestrator pulls the latest profile from pgvector and preloads it into the active prompt context.

```
API Request ──► [Redis Cache] (Short-term)
                     │
         (Session Close Event)
                     ▼
             [RabbitMQ Bus] ──► [Consolidation Worker] ──► [pgvector DB] (Long-term)
```

#### Q17: Design an agent memory framework that can dynamically scrub Personally Identifiable Information (PII) before memories are committed to the vector database, complying with GDPR.
* **Architecture:**
  * **Egress Parser Node:** Intercepts the extracted facts from the consolidation step.
  * **PII Detection Engine:** Passes the text through a local Named Entity Recognition (NER) model (e.g. SpaCy) and regex checkers to identify names, credit cards, SSNs, and phone numbers.
  * **Anonymization Handler:**
    * Replaces PII entities with generic tags (e.g., *"My phone number is 555-0199"* becomes *"My phone number is [PHONE_NUMBER]"*).
    * If a memory contains highly sensitive data (like passwords or credit card numbers), the scrubber drops the statement entirely.
  * **Audit Logger:** Writes a hashed record showing *why* a scrub event occurred, ensuring compliance records are maintained.
