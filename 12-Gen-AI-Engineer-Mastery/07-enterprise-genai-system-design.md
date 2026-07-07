# 🧠 Module 07: Enterprise Generative AI System Design

---

## 1. Definition
**Enterprise Generative AI System Design** is the engineering practice of architecting scalable, resilient, and secure distributed software systems that integrate Large Language Models, streaming gateways, vector databases, search layers, transactional caches, and guardrails to support millions of concurrent enterprise requests.
* **One-line Mental Model:** Moving Gen AI from a local Jupyter notebook script into a hardened, high-availability, multi-tenant enterprise backend that can handle millions of real-time streaming queries safely.

---

## 2. Drill Down

### A. Real-time Streaming Architectures: SSE vs. WebSockets
LLMs generate tokens sequentially, taking $2-10$ seconds to finish a response. Users expect to see characters stream in real-time rather than waiting for completion:
* **Server-Sent Events (SSE):** A unidirectional, text-based protocol built on standard HTTP (`Content-Type: text/event-stream`). Lightweight, automatically handled by standard web browsers, and supports automatic reconnection. This is the industry standard for LLM streaming.
* **WebSockets:** A bidirectional, full-duplex TCP protocol. It has higher overhead and requires managing custom connection states on servers. WebSockets are only used if the client needs to stream heavy audio/video inputs back to the server in real-time.

### B. Natural Language to SQL (SQL Agents)
Allowing an LLM to write database queries dynamically is powerful but dangerous. Production SQL agents follow a strict design:
1. **Schema Fetching:** The agent is only shown a sanitized DDL containing table names, column names, types, and primary/foreign keys (no actual database rows).
2. **SQL Generation:** The LLM generates the SQL statement.
3. **Execution Guardrails:** The query is routed to a specialized **read-only database connection** (replica) with strict transaction timeouts (e.g., 2 seconds) and row limits (e.g., max 100 rows) to prevent table locking or denial of service (`SELECT * FROM logs`).
4. **Self-Healing Loop:** If the SQL execution returns a syntax error, the agent intercepts the error message, prompts the LLM with the failing SQL + the error message, and instructs it to output a corrected query.

### C. Enterprise RAG Platform Architecture
At scale, RAG systems transition from simple Python libraries to distributed microservices:
* **Ingestion Layer:** Reads from data lakes, schedules cron jobs, and pushes changes through a Message Queue (Kafka) to coordinate parallel chunking and embedding workers.
* **Query Layer:** Uses an API Gateway to handle authentication, enforce Tenant Permission boundaries (RBAC filters), check the Semantic Cache, and route queries to the Vector DB.
* **Generation Layer:** Connects to LLM model server pools (e.g., vLLM cluster) using load balancing, stream-parsing, and guardrail validation.

---

## 3. Why It Exists
Moving a prototype LLM application to production reveals major engineering challenges:
1. **The Latency Problem:** Waiting for an LLM to generate 500 tokens before displaying output causes high user churn. Token-by-token streaming is required.
2. **Security Vulnerabilities:** Direct database agents can execute malicious queries (SQL injection) or drop tables if not constrained by sandbox runtimes and read-only database connections.
3. **Network Exhaustion:** LLM streams keep HTTP connections open for long periods. Standard synchronous web servers exhaust their socket/thread pools quickly under load. Async, non-blocking I/O (like Node.js) and HTTP/2 multiplexing are required.

---

## 4. Internal Working
Below is the distributed system architecture of a multi-tenant Enterprise RAG Platform:

```
[ Frontend Client ]
       │ ▲ (HTTP/2 SSE Stream)
       ▼ │
[ API Gateway / OAuth2 ] ──► [ Semantic Cache (Redis) ] ──► (Cache Hit: Return Stream)
       │ (Cache Miss)
       ▼
[ Orchestration Service (Node.js) ]
       ├─── Query Vector ───► [ Vector DB (pgvector cluster with HNSW) ]
       │                                │
       │ (Read Context)                 ▼ (Role-Based Metadata Filter)
       ▼
[ Egress Guardrails ] ◄── [ LLM Serving Cluster (vLLM) ]
```

---

## 5. Advantages
1. **Real-time UX:** SSE provides immediate feedback, keeping the perceived latency under 100ms.
2. **Resource Efficiency:** Asynchronous event-driven runtimes allow thousands of open connections on a single server.
3. **Robust Security:** Constrained agent runtimes prevent database corruption and data leakage.

---

## 6. Disadvantages & Pitfalls
1. **Idle Connection Limits:** Cloud load balancers (e.g., AWS ALB) often terminate HTTP connections that are idle for more than 30-60 seconds. The server must write "heartbeat" keep-alive events to prevent timeouts during long reasoning steps.
2. **SQL Agent Hallucinations:** The model can easily mistake column meanings (e.g., querying `sales` instead of `revenue_usd`), generating correct SQL syntax that yields incorrect business data.
3. **Resource Leakage:** Unclosed stream connections can lead to memory leaks on the backend orchestrator if listener events are not cleaned up during socket drops.

---

## 7. Production Usage
Here is a complete, production-grade **TypeScript** implementation of a Server-Sent Events (SSE) Streaming API Router using Node.js HTTP. It demonstrates header configuration, heartbeat intervals, stream chunking, and graceful connection cleanup.

```typescript
import * as http from "http";

export class StreamingServer {
  private server: http.Server;
  private port: number;

  constructor(port = 8080) {
    this.port = port;
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // 1. Configure CORS & SSE Headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept"
    });

    console.log(`[SSE Connection Open] Client connected. URL: ${req.url}`);

    // 2. Setup Heartbeat Keep-Alive Interval (Every 15 seconds)
    // Prevents load balancers from cutting the connection during slow generation.
    const heartbeatInterval = setInterval(() => {
      res.write(":\n\n"); // SSE comment format acts as keep-alive
    }, 15000);

    // 3. Simulate sequential next-token generation
    const mockTokens = "Large language models generate text token-by-token. Streaming over Server-Sent Events (SSE) ensures a responsive user experience.".split(" ");
    let index = 0;

    const streamInterval = setInterval(() => {
      if (index < mockTokens.length) {
        const dataPayload = JSON.stringify({ token: mockTokens[index] + " " });
        
        // Write standard SSE formatting: 'data: {payload}\n\n'
        res.write(`data: ${dataPayload}\n\n`);
        index++;
      } else {
        // Stream completed
        res.write("data: [DONE]\n\n");
        cleanup();
      }
    }, 100); // 100ms per word

    // Cleanup resources
    const cleanup = () => {
      clearInterval(streamInterval);
      clearInterval(heartbeatInterval);
      res.end();
      console.log("[SSE Connection Closed] Cleaned up timers.");
    };

    // 4. Handle client-side connection aborts (e.g. user closes browser tab)
    req.on("close", () => {
      console.log("[SSE Connection Lost] Client disconnected prematurely.");
      cleanup();
    });
  }

  public start(): void {
    this.server.listen(this.port, () => {
      console.log(`[Streaming Server] Running at http://localhost:${this.port}`);
    });
  }

  public stop(): void {
    this.server.close();
  }
}

// To run this server in standard Node.js:
// const app = new StreamingServer(8080);
// app.start();
```

---

## 8. Interview Q&A

### 🔹 Basic Questions
#### Q1: What is the main difference between Server-Sent Events (SSE) and WebSockets?
SSE is a unidirectional protocol over standard HTTP, allowing the server to push text streams to the client. WebSockets is a bidirectional, full-duplex TCP-based protocol, which is more complex and has higher connection overhead.

#### Q2: Why is "keep-alive" configuration crucial for streaming routes in cloud environments?
Cloud load balancers and proxies (like AWS ALB or Cloudflare) terminate connections that stay idle without transmitting bytes for more than 30-60 seconds. A keep-alive interval writes dummy data (like an SSE comment `:\n\n`) to keep the connection active during slow reasoning steps.

#### Q3: What table details should you expose to a SQL Write agent prompt?
Expose only sanitized schema definitions (DDL: table names, column names, column types, primary keys, and foreign keys). Never expose actual customer table rows or database logs to the model.

#### Q4: Why is it important to use a read-only database connection replica for SQL Agents?
A SQL agent can generate harmful statements (like `DELETE`, `DROP TABLE`, or updates). Using a read-only connection limits execution privileges strictly to `SELECT` queries, securing database state.

#### Q5: What is Server-Sent Events (SSE) format standard block?
The standard block consists of text-lines starting with a field name, followed by a colon and the payload, terminated by two newlines:
`data: { "token": "hello" }\n\n`

---

### 🔸 Intermediate Questions
#### Q6: How does a SQL Agent implementation handle syntax errors dynamically?
The execution wrapper catches database driver exceptions. Instead of returning an error to the user, the orchestrator appends the failing SQL query and the error log into the model's history, prompting the LLM: *"The previous query failed with error: {errorMsg}. Analyze the schema and rewrite the query."* The loop repeats until the query executes successfully or hits the iteration limit.

#### Q7: Describe how to manage connection state limits in an Express/Node.js streaming backend.
Standard synchronous threads exhaust memory quickly under persistent streaming connections. To scale:
1. Use an asynchronous, event-loop driven architecture (Node.js/Go) that handles I/O non-blockingly.
2. Configure keep-alive timeout settings at the server level.
3. Listen for client connection `close` events to immediately clear intervals and release memory buffers, avoiding leaks.
4. Scale out behind load balancers with sticky sessions or Redis socket adapters if using WebSockets.

#### Q8: What is Change Data Capture (CDC), and how is it used in enterprise RAG pipelines?
CDC monitors database logs (e.g. PostgreSQL Write-Ahead Log - WAL) to identify additions, updates, or deletions of rows. A CDC tool (like Debezium) captures these events and writes them to a Kafka queue. Consumers read the events, chunk the updated records, call embeddings, and update the Vector Database in real-time, keeping the RAG index synchronized with relational databases.

#### Q9: What is the purpose of HTTP/2 multiplexing in LLM streaming backends?
HTTP/1.1 limits the number of concurrent open connections between a browser and a server (typically max 6). If a user opens multiple tabs streaming LLM responses, the browser runs out of sockets (head-of-line blocking). HTTP/2 multiplexes multiple streams over a single TCP connection, allowing users to run dozens of concurrent token streams without blocking.

#### Q10: How do you implement database transaction timeouts for SQL agents, and why are they necessary?
* **Implementation:** Append transaction limits to the SQL connection configuration (e.g., setting `statement_timeout = 2000` in PostgreSQL).
* **Necessity:** Prevent the LLM from writing inefficient queries (e.g., cross-joins on unindexed tables containing millions of rows) that consume CPU resources and lock database tables.

---

### ⚡ Advanced Questions
#### Q11: Explain how you would design a multi-tenant vector database system that guarantees strict data isolation at the page level.
* **Architecture:**
  1. **Namespace isolation (Standard):** Vector databases like Pinecone support namespaces. Route queries strictly to the tenant's namespace.
  2. **Metadata filtering (Alternative):** In pgvector, add a `tenant_id` column. Create a partial index:
     `CREATE INDEX ON items USING hnsw (embedding vector_cosine_ops) WHERE (tenant_id = 'tenant_123')`.
     During query, force the tenant ID constraint inside the WHERE clause. This ensures pgvector only traverses index graphs belonging to that tenant.

#### Q12: How do you design an LLM streaming pipeline that handles mid-stream token failure gracefully?
* **Strategy:** Maintain a robust state parser.
* **Implementation:** The orchestrator reads the LLM chunk stream. If the LLM throws an API error mid-generation:
  1. Catch the exception.
  2. Send a custom SSE error event block to the client: `event: error\ndata: { "message": "Inference interrupted." }\n\n`.
  3. Close the stream cleanly.
  4. The client UI reads the `event: error` listener, displays a user-friendly message, and prevents JSON parsing errors on partial blocks.

#### Q13: Explain the role of Reciprocal Rank Fusion (RRF) in merging lexical and semantic search results at scale.
RRF is a score-aggregation technique. Since keyword match models (BM25) and vector embedding similarity models return scores on different scales (e.g., BM25 yields positive floats, Cosine similarity yields values between -1 and 1), they cannot be added directly. RRF bypasses score magnitudes and only looks at relative *rankings* (positions) in the output lists. It computes a fused score for each document based on its reciprocal rank across both search results, ensuring balanced relevance.

#### Q14: How does a SQL Agent protect against indirect SQL Injection attacks?
* **Vulnerability:** A user inputs: *"Show me the profile of user USR-101; DROP TABLE users;"*. The model might generate a SQL statement containing the drop command.
* **Mitigation:**
  1. Parse the generated SQL using a AST (Abstract Syntax Tree) SQL parser before execution.
  2. Verify that the query contains *only* a single `SelectStatement` node.
  3. If any mutative nodes (`UpdateStatement`, `DeleteStatement`, `DropTableStatement`) are detected, abort execution instantly.
  4. Ensure the database user account only has `SELECT` privileges.

#### Q15: How would you architect a caching layer for a Multi-Agent system that executes multi-step workflows over several minutes?
* **Architecture:**
  1. **State Persistence:** Store the agent's execution graph state in a distributed cache (like Redis) after every node transition, using the session ID as key.
  2. **Pause and Resume:** If a node requires external inputs or takes long to run, save the state to Redis with status `PAUSED` and release worker memory.
  3. **Event Activation:** When the input arrives, publish a message to a queue (Celery/BullMQ), which wakes up a worker, reloads the state from Redis, and resumes graph execution from the paused node.

---

### 🏛️ System Design Questions
#### Q16: Design a Self-Healing Natural Language to SQL Database Agent, illustrating the execution, validation, and error correction loops.
* **System Workflow:**
  1. User inputs query: *"Get total orders for Sales department last week."*
  2. **Metadata Fetcher:** Queries local cache for schemas of `orders` and `departments` tables.
  3. **SQL Generator LLM:** Receives the user query + schema DDL, and writes the query.
  4. **SQL Parser Guardrail:** Audits AST. Confirms it is a read-only query.
  5. **Query Executor:** Executes query on read-only replica.
     * **Success Path:** Formats data as JSON and returns it to the user.
     * **Failure Path:** Captures database engine syntax exception (e.g. `column "department_name" does not exist`).
  6. **Self-Healing Loop:** Routes query + error back to the generator LLM. If revision count $< 3$, regenerate and retry.

```
User Query ──► [SQL Gen LLM] ──► [AST Parser Guard] ──► [Read-Only replica]
                      ▲                                           │
                      │ (Regenerate with error logs)              ├─── Success ──► Return JSON
                      └────────────────── Failure ────────────────┘
```

#### Q17: Design an Enterprise RAG Ingestion pipeline that processes millions of multi-format documents (PDFs, PPTs, Word, Markdown) from SharePoint and Google Drive, handles OCR, and builds/updates vector indices, ensuring sub-10s search updates.
* **Pipeline Components:**
  * **File Connectors:** Sync services pull modified files from Google Drive and SharePoint using change feeds.
  * **Ingestion Queue:** Pushes file pointers and tenant keys to Kafka topics.
  * **Parser Workers (Microservices):**
    * Read file types. Apply Apache Tika for Word/PPT, and OCR engines (like Tesseract) for scanned PDFs.
    * Output clean text strings.
  * **Dynamic Chunking:** Applies semantic chunking or parent-child chunking.
  * **Embedding Cluster:** Batches chunks, routes them to a cluster of local embedding models (e.g. HuggingFace TEI - Text Embeddings Inference) to generate vectors.
  * **Vector DB Sync:** Upserts vectors to the corresponding Tenant index in pgvector/Qdrant.
  * **Control Database:** Keeps database records of file versions, chunk splits, and vector IDs to clean up orphaned vectors when files are deleted.
