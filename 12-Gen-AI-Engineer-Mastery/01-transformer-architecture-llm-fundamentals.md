# 🧠 Module 01: Transformer Architecture & LLM Core Foundations

---

## 1. Definition
The **Transformer** is a deep learning architecture that processes sequential data by utilizing **self-attention mechanisms** to calculate dynamic, token-to-token weightings in parallel, bypassing the sequential constraints of recurrence.
* **One-line Mental Model:** Instead of reading text word-by-word like a conveyor belt (RNNs), a Transformer stands above the entire paragraph, instantly mapping how every word relates to every other word using a dynamic, relevance-based indexing matrix.

---

## 2. Drill Down
The power of the Transformer lies in its mathematical abstractions and structural layers:

### A. Scaled Dot-Product Attention
The core calculation maps a set of Query ($Q$), Key ($K$), and Value ($V$) vectors:
$$\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V$$
* **$Q$ (Query):** Represents "what I am looking for" (current token).
* **$K$ (Key):** Represents "what information I contain" (all tokens).
* **$V$ (Value):** Represents "the actual content I want to propagate" (all tokens).
* **$\sqrt{d_k}$ Scaling Factor:** Prevents the dot products from growing excessively large in high dimensions, which would push the softmax function into regions with extremely small gradients (vanishing gradients during backpropagation).

### B. Multi-Head (MHA) vs. Multi-Query (MQA) vs. Grouped-Query Attention (GQA)
Modern LLMs optimize the attention mechanism to balance computation and memory:
1. **Multi-Head Attention (MHA):** Every Query, Key, and Value head has unique weights. Highly expressive but has a massive memory footprint for the KV cache.
2. **Multi-Query Attention (MQA):** Multiple Query heads share a single Key and Value head. Reduces KV cache size drastically but slightly degrades representation quality.
3. **Grouped-Query Attention (GQA):** A hybrid approach where Query heads are grouped, and each group shares a Key/Value head (e.g., LLaMA-3 uses GQA). It recovers most of MHA's capacity while keeping KV cache scaling low.

```
MHA (8 Q, 8 K, 8 V)        MQA (8 Q, 1 K, 1 V)        GQA (8 Q, 2 K, 2 V)
 Q Q Q Q Q Q Q Q            Q Q Q Q Q Q Q Q            Q Q Q Q Q Q Q Q
 │ │ │ │ │ │ │ │            └───┬───┬───┘            └──┬──┘ └──┬──┘
 V V V V V V V V                ▼   ▼                   ▼   ▼   ▼   ▼
 K K K K K K K K                K   V                   K   V   K   V
```

### C. Positional Encodings: RoPE (Rotary Position Embeddings)
Transformers are permutation-invariant; without positional info, "dog bites man" and "man bites dog" look identical.
* **Sinusoidal Positional Encoding (Original):** Adds static absolute vectors to embeddings.
* **Rotary Position Embeddings (RoPE):** Applies a rotation matrix to the Query and Key vectors in the complex plane. This naturally encodes *relative* distance between tokens: as distance increases, the dot product decays. RoPE is the industry standard for modern models (LLaMA, Mistral).

### E. Layer Normalization: LayerNorm vs. RMSNorm
To stabilize deep network training, features are normalized:
* **LayerNorm:** Centers activations to zero-mean and scales to unit variance, involving mean and variance calculations.
* **RMSNorm (Root Mean Square Normalization):** Hypothesizes that centering (mean-subtraction) is computationally redundant. It normalizes activations solely by their root mean square, reducing training cost by 10-50% with zero loss in accuracy.

### F. Tokenizers: BPE vs. SentencePiece
Tokenizers split raw strings into integers:
* **Byte-Pair Encoding (BPE):** Iteratively merges the most frequent pairs of characters/bytes. Used by GPT-4.
* **SentencePiece:** Treats input as a raw stream (including spaces as character `_`), removing the need for language-specific pre-tokenizers. Used by LLaMA.

### G. Decoding Strategies
How the model samples tokens from its output probability distribution (logits):
* **Greedy:** Picks the highest probability token. Can lead to repetitive loops.
* **Temperature ($T$):** Scales logits ($z_i / T$). High $T$ flattens distribution (creative/diverse); low $T$ sharpens it (deterministic).
* **Top-K:** Restricts sampling to the $K$ most likely tokens.
* **Top-P (Nucleus):** Restricts sampling to the smallest set of tokens whose cumulative probability exceeds $P$.

---

## 3. Why It Exists
Before Transformers (pre-2017), sequence modeling relied on Recurrent Neural Networks (RNNs) and Long Short-Term Memory (LSTM) networks. These suffered from:
1. **Sequential Bottleneck:** RNNs process tokens one-by-one ($t_1 \to t_2 \to t_3$). This makes parallelization across GPUs impossible during training.
2. **Vanishing/Exploding Gradients:** Backpropagation through time (BPTT) over long sequences causes gradients to decay exponentially, preventing models from remembering details beyond 50-100 tokens.
3. **Information Bottleneck:** LSTMs compress the entire history into a single vector of fixed size. 

The Transformer solved this by discarding recurrence entirely. Self-attention permits direct, single-step ($O(1)$ path length) communication between any two tokens in a sequence, enabling mass parallelization and infinite scaling.

---

## 4. Internal Working
Below is the architectural layout of a standard Decoder-only Transformer block (typical of modern GPT/LLaMA style generative models):

```
       [ Input Tokens: "The", "cat", "sat" ]
                       │
             [ Embedding Layer ]
                       │
         [ Apply RoPE (Rotary Pos) ]
                       │
      ┌────────────────┴────────────────┐
      │                                 │
  [RMSNorm]                             │ (Residual Connection)
      │                                 │
 [Grouped-Query Attention]              │
      │                                 │
      ├─────────────────────────────────┘
      │
      ├────────────────┐
      │                │
  [RMSNorm]            │ (Residual Connection)
      │                │
 [SwiGLU FFN Layer]    │
      │                │
      ├────────────────┘
      │
[Final Output Projection] ───► [Logits] ───► [Softmax / Temperature] ───► Next Token
```

### The Attention Step Matrix Multiplication (Low-Level Flow):
1. **Input Matrix $X$ ($N \times d_{\text{model}}$)**: $N$ is sequence length, $d_{\text{model}}$ is embedding dimension.
2. **Projections**:
   * $Q = X \cdot W_Q$ ($N \times d_k$)
   * $K = X \cdot W_K$ ($N \times d_k$)
   * $V = X \cdot W_V$ ($N \times d_v$)
3. **Similarity**: $S = Q \cdot K^T$ ($N \times N$)
4. **Causal Masking**: For decoders, apply an upper-triangular mask of $-\infty$ to elements where $j > i$ to prevent looking at future tokens.
5. **Softmax**: Apply softmax row-wise to convert attention scores into probabilities.
6. **Output**: $O = \text{Softmax}(S) \cdot V$ ($N \times d_v$)

---

## 5. Advantages
1. **Massive Parallelization:** Computes self-attention for all tokens simultaneously, allowing GPU training acceleration.
2. **$O(1)$ Path Length:** Any token can query another directly, regardless of distance, mitigating long-range memory decay.
3. **Unbounded Scaling:** Performance scales predictably with parameters, compute, and dataset size (Scaling Laws).

---

## 6. Disadvantages & Pitfalls
1. **Quadratic Complexity ($O(N^2)$):** The attention matrix size is sequence length squared. Processing a 100k-token prompt requires computing a $100,000 \times 100,000$ matrix, exhausting GPU VRAM.
2. **KV Cache Expansion:** During autoregressive generation, keys and values of past tokens are stored in VRAM to avoid recalculation. This cache grows linearly with sequence length and batch size, capping throughput.
3. **Tokenizer Artifacts:** Word-splitting causes issues with simple arithmetic (e.g., "12345" parsed as two tokens: "123" and "45"), leading to reasoning failures.

---

## 7. Production Usage
Here is a complete, dependency-free **TypeScript** implementation of a Decoder-style Self-Attention mechanism with causal masking, illustrating the core mathematical projections and matrix steps in an enterprise-grade structure.

```typescript
/**
 * Vector / Matrix Utility Functions for pure TypeScript implementation
 */
class MatrixMath {
  // Compute Dot Product of two vectors
  static dot(v1: number[], v2: number[]): number {
    let sum = 0;
    const len = v1.length;
    for (let i = 0; i < len; i++) sum += v1[i] * v2[i];
    return sum;
  }

  // Row-wise Softmax with numerical stability trick
  static softmax(arr: number[]): number[] {
    const max = Math.max(...arr);
    const exps = arr.map(x => Math.exp(x - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(x => x / (sum || 1));
  }
}

interface SelfAttentionConfig {
  seqLen: number;      // N (Sequence length)
  dModel: number;      // Embedding dimension
  dHead: number;       // Dimension per head
}

export class DecoderSelfAttention {
  private config: SelfAttentionConfig;
  
  // Projection weights initialized with dummy values for demonstration
  private W_q: number[][]; // (dModel x dHead)
  private W_k: number[][]; // (dModel x dHead)
  private W_v: number[][]; // (dModel x dHead)

  constructor(config: SelfAttentionConfig) {
    this.config = config;
    this.W_q = this.initWeightMatrix(config.dModel, config.dHead);
    this.W_k = this.initWeightMatrix(config.dModel, config.dHead);
    this.W_v = this.initWeightMatrix(config.dModel, config.dHead);
  }

  // Helper to initialize weights between -0.1 and 0.1
  private initWeightMatrix(rows: number, cols: number): number[][] {
    return Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => Math.random() * 0.2 - 0.1)
    );
  }

  // Matrix multiplication helper: (SeqLen x dModel) * (dModel x dHead) -> (SeqLen x dHead)
  private project(input: number[][], weights: number[][]): number[][] {
    const N = input.length;
    const dHead = weights[0].length;
    const dModel = this.config.dModel;
    
    const output: number[][] = Array.from({ length: N }, () => new Array(dHead).fill(0));
    
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < dHead; j++) {
        let sum = 0;
        for (let k = 0; k < dModel; k++) {
          sum += input[i][k] * weights[k][j];
        }
        output[i][j] = sum;
      }
    }
    return output;
  }

  /**
   * Computes the forward pass of causal masked self-attention.
   * @param X Input embeddings matrix of size (SeqLen x dModel)
   * @returns Attention weighted matrix of size (SeqLen x dHead)
   */
  public forward(X: number[][]): number[][] {
    const N = X.length;
    const dHead = this.config.dHead;
    const scale = Math.sqrt(dHead);

    // 1. Project to Query, Key, Value matrices
    const Q = this.project(X, this.W_q);
    const K = this.project(X, this.W_k);
    const V = this.project(X, this.W_v);

    // 2. Compute Raw Attention Scores (Q * K^T)
    const rawScores: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        rawScores[i][j] = MatrixMath.dot(Q[i], K[j]) / scale;
      }
    }

    // 3. Apply Causal Masking (j > i) and Softmax
    // In a decoder, token i cannot attend to future token j.
    const attentionWeights: number[][] = [];
    for (let i = 0; i < N; i++) {
      const rowScores = [...rawScores[i]];
      for (let j = 0; j < N; j++) {
        if (j > i) {
          rowScores[j] = -Infinity; // Mask out future tokens
        }
      }
      attentionWeights.push(MatrixMath.softmax(rowScores));
    }

    // 4. Weighted sum over Values (Weights * V)
    const output: number[][] = Array.from({ length: N }, () => new Array(dHead).fill(0));
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < dHead; j++) {
        let sum = 0;
        for (let k = 0; k < N; k++) {
          sum += attentionWeights[i][k] * V[k][j];
        }
        output[i][j] = sum;
      }
    }

    return output;
  }
}
```

---

## 8. Interview Q&A

### 🔹 Basic Questions
#### Q1: What is the primary difference between the Encoder and the Decoder in the original Transformer paper?
The Encoder uses bidirectional self-attention, allowing each token to attend to all other tokens in the sequence (past and future). The Decoder uses causal (masked) self-attention, which hides future tokens so the model can only attend to past tokens during generative next-token prediction.

#### Q2: Why is the dot product scaled by $\frac{1}{\sqrt{d_k}}$ in the attention calculation?
As the dimensionality $d_k$ grows, the magnitude of the dot products increases. This pulls the softmax function into regions with extremely small gradients (flat areas of the sigmoid/softmax curve), causing the vanishing gradient problem. Scaling dampens the values, keeping the softmax in active gradient regions.

#### Q3: What is a token, and why can't LLMs read raw text directly?
A token is a sub-word unit (ranging from a single character to a whole word) generated by a text parser. Neural networks process numerical matrices, not raw strings. Tokenizers map strings into indexed integers, which are then mapped to continuous vectors via embedding matrices.

#### Q4: What is the difference between Greedy Decoding and Nucleus (Top-p) Sampling?
Greedy decoding selects the token with the absolute highest probability at each step, often producing dry, repetitive, or looping sentences. Nucleus sampling dynamically builds a candidate pool of tokens whose cumulative probability is $\le p$, then samples from this pool, creating more organic output.

#### Q5: What is Temperature in generative models, and how does setting it to 0 change output?
Temperature scales output logits before softmax. Setting it to a very low value or exactly 0 squashes the distribution, making the highest probability token dominate (approaching $100\%$). It converts the sampling process into deterministic greedy selection.

---

### 🔸 Intermediate Questions
#### Q6: Explain Grouped-Query Attention (GQA) and why it is used in LLaMA-3.
GQA partitions query heads into groups. Each group shares a single Key and Value head. It sits between Multi-Head Attention (which uses a unique Key/Value head for each Query head) and Multi-Query Attention (which shares a single Key/Value head across all Queries). GQA is used because it saves massive VRAM during inference by shrinking the KV Cache size while retaining the model's accuracy.

#### Q7: How does Rotary Position Embedding (RoPE) differ from absolute positional embeddings?
Absolute embeddings add static vectors representing position indices directly to the input tokens. RoPE, instead, multiplies the Query and Key vectors by a rotation matrix. The rotation angle corresponds to the token's position. When computing attention ($Q \cdot K^T$), this formulation naturally resolves to a function of the *relative* distance ($i - j$) between tokens.

#### Q8: Why is RMSNorm preferred over LayerNorm in modern LLM architectures?
LayerNorm calculates both the mean and variance of activations to normalize them. RMSNorm simplifies this by computing only the Root Mean Square (RMS), omitting the mean-subtraction step. This reduces computation overhead, resulting in speedups with no measurable impact on training stability.

#### Q9: What is the "KV Cache" and how does it optimize inference?
During decoding, generating a new token requires attending to all prior tokens. Instead of recomputing $K$ and $V$ matrices for every past token at every step, the system stores these vectors in a memory buffer (KV cache). At each step, the model only projects the new token and appends its keys/values to the cache, converting $O(N^2)$ calculations to $O(N)$ during generation.

#### Q10: What is the difference between Byte-Pair Encoding (BPE) and SentencePiece tokenization?
BPE is a sub-word tokenization algorithm that builds its vocabulary by iteratively merging common character pairs. It requires pre-tokenization (e.g., splitting by spaces). SentencePiece processes the string as a raw byte stream, treating spaces as a special character (`_`), meaning it doesn't need language-specific rules and handles multilingual spaces naturally.

---

### ⚡ Advanced Questions
#### Q11: Explain the FlashAttention optimization and how it achieves speedup without altering attention mathematics.
Standard attention computes $QK^T$, stores the intermediate $N \times N$ matrix in High Bandwidth Memory (HBM), computes softmax, and multiplies by $V$. This causes high memory traffic bottlenecking. FlashAttention uses tiling: it loads blocks of $Q, K, V$ into fast SRAM cache, computes softmax incrementally (using online softmax updates), and writes the final output back to HBM without ever saving the massive $N \times N$ matrix to GPU memory.

#### Q12: Why do LLMs struggle with basic mathematical reversals (e.g., spelling a word backwards or reversing a string)?
LLMs see tokens, not individual letters. The word "antigravity" might be parsed as two tokens: `["anti", "gravity"]`. Because the model never sees the internal letters of the token in isolation, it cannot easily manipulate them. Without character-level characterization, operations like reversing require the model to memorize character associations explicitly.

#### Q13: What is the SwiGLU activation function and why is it used in Feed-Forward networks?
SwiGLU is a Gated Linear Unit variant using the Swish activation function:
$$\text{SwiGLU}(x) = (\text{Swish}(x W) \otimes x V)$$
It replaces standard ReLU or GeLU activations in the FFN layer. The gating mechanism allows elements to modulate the flow of information multiplicatively, improving model capacity and convergence rates.

#### Q14: How does context window scaling via RoPE interpolation (e.g., linear vs. YaRN) work?
To extend a model trained on $4\text{k}$ tokens to $32\text{k}$ without re-training, we must scale positional frequencies. Linear interpolation divides the input position indices by $8$ (scaling factor $S = 32k/4k$), mapping the $32\text{k}$ tokens into the $4\text{k}$ range. YaRN (Yet another RoPE extensioN) improves on this by scaling different frequency bands at different rates, preventing the high-frequency features from washing out.

#### Q15: How does Speculative Decoding work to accelerate LLM generation?
Speculative decoding uses a small, fast "draft" model to generate a sequence of $K$ tokens quickly (low latency). Then, the large, slow "target" model runs a single forward pass over these $K$ tokens in parallel (using its prompt-processing capability) to verify them. If the target model approves the draft tokens based on acceptable probability ratios, they are accepted; otherwise, it corrects the first rejected token and repeats the loop.

---

### 🏛️ System Design Questions
#### Q16: Design a distributed serving system that handles Multi-Head Attention KV Cache fragmentation.
* **Problem:** Standard KV caches are allocated statically (contiguous memory chunks). As sequence lengths vary, memory becomes heavily fragmented, limiting GPU batch sizes.
* **Solution:** Implement **PagedAttention** (vLLM architecture). 
  * Map the KV cache of a sequence into virtual memory blocks of a fixed size (e.g., 16 tokens).
  * Use a central Block Manager to map logical token blocks to non-contiguous physical GPU memory slots.
  * When executing attention, the kernel loops over the lookup table to fetch values from these block addresses dynamically.
  * This cuts VRAM waste from $60-80\%$ down to near $4\%$, doubling the maximum batch size.

```
Logical Blocks:  [ Block 0 ]  [ Block 1 ]  [ Block 2 ]
                     │            │            │
Block Manager:       ▼            ▼            ▼
Physical Pages:  [ Page 12 ]  [ Page 43 ]  [ Page 05 ] (Non-contiguous VRAM)
```

#### Q17: Design a routing system for mixed-workload LLM requests (varying input lengths and output generation sizes).
* **Problem:** If a request with $50$ input tokens is grouped in a batch with a request with $2000$ input tokens, the smaller request experiences high time-to-first-token (TTFT) latency due to the padding overhead.
* **Solution:**
  * Implement **Continuous Batching (Iteration-level scheduling)**. Instead of waiting for a batch of requests to finish completely before scheduling new ones, schedule requests at the individual token iteration level.
  * When a new prompt arrives, run its prefill step, then merge it into the active decoding pool for the next generation token step.
  * Employ separate queues: a Prefill Queue for processing prompt tokens, and a Decode Queue for generating next tokens.
  * Route requests to specific instances optimized for context length or generation limits.
