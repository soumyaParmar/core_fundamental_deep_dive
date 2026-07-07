# 🧠 Module 03: Retrieval-Augmented Generation (RAG) & Vector Databases

---

## 1. Definition
**Retrieval-Augmented Generation (RAG)** is an architectural pattern that enhances the factual accuracy of Large Language Models by querying external, authoritative knowledge bases to retrieve relevant document passages and injecting them into the LLM's context window alongside the user prompt.
* **One-line Mental Model:** Instead of forcing the LLM to write an exam purely from memory (parametric knowledge), RAG turns it into an open-book exam, passing the exact reference chapters (retrieved chunks) to read before writing its answers.

---

## 2. Drill Down

### A. Document Chunking Strategies
To fit documents into model context windows and locate precise information, files must be split:
1. **Fixed-Size Chunking:** Splitting text by a fixed character or token count with an overlap (e.g., 500 characters with a 50-character overlap). Simple but frequently splits sentences in half, breaking semantic context.
2. **Recursive Character Splitting:** Splits by a list of separators hierarchically (e.g., `["\n\n", "\n", " ", ""]`), trying to keep paragraphs, sentences, and words intact.
3. **Semantic Chunking:** Computes embeddings for individual sentences, calculates the cosine distance between adjacent sentences, and splits where semantic distance exceeds a threshold (indicating a topic shift).
4. **Parent-Child (Hierarchical) Chunking:** Splitting documents into large parent chunks (e.g., 1500 tokens for context) containing smaller child chunks (e.g., 100 tokens for vector search). Vector similarity searches match against the children, but retrieve and feed the larger parent chunk to the LLM.

### B. Vector Spaces & Distance Metrics
Text chunks are passed to an Embedding Model to generate high-dimensional vectors (e.g., 1536 dimensions for OpenAI's `text-embedding-3-small`). The similarity between chunks is computed in vector space:
* **Cosine Similarity:** Measures the cosine of the angle between two vectors. Focuses on direction rather than magnitude:
$$\text{Similarity}(A, B) = \frac{A \cdot B}{\|A\| \|B\|}$$
* **L2 Euclidean Distance:** Measures the straight-line distance between vector endpoints. Sensitive to document length/magnitude.
* **Inner Product (Dot Product):** Fast to calculate; if vectors are normalized to unit length, Dot Product is mathematically equivalent to Cosine Similarity.

### C. Vector Database Indexing
Searching millions of vectors sequentially ($O(N)$ flat scan) is too slow for production. Databases build specialized index structures:
* **IVF-FLAT (Inverted File Index):** Clusters the vector space using K-Means. During query, it identifies the nearest cluster centroids and only searches vectors within those clusters. Reduces search space but can miss the absolute nearest neighbors (ANN).
* **HNSW (Hierarchical Navigable Small World):** A multi-layer graph-based index. The top layers have sparse connections (for fast routing across the graph), while bottom layers have dense connections (for precise local searches). HNSW provides high search speed and accuracy at the cost of high RAM usage.

### D. Retrieval Enhancement
* **Query Translation / Expansion:** Rewriting the user query into multiple variations, or generating a hypothetical response (HyDE - Hypothetical Document Embeddings), and embedding those variations to retrieve a broader, more accurate set of documents.
* **Cross-Encoder Re-ranking:** Bi-Encoder models encode queries and documents independently to perform fast vector searches. Re-rankers (Cross-Encoders) take the query and a retrieved document *together* and pass them through a transformer block, outputting a highly accurate similarity score. Re-ranking is applied to the top 20-50 retrieved documents to filter out noise.
* **Hybrid Search:** Combining lexical search (BM25 - keyword matching) and dense vector search (semantic similarity) using algorithms like **Reciprocal Rank Fusion (RRF)** to combine their scoring.

---

## 3. Why It Exists
LLMs suffer from several core production limitations:
1. **Knowledge Cut-off:** Model parameters are frozen during training. They do not know about events that happened after their training cutoff.
2. **Hallucinations:** When asked about topics outside their training data or private records, models generate plausible-sounding but completely fabricated facts.
3. **Data Leakage & Access Control:** Fine-tuning a model on private data mixes all information into the model's weights. It is impossible to enforce access control (e.g., preventing a regular employee from seeing executive payroll data via prompt queries).

RAG resolves these issues. Knowledge is decoupled from parameters. Access controls can be applied directly at the database query layer (only retrieving files the user is authorized to see), and sources can be explicitly cited, allowing for verification.

---

## 4. Internal Working
Below is the data ingestion and retrieval flow of a production RAG system:

```
=== INGESTION PIPELINE ===
[ Raw Documents (PDFs, Wikis) ] ──► [ Text Extraction ] ──► [ Recursive Separator Chunking ]
                                                                       │
[ Vector Store (HNSW Index) ] ◄── [ Vector Embeddings ] ◄── [ Embedding Model ]

=== RETRIEVAL & GENERATION PIPELINE ===
[ User Query ] ────► [ Embedding Model ] ────► [ Dense Vector Search ]
      │                                                │
      │ (Keyword Search)                               ▼
      └────────────► [ Lexical BM25 Search ] ───► [ Reciprocal Rank Fusion (RRF) ]
                                                       │
                                                       ▼
[ Output Response ] ◄── [ LLM Generator ] ◄── [ Prompt Template + Top Chunks ]
```

---

## 5. Advantages
1. **Real-time Accuracy:** Immediate updates by adding/removing files in the Vector DB without retraining.
2. **Zero Leakage Security:** Role-based access control (RBAC) filtering at the retrieval query step.
3. **Auditability:** Responses contain hyperlinks/citations back to the source chunks.

---

## 6. Disadvantages & Pitfalls
1. **Lost in the Middle:** If too many chunks are injected (e.g., 20 chunks), LLMs struggle to process information situated in the middle of the context block, favoring the beginning and end.
2. **Semantic Mismatch:** Searching for "how to fix a flat tire" might retrieve a story about "a flat plane tire" because the semantic vector space matches "flat" and "tire" even if the context is wrong.
3. **Chunk Boundary Truncation:** Important facts can be cut in half across two different chunks, rendering both semi-useless.

---

## 7. Production Usage
Here is a complete, dependency-free **TypeScript** implementation of a Document Chunking utility, a Vector Search similarity ranker, and a **Reciprocal Rank Fusion (RRF)** merger.

```typescript
// Define standard type structures
interface DocumentChunk {
  id: string;
  text: string;
  metadata: Record<string, any>;
  embedding?: number[];
}

export class RagEngine {
  // Compute cosine similarity between two high-dimensional vectors
  static cosineSimilarity(v1: number[], v2: number[]): number {
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

  /**
   * Recursive Character Chunking Utility.
   * Splits text on paragraph, line, and space boundaries to fit under maxChunkSize.
   */
  public chunkText(
    text: string, 
    maxChunkSize: number, 
    overlap: number, 
    metadata: Record<string, any> = {}
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const separators = ["\n\n", "\n", " ", ""];
    let chunkCounter = 0;

    const splitRecursive = (currentText: string, separatorIdx: number): string[] => {
      if (currentText.length <= maxChunkSize) {
        return [currentText];
      }
      if (separatorIdx >= separators.length) {
        // Fallback: hard slice
        const slices: string[] = [];
        for (let i = 0; i < currentText.length; i += maxChunkSize - overlap) {
          slices.push(currentText.substring(i, i + maxChunkSize));
        }
        return slices;
      }

      const sep = separators[separatorIdx];
      const parts = currentText.split(sep);
      const output: string[] = [];
      let buffer = "";

      for (const part of parts) {
        if ((buffer + sep + part).length <= maxChunkSize) {
          buffer = buffer ? buffer + sep + part : part;
        } else {
          if (buffer) output.push(buffer);
          // Recursively handle part if it exceeds limits
          if (part.length > maxChunkSize) {
            output.push(...splitRecursive(part, separatorIdx + 1));
          } else {
            buffer = part;
          }
        }
      }
      if (buffer) output.push(buffer);
      return output;
    };

    const rawChunks = splitRecursive(text, 0);

    // Apply overlap consolidation
    for (let i = 0; i < rawChunks.length; i++) {
      let chunkText = rawChunks[i];
      if (i > 0 && overlap > 0) {
        const prevChunk = rawChunks[i - 1];
        const overlapText = prevChunk.slice(-overlap);
        chunkText = overlapText + chunkText;
      }
      chunks.push({
        id: `chunk-${chunkCounter++}`,
        text: chunkText,
        metadata: { ...metadata, index: i }
      });
    }

    return chunks;
  }

  /**
   * Reciprocal Rank Fusion (RRF) Algorithm.
   * Combines lexical rank results and vector rank results.
   * @param k Smoothing constant (typically 60)
   */
  public reciprocalRankFusion(
    vectorResults: DocumentChunk[],
    lexicalResults: DocumentChunk[],
    k = 60
  ): { chunk: DocumentChunk; score: number }[] {
    const scores: Map<string, { chunk: DocumentChunk; score: number }> = new Map();

    const applyRRF = (results: DocumentChunk[]) => {
      results.forEach((chunk, index) => {
        const rank = index + 1;
        const current = scores.get(chunk.id) || { chunk, score: 0 };
        current.score += 1 / (rank + k);
        scores.set(chunk.id, current);
      });
    };

    applyRRF(vectorResults);
    applyRRF(lexicalResults);

    // Sort descending by score
    return Array.from(scores.values()).sort((a, b) => b.score - a.score);
  }
}

// Inline demonstration
const engine = new RagEngine();
const doc = "First paragraph about database architecture. It covers replication models.\n\nSecond paragraph discusses API security filters and TLS handshakes.";
const chunks = engine.chunkText(doc, 50, 10);
console.log("Generated Chunks count:", chunks.length);
console.log("Chunk 0:", chunks[0].text);
```

---

## 8. Interview Q&A

### 🔹 Basic Questions
#### Q1: What does RAG solve that fine-tuning alone cannot?
Fine-tuning updates a model's parameterized weights, which is computationally expensive, cannot be easily revoked, and does not support real-time data updates. RAG injects dynamic, current data at the query step, allows immediate updates, and supports access-control filtering.

#### Q2: What is document overlap in chunking, and why is it important?
Overlap is a buffer region of characters/tokens appended from the end of the previous chunk to the start of the next chunk. It ensures that semantic details or sentences situated on chunk boundaries are not bisected, preserving contextual flow.

#### Q3: What is the difference between Cosine Similarity and Dot Product?
Cosine Similarity measures the cosine of the angle between two vectors, ignoring their scale/magnitude. Dot Product calculates the algebraic sum of the products of their components. If the vectors are normalized to unit length, Dot Product is equivalent to Cosine Similarity.

#### Q4: Why are chunk sizes of 1000+ tokens sometimes problematic for RAG?
Large chunk sizes increase the likelihood of introducing irrelevant noise into the prompt. They also eat into the model's generation token budget and can trigger the "lost-in-the-middle" effect, reducing retrieval precision.

#### Q5: What is a Vector Database? Name three popular ones used in industry.
A Vector Database is a storage engine optimized to store, index, and query high-dimensional vector representations of unstructured data. Examples include Pinecone, Milvus, Qdrant, Chroma, and pgvector (PostgreSQL extension).

---

### 🔸 Intermediate Questions
#### Q6: Explain Parent-Child chunking and how it improves retrieval accuracy.
Parent-Child chunking splits a document into large parent chunks (e.g., paragraphs/sections) and small child chunks (e.g., individual sentences). Vector search index stores the embeddings of the child chunks (offering higher specificity for search matches), but the retrieval engine retrieves and sends the corresponding larger parent chunk to the LLM, preserving surrounding context.

#### Q7: How does pgvector's HNSW index optimize vector search in PostgreSQL?
HNSW maps high-dimensional vectors into a multi-layered graph. Top layers contain sparse nodes allowing long-distance jumps across the dataset. Lower layers contain denser clusters for narrow local searches. It enables sub-linear lookup times, resolving queries in milliseconds instead of scanning every table row sequentially.

#### Q8: What is BM25, and how does Hybrid Search combine it with vector embeddings?
BM25 is a term frequency-inverse document frequency (TF-IDF) based keyword matching algorithm. Hybrid search runs both BM25 (excellent for exact matches like product IDs, names, or error codes) and Vector search (excellent for semantic intent) in parallel, and merges their outputs using Reciprocal Rank Fusion (RRF) to produce a combined relevance score.

#### Q9: How does the Hypothetical Document Embeddings (HyDE) technique work?
HyDE takes the user's query and instructs an LLM to write a hypothetical response (which may contain fabricated facts). The system then embeds this hypothetical response and uses that embedding to search the vector database. Because the hypothetical response shares the same structural syntax as the documents, it retrieves highly relevant target chunks compared to embedding a brief question query.

#### Q10: What is the "Lost-in-the-Middle" phenomenon, and how do you mitigate it?
Lost-in-the-Middle describes an LLM's tendency to pay attention to information at the very beginning and very end of its context window, ignoring details located in the center. Mitigation includes:
1. Limiting retrieved context chunks (e.g. top 5 instead of top 20).
2. Sorting retrieved chunks by relevance so the most critical passages are pushed to the absolute top of the prompt context.
3. Using re-rankers to discard noise.

---

### ⚡ Advanced Questions
#### Q11: Explain how you would implement dynamic metadata filtering in a vector database query.
* **Mechanism:** When a query arrives with a metadata filter (e.g., `department = 'Sales'`), the engine can use two methods:
  1. **Pre-filtering:** Filters the dataset to 'Sales' first, then builds/scans vector indices. This can cause graph disconnection in HNSW indexes.
  2. **Post-filtering:** Performs vector search to get the top 1000 items, then filters out non-'Sales' rows. This is slow if 'Sales' represents a tiny subset.
  3. **Single-stage filtering (Best):** Integrates the metadata condition into the HNSW graph traversal loop, skipping nodes that don't match the condition during the search walk.

#### Q12: How does Reciprocal Rank Fusion (RRF) calculate ranks mathematically, and why is the constant $k$ needed?
RRF calculates a document's fused score $RRF(d)$ across multiple rankers (e.g., Vector and BM25):
$$RRF(d \in D) = \sum_{m \in M} \frac{1}{r_m(d) + k}$$
Where $r_m(d)$ is the rank of document $d$ in ranker $m$, and $k$ is a constant (typically 60). The constant $k$ is a smoothing factor that prevents highly ranked items from one ranker from completely dominating items with consistent, medium-high ranks across all rankers.

#### Q13: What is the primary difference between Bi-Encoders and Cross-Encoders in terms of latency, complexity, and accuracy?
* **Bi-Encoders:** Encode query and document separately into vectors, then compute cosine similarity ($Q \cdot D$). Extremely fast ($O(1)$ during retrieval using pre-computed database indexes), but cannot model cross-attention interactions between query words and document words.
* **Cross-Encoders:** Feed query and document together into the self-attention layers of a single transformer. Extremely accurate (models fine-grained cross-token interactions), but computationally heavy and slow, making them unsuitable for initial search scans. They are used solely to re-rank the top candidates.

#### Q14: How does a Semantic Chunking algorithm decide where to insert a split point?
Semantic chunking splits the document into sentences. It computes vector embeddings for each sentence and calculates the cosine distance between adjacent sentences ($S_i$ and $S_{i+1}$). It calculates a rolling difference (e.g., 3-sentence window). When the distance between sentence $i$ and $i+1$ exceeds a specific percentile (e.g., the 95th percentile of all distance measurements in that document), it triggers a chunk split at that index.

#### Q15: How would you scale a pgvector database to support 100 million vector records while maintaining sub-100ms query times?
* **Techniques:**
  1. **Partitioning:** Partition tables by date or customer tenant ID, allowing pgvector to restrict graph traversals to specific partitions.
  2. **Quantization:** Build IVF indices using spherical vector quantization or lower precision types (e.g., half-precision float16 or binary vector quantization) to reduce RAM storage size.
  3. **RAM Sizing:** Ensure the HNSW index fits entirely in PostgreSQL's shared buffers (shared memory RAM). Disk-spilled index lookups degrade performance.
  4. **Replica Routing:** Separate write operations from read queries, routing vector search queries to read replicas.

---

### 🏛️ System Design Questions
#### Q16: Design a real-time Document Ingestion Pipeline for an enterprise knowledge base (e.g., Confluence, Google Drive) that updates its vector index within 10 seconds of a document modification.
* **Pipeline Components:**
  * **Event Connector:** Registers webhooks with Confluence/Google Drive to listen for file updates.
  * **Ingestion Queue:** Pushes event metadata (file ID, revision) to a message queue (Kafka/RabbitMQ).
  * **Worker Service:** Fetches the file, parses content, and retrieves its previous chunk IDs from a relational database.
  * **Diff Engine:** Compares the new file content with old content. Only processes modified sections (saves compute).
  * **Embeddings Service:** Batches new chunks and calls the Embedding model.
  * **Vector DB Update:** Overwrites updated vectors using `upsert` calls and deletes outdated chunk vectors.
  * **Relational Sync:** Updates the chunk metadata table mapping `DocumentID` to `VectorIDs`.

```
Confluence Webhook ──► [Kafka Queue] ──► [Worker Service] ──► [Embedding Service]
                                                │                     │
                                                ▼                     ▼
                                         [PostgreSQL Db]       [Vector DB Upsert]
```

#### Q17: Design a multi-tenant RAG platform where tenant data must be isolated, and users can only query chunks they have "read permission" to view, based on an external Active Directory (AD).
* **Architecture:**
  * **Metadata Embedding:** When indexing chunks, insert metadata tags for `TenantID` and an access control list: `allowed_groups: ["Engineering-Group", "Domain-Admins"]`.
  * **Query Flow:**
    1. User submits query with an OAuth2 JWT token.
    2. API Gateway validates the token and queries Active Directory to fetch the user's groups: `["Engineering-Group"]`.
    3. The search client executes the vector query, passing metadata filter rules to pgvector/Pinecone:
       `tenant_id == 'tenant_123' AND allowed_groups INTERSECT ['Engineering-Group']`.
    4. The vector database performs single-stage graph traversal, filtering out nodes that don't match the access control list during HNSW traversal.
  * **Verification:** This setup prevents data leakage across tenants and ensures a user never sees chunks from files they are restricted from reading.
