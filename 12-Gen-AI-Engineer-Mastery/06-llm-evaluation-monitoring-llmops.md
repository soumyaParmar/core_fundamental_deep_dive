# 🧠 Module 06: LLM Evaluation, Monitoring & LLMOps

---

## 1. Definition
**LLM Evaluation, Monitoring, and LLMOps** is the collection of software engineering frameworks, metrics, and runtime guardrails used to continuously measure the quality of non-deterministic model outputs, audit safety, manage latencies, trace nested executions, and optimize API costs in production.
* **One-line Mental Model:** Traditional DevOps keeps the servers running and code bug-free; LLMOps keeps the non-deterministic AI from hallucinating, leaking private data, or running up a $10,000 API bill overnight.

---

## 2. Drill Down

### A. Evaluation Methodologies: Reference-Based vs. LLM-as-a-Judge
1. **Reference-Based (Traditional NLP):** Metrics like **BLEU** or **ROUGE** measure n-gram overlap between the model's response and a human ground-truth reference. Cheap to compute, but highly rigid; a model can write a perfect, semantically equivalent response using synonyms and get a ROUGE score of 0.
2. **LLM-as-a-Judge (Reference-Free):** Using a highly capable model (like GPT-4) to evaluate outputs based on a detailed rubric (e.g., G-Eval). GPT-4 scores the response on a scale of 1-5 for coherence, relevance, and accuracy. It correlates highly with human judgment but introduces bias (e.g., favoring longer responses).

### B. The RAGAS Evaluation Framework
RAGAS defines specialized metrics to isolate failures in RAG pipelines:
* **Faithfulness (Groundedness):** Measures if the generated response is derived *solely* from the retrieved context. (Prevents hallucinations).
* **Answer Relevance:** Measures if the generated response directly answers the user's question, without fluff.
* **Context Recall:** Measures if the retrieval step fetched *all* the necessary information required to answer the ground-truth question.
* **Context Precision:** Measures if the retrieved context chunks are highly relevant, minimizing noise.

```
       [ Context Recall ]             [ Faithfulness ]
 Ground Truth ────► Retrieved Context ────► Generated Answer
                        ▲                        │
                        └───────── Query ────────┘
                             [ Answer Relevance ]
```

### C. Semantic Caching
Standard HTTP caching (caching by matching identical string keys) is ineffective for search. Users write queries differently (e.g., "how to reset password" vs. "reset my password please").
* **Semantic Caching (e.g., GPTCache):** Generates an embedding vector of the incoming prompt, queries a vector database of past prompts, and returns the cached response if the cosine similarity exceeds a high threshold (e.g., $> 0.96$). This bypasses LLM inference, reducing cost and latency to sub-10ms.

### D. Token Bucket Rate Limiting
API providers charge per token. A malicious user or run-away agent loop can drain limits. Production gateways implement **Token Bucket Rate Limiting** to restrict users based on a maximum budget of Tokens-Per-Minute (TPM) and Requests-Per-Minute (RPM).

### E. Guardrails & Sanitization
* **Input Guardrails:** Scan prompts before hitting the LLM for prompt injection, toxic language, or PII (Personally Identifiable Information) like Social Security numbers.
* **Output Guardrails:** Audit output streams for compliance (e.g., checking if the model outputted code formats correctly, or contains banned words/competitor names).

---

## 3. Why It Exists
Traditional software testing relies on deterministic assertions (e.g., `assert(calculateTotal(10, 5) === 15)`). LLMs do not output deterministic values; the same prompt can generate slightly different text on every run.

Without LLMOps, companies face massive production risks:
1. **Model Drift:** Over time, model behavior changes due to API updates by suppliers (e.g., OpenAI updates a model's backend weights), degrading application accuracy silently.
2. **Exorbitant API Costs:** High-volume user traffic and nested multi-agent loops can lead to unpredictable token consumption.
3. **Regulatory Violations:** Models might leak PII or corporate trade secrets if not explicitly filtered at the egress boundary.

---

## 4. Internal Working
Below is the architectural workflow of a production LLM proxy gateway utilizing semantic caching and evaluation monitoring:

```
[ User Request ] ──► [ Input Guardrails (PII Filter) ] ──► [ Token Bucket Limit Check ]
                                                                   │
    ┌─────────────────────── Cache Hit ◄───────────────────────────┤
    ▼                                                              ▼
[ Return Cached Response ] ◄── [ Semantic Cache (Vector DB) ] ◄── [ Cache Miss ]
                                                                   │
                                                                   ▼
[ Write to Cache ] ◄── [ Output Guardrail / PII Mask ] ◄── [ Core LLM Inference ]
                               │
                               ▼
                    [ Tracing Logger (LangSmith) ] ──► [ RAGAS Eval Scheduler ]
```

---

## 5. Advantages
1. **Massive Cost Reductions:** Semantic caching cuts LLM API costs by up to $40\%$ in high-frequency customer support systems.
2. **Reliable Metrics:** RAGAS allows developers to measure the exact impact of changing chunk sizes or embedding models on accuracy.
3. **Safety Shielding:** Input/output guardrails block corporate brand damage from toxic outputs or jailbreak exploits.

---

## 6. Disadvantages & Pitfalls
1. **Semantic Cache Mismatch:** If the similarity threshold is set too low (e.g., 0.85), the cache might return a response to a query that looks similar but has a different meaning, leading to false information delivery.
2. **High Judge Latency & Cost:** Running evaluation prompts (using GPT-4 to score GPT-3.5 outputs) in real-time is expensive and slow, meaning evaluations must be run asynchronously.
3. **PII Masking False Positives:** RegEx-based PII filters can corrupt normal user requests (e.g. masking product codes that look like credit card patterns).

---

## 7. Production Usage
Here is a complete, production-grade **TypeScript** implementation of an LLM Proxy Gateway that features a **Token-Bucket Rate Limiter** and a **Semantic Cache Engine** utilizing local vector similarity.

```typescript
interface CacheEntry {
  prompt: string;
  embedding: number[];
  response: string;
}

// 1. Semantic Cache Engine
export class SemanticCache {
  private cache: CacheEntry[] = [];
  private similarityThreshold: number;

  constructor(similarityThreshold = 0.95) {
    this.similarityThreshold = similarityThreshold;
  }

  // Simple cosine similarity calculator
  private cosineSimilarity(v1: number[], v2: number[]): number {
    if (v1.length !== v2.length) return 0;
    let dot = 0;
    let norm1 = 0;
    let norm2 = 0;
    for (let i = 0; i < v1.length; i++) {
      dot += v1[i] * v2[i];
      norm1 += v1[i] * v1[i];
      norm2 += v2[i] * v2[i];
    }
    return dot / (Math.sqrt(norm1) * Math.sqrt(norm2) || 1);
  }

  public get(promptEmbedding: number[]): CacheEntry | null {
    let bestMatch: CacheEntry | null = null;
    let maxSim = -1;

    for (const entry of this.cache) {
      const sim = this.cosineSimilarity(promptEmbedding, entry.embedding);
      if (sim > maxSim) {
        maxSim = sim;
        bestMatch = entry;
      }
    }

    if (maxSim >= this.similarityThreshold) {
      console.log(`[Semantic Cache Hit] Similarity: ${maxSim.toFixed(4)}`);
      return bestMatch;
    }

    return null;
  }

  public set(prompt: string, embedding: number[], response: string): void {
    this.cache.push({ prompt, embedding, response });
    console.log(`[Semantic Cache Save] Hashed prompt: "${prompt.substring(0, 30)}..."`);
  }
}

// 2. Token-Bucket Rate Limiter
export class TokenBucketRateLimiter {
  private capacity: number;
  private refillRate: number; // Tokens per millisecond
  private tokens: number;
  private lastRefill: number;

  constructor(tokensPerMinuteLimit: number) {
    this.capacity = tokensPerMinuteLimit;
    this.tokens = tokensPerMinuteLimit;
    this.refillRate = tokensPerMinuteLimit / (60 * 1000); // Translate TPM to ms
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const addedTokens = elapsed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + addedTokens);
    this.lastRefill = now;
  }

  /**
   * Evaluates if the token request falls within the rate limit.
   */
  public consume(tokensRequested: number): boolean {
    this.refill();
    if (this.tokens >= tokensRequested) {
      this.tokens -= tokensRequested;
      return true;
    }
    return false;
  }

  public getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

// Inline demonstration check
const limiter = new TokenBucketRateLimiter(60000); // 60k TPM
console.log("Consume 1000 tokens:", limiter.consume(1000) ? "Allowed" : "Blocked");
console.log("Tokens remaining:", limiter.getAvailableTokens());
```

---

## 8. Interview Q&A

### 🔹 Basic Questions
#### Q1: What is the main difference between BLEU/ROUGE metrics and LLM-as-a-Judge?
BLEU/ROUGE are traditional, deterministic metrics that check for exact n-gram matching against a reference script. LLM-as-a-Judge uses a large language model (like GPT-4) to read the response and score it semantically based on a custom rubric, capturing synonyms and context.

#### Q2: What does "Faithfulness" measure in a RAG evaluation pipeline?
Faithfulness measures the percentage of statements in the generated response that are directly grounded in, and can be verified by, the retrieved context. It identifies if the model introduced hallucinated details not present in the input.

#### Q3: Why is standard Redis string caching insufficient for LLM prompts?
Standard caching requires exact string matches. If a user asks "how do I reset my password?" and another asks "reset my password", standard caching misses. Semantic caching matches on vector similarity of the query intent, allowing hit matches on rephrased inputs.

#### Q4: How does a Token Bucket rate limiter handle sudden spikes in user traffic?
The Token Bucket starts at maximum capacity. A user can consume the entire capacity instantly (handling bursty traffic). Once the bucket is empty, the rate-limiting enforces a steady rate of token consumption matching the refill speed.

#### Q5: What is tracing in LLOps? Name a popular enterprise tracing dashboard.
Tracing records the step-by-step metadata of an agent execution (e.g., prompt inputs, prompt outputs, tool execution latencies, token counts, sub-agent chains) in a visual trace log. Popular tools include LangSmith, Phoenix (Arize), and weights & biases.

---

### 🔸 Intermediate Questions
#### Q6: Explain RAGAS "Answer Relevance" vs "Context Precision".
* **Answer Relevance:** Measures if the generated output addresses the user's original query (looks for fluff or incomplete answers).
* **Context Precision:** Measures if the retrieved document chunks are ordered correctly by relevance, ensuring the most useful context chunks appear at the very top of the prompt window.

#### Q7: Describe a scenario where a Semantic Cache returns a false positive hit, and how to mitigate it.
* **Scenario:** User A asks "Show me the bank statement for account 101." User B asks "Show me the bank statement for account 102." Because the query structures are semantically identical, the vector match similarity is extremely high ($> 0.99$). The cache might hit, showing user A's private balance to user B (data leak).
* **Mitigation:** Strip out identifiers (like account IDs, names, dates) using entity extraction before computing similarity, or append metadata filters to the cache key so matches are only returned for identical user IDs/tenant permissions.

#### Q8: How does the G-Eval framework evaluate model responses?
G-Eval defines evaluation tasks using a system prompt that outlines criteria (e.g., coherence, fluency) and a 1-5 scoring rubric. It instructs the judge model to:
1. Generate a list of evaluation steps.
2. Run the steps on the output text.
3. Calculate probabilities of the output score tokens, computing a weighted average score to prevent integer rounding bias.

#### Q9: What is "Model Drift," and what metrics do you monitor to detect it?
Model drift is the performance degradation of a model over time. Monitor it by tracking:
1. Metric distributions (e.g., tracking average faithfulness scores over time).
2. Prediction distribution shifts (e.g., measuring if the average length of outputs or frequency of safety refusals changes).
3. Feedback loops (user thumbs-down clicks on UI).

#### Q10: How do you design input guardrails that prevent prompt injection without adding massive latency?
Use a tiered safety approach:
1. **Tier 1 (Sub-1ms):** Simple regex and token blocklists for common exploit patterns (e.g., "ignore previous instructions").
2. **Tier 2 (Sub-10ms):** Vector search query matching against a database of known injection prompts (vector cache).
3. **Tier 3 (Sub-50ms):** Run a small, highly specialized classifier model (like LlamaGuard-8B quantized to 4-bit) in parallel with the core LLM prefill processing, aborting execution if the safety check flags a violation.

---

### ⚡ Advanced Questions
#### Q11: Explain how you would implement a distributed Token Bucket rate limiter across a cluster of server nodes.
* **Mechanism:** Use Redis to store bucket tokens.
* **Implementation:** Instead of polling Redis continuously (which creates network bottlenecks), write a Lua script that executes on Redis. The script reads the bucket key, calculates token refill based on current timestamp, updates token counts, and returns a boolean (1 for allowed, 0 for blocked). Lua scripts run atomically in Redis, preventing race conditions among concurrent server nodes.

#### Q12: How do you calculate the RAGAS Faithfulness score programmatically?
1. **Step 1 (Statement Extraction):** Prompt an LLM to read the generated response and extract all individual factual statements (e.g., "Alice is a coder", "She works at Google").
2. **Step 2 (Verification):** For each statement, prompt the LLM to verify if it is supported by the retrieved context chunks (returning Yes/No).
3. **Step 3 (Math):** The score is the ratio of verified statements to total statements:
$$\text{Faithfulness} = \frac{\text{Number of Grounded Statements}}{\text{Total Number of Extracted Statements}}$$

#### Q13: What is "LLM Refusal Bias" in evaluation judges, and how do you correct for it?
Judge models tend to penalize responses that contain safety refusals or dry technical warnings, scoring them low on "user helpfulness" even if the model did the correct thing by refusing a toxic request. Correct this by adding conditional branching to the judge prompt: if the response represents a safety refusal, direct the judge to bypass helpfulness scoring and evaluate it solely on safety alignment compliance.

#### Q14: Explain the difference between active monitoring and passive evaluation in LLM operations.
* **Active Monitoring:** Real-time runtime checks. Includes safety guardrails, PII filters, and rate limiters that can alter or block user request execution in the pipeline.
* **Passive Evaluation:** Offline, asynchronous quality auditing. Includes running evaluation datasets, calculating RAGAS metrics on logged responses, tracking cost/token drift, and generating post-mortem performance charts.

#### Q15: How can you optimize a LLM-as-a-Judge system to minimize self-enhancement bias (where a model rates its own outputs higher than other models)?
1. **Model Blinding:** Strip out model names and header metadata from the evaluation inputs so the judge cannot tell which model generated the text.
2. **Order Randomization:** When comparing two responses side-by-side, randomize their order (Response A vs Response B) because judges have a positional bias, favoring the first option.
3. **Diverse Judges:** Use a panel of different model families (e.g., Claude-3, GPT-4, Gemini-1.5) and average their evaluation scores.

---

### 🏛️ System Design Questions
#### Q16: Design a real-time LLM Egress Guardrail system that streams responses to users but immediately cuts the connection and masks data if the model outputs PII (e.g., credit card numbers).
* **Architecture:**
  * **Stream Parser:** Receives the raw chunk tokens from the LLM endpoint.
  * **Window Buffer:** Maintained by the Proxy. It holds a rolling sliding window of tokens (e.g. 50 characters) to reconstruct partial words.
  * **PII Classifier:** A regex-based processor and a fast, local Named Entity Recognition (NER) model evaluate the buffer stream.
  * **Egress Gateway:** 
    * If the PII filter detects a credit card pattern (e.g., 16 digits), it intercepts the stream, replaces the tokens with `[MASKED_PII]`, and updates the user socket.
    * If a severe injection or safety breach occurs, the proxy terminates the TCP/WebSocket connection immediately.
  * **Audit Log:** Writes the incident metadata to a secure security database.

```
LLM Stream ──► [Rolling Token Buffer] ──► [Fast NER / Regex Check] ──► [Mask / Filter] ──► User Socket
                                                                            │
                                                                            ▼ (Breach)
                                                                    [Close Socket Connection]
```

#### Q17: Design a high-volume LLM Logging and Evaluation Pipeline that processes 10 million generation requests daily without affecting user interface latency.
* **Architecture:**
  * **Log Shipper:** In the user request thread, once the response completes, push the log object (prompt, context, response, tokens, latency) asynchronously to a message broker (Kafka/Kinesis) and exit the thread immediately.
  * **Data Pipeline (Consumer):** Kafka consumers read logs and write them to a Cold Storage lake (S3/GCS) and a search database (Elasticsearch/ClickHouse).
  * **Sampler Worker:** Since evaluating 10M logs daily using GPT-4 is too expensive, a sampling service selects a statistically representative subset (e.g., 1%, or 100,000 logs) focused on low-confidence queries or user thumbs-down alerts.
  * **Asynchronous Evaluator Pool:** Processes the sampled logs using worker queues (Celery/BullMQ), calls evaluation models to compute RAGAS metrics, and writes results to a Grafana/Prometheus dashboard for monitoring.
