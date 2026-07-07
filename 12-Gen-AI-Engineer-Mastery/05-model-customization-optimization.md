# 🧠 Module 05: Model Customization & Optimization

---

## 1. Definition
**Model Customization and Optimization** encompasses the algorithms and engineering techniques used to specialize pre-trained foundation models for niche domain expertise (via fine-tuning and alignment) and compress them to run at maximum throughput and minimal VRAM footprints (via quantization and parallelized execution kernels).
* **One-line Mental Model:** Customization is teaching a generalist doctor to become a cardiologist (fine-tuning), while optimization is packing their massive medical library into a fast, lightweight mobile app (quantization & serving optimizations).

---

## 2. Drill Down

### A. Fine-Tuning Paradigms: Full vs. PEFT (Parameter-Efficient Fine-Tuning)
1. **Full Fine-Tuning:** All parameters of the neural network are updated during backpropagation. Extremely resource-intensive (requires several high-end A100/H100 GPUs) and prone to **Catastrophic Forgetting** (where the model forgets general logic while learning a specific task).
2. **PEFT (Parameter-Efficient Fine-Tuning):** Keeps the original model weights frozen and only trains a tiny fraction (often $< 1\%$) of additional parameters. Reduces VRAM requirements by over $70\%$, allowing training on standard commercial GPUs.

### B. LoRA (Low-Rank Adaptation) and QLoRA
LoRA hypothesizes that weight changes ($\Delta W$) during adaptation have a low "intrinsic dimension."
* **LoRA:** Instead of updating the weight matrix $W_0 \in \mathbb{R}^{d \times k}$, it parameterizes the update $\Delta W$ as the product of two low-rank matrices $B \in \mathbb{R}^{d \times r}$ and $A \in \mathbb{R}^{r \times k}$, where the rank $r \ll \min(d, k)$.
  $$W = W_0 + \Delta W = W_0 + \frac{\alpha}{r} (B \cdot A)$$
  During training, only $A$ and $B$ are updated. For inference, $B \cdot A$ is computed and merged back into $W_0$, meaning zero inference latency overhead.
* **QLoRA (Quantized LoRA):** Optimizes LoRA by quantizing the base model $W_0$ to 4-bit NormalFloat (NF4) precision, using double quantization to shrink memory further, and placing page optimizer gradients in CPU memory. This allows fine-tuning a 70B parameter model on a single 48GB GPU.

```
                  Input Vector (x)
                   ┌──────┴──────┐
                   ▼             ▼
              [ W_0 Frozen ]  [ A (d x r) Trainable ]
               (4-bit NF4)       │
                   │             ▼
                   │          [ B (r x k) Trainable ]
                   │             │
                   ▼             ▼
                (W_0 * x)  +  (B * A * x)
                   └──────┬──────┘
                          ▼
                       Output
```

### C. Quantization Formats
Quantization reduces the bit-precision of model weights (e.g., from 16-bit floating point down to 8-bit or 4-bit integers):
* **GGUF (GPT-Generated Unified Format):** Optimized for CPU+GPU inference (running on consumer laptops via llama.cpp). It bundles the model weights and tokenizer metadata in a single file.
* **GPTQ (Generalized Post-Training Quantization):** A calibration-based post-training quantization method for GPUs. It compresses weights to 4-bit using second-order Taylor expansion approximations, maintaining high accuracy.
* **AWQ (Activation-aware Weight Quantization):** Recognizes that not all weights are equally important. It protects the top 1% "salient" weights (which handle important activations) from being quantized aggressively, reducing accuracy loss on smaller models.

### D. Human Alignment: RLHF vs. DPO
Models trained on next-token prediction can still generate toxic or unhelpful text. Alignment guides model behavior:
* **RLHF (Reinforcement Learning from Human Feedback):** 
  1. Train a separate **Reward Model** on human preference data (determining which of two LLM answers is better).
  2. Use reinforcement learning (PPO algorithm) to optimize the LLM policy, using the Reward Model to score generated responses while applying a KL-divergence penalty to keep the model from drifting too far from its base configuration.
* **DPO (Direct Preference Optimization):** Bypasses the need to train a Reward Model or run complex reinforcement learning loops. DPO mathematically reformulates the objective function to optimize the LLM directly on preference pairs (Prompt, Winning Response, Losing Response) via binary cross-entropy, making alignment training stable and fast.

---

## 3. Why It Exists
LLM deployments face massive economic and hardware constraints:
1. **The VRAM Wall:** A 70B parameter model in FP16 precision requires $140\text{ GB}$ of VRAM just to load, requiring multi-GPU nodes. Quantizing the model to 4-bit drops this footprint to $\sim 35\text{ GB}$, allowing it to fit on a single, affordable GPU (like an RTX 3090/4090 or A6000).
2. **adapter Swapping:** In multi-tenant environments, deploying individual models for each client is cost-prohibitive. PEFT/LoRA allows hosting a single base model in memory and dynamically swapping tiny ($10-50\text{MB}$) LoRA adapter matrices depending on which client makes the API request.

---

## 4. Internal Working
Below is the mathematical layout of quantization mapping:

```
Float16 Continuous Range:  [-3.4e38  ...   -0.5, 0.0, 0.5   ...  3.4e38]
                                             │
                                   [ Quantization Step ]
                          (Scale factor 'S' and Zero-point 'Z')
                                             │
                                             ▼
INT4 Quantized Grid:       [-8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7]
```

### Quantization Formula (Affine Mapping):
$$q = \text{round}\left(\frac{r}{S}\right) + Z$$
Where $r$ is the real FP16 value, $S$ is the scale factor, $Z$ is the integer zero-point offset, and $q$ is the resulting integer (e.g. 4-bit or 8-bit). During inference, weights are dynamically **de-quantized** back to float representation to perform matrix math:
$$\hat{r} = S \cdot (q - Z)$$

---

## 5. Advantages
1. **Low VRAM footprint:** Shrinks models by $75\%$ (from FP16 to INT4) with minimal accuracy degradation.
2. **Dynamic Adapters:** Run hundreds of specialized task adapters on a single base model instance, maximizing GPU sharing.
3. **Training Democratization:** Enables training and fine-tuning on consumer-grade hardware.

---

## 6. Disadvantages & Pitfalls
1. **Quantization Loss:** Compressing smaller models ($< 7\text{B}$ parameters) to 4-bit causes significant degradation in complex reasoning, mathematics, and code generation.
2. **Catastrophic Forgetting:** Over-fitting a model on a narrow domain dataset (e.g., medical jargon) can destroy its ability to perform basic translation or generic prompt tasks.
3. **Adapter Swap Latency:** Swapping LoRA weights dynamically on GPUs introduces latency spikes if the swap is not cached or parallelized correctly.

---

## 7. Production Usage
Below is a production-ready **TypeScript** simulation of a **Dynamic Batcher and Context Cache Manager**. This mimics the serving optimization loops of platforms like vLLM, handling requests dynamically and grouping them to maximize throughput.

```typescript
interface InferenceRequest {
  id: string;
  prompt: string;
  maxTokens: number;
  resolve: (value: string) => void;
  reject: (err: any) => void;
}

export class ModelServingEngine {
  private activeQueue: InferenceRequest[] = [];
  private batchSizeLimit: number;
  private maxTokensLimit: number;
  private isProcessing = false;

  constructor(batchSizeLimit = 4, maxTokensLimit = 4096) {
    this.batchSizeLimit = batchSizeLimit;
    this.maxTokensLimit = maxTokensLimit;
  }

  // Calculate approximate token count (roughly 4 characters per token)
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Submits a request to the inference queue.
   */
  public async enqueueRequest(prompt: string, maxTokens: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const request: InferenceRequest = {
        id: Math.random().toString(36).substring(7),
        prompt,
        maxTokens,
        resolve,
        reject
      };

      // Safeguard: Check if input prompt alone exceeds max token limit
      const promptTokens = this.estimateTokens(prompt);
      if (promptTokens > this.maxTokensLimit) {
        return reject(new Error("Request prompt exceeds maximum token limit."));
      }

      this.activeQueue.push(request);
      this.processQueue();
    });
  }

  /**
   * Processes the queue using Continuous/Dynamic Batching logic.
   */
  private async processQueue() {
    if (this.isProcessing || this.activeQueue.length === 0) return;
    this.isProcessing = true;

    while (this.activeQueue.length > 0) {
      // 1. Group requests up to batchSizeLimit and maxTokensLimit
      const currentBatch: InferenceRequest[] = [];
      let totalEstimatedTokens = 0;

      while (
        this.activeQueue.length > 0 && 
        currentBatch.length < this.batchSizeLimit
      ) {
        const nextRequest = this.activeQueue[0];
        const requestTokens = this.estimateTokens(nextRequest.prompt) + nextRequest.maxTokens;

        if (totalEstimatedTokens + requestTokens <= this.maxTokensLimit) {
          currentBatch.push(this.activeQueue.shift()!);
          totalEstimatedTokens += requestTokens;
        } else {
          // If the batch is full token-wise, stop grouping
          break;
        }
      }

      if (currentBatch.length === 0) {
        // Handle edge-case where a single request is too large for remaining space
        const isolatedLargeReq = this.activeQueue.shift()!;
        isolatedLargeReq.reject(new Error("Request is too large to fit in server context allocation."));
        continue;
      }

      // 2. Simulate concurrent execution on GPU
      console.log(`[GPU Serving Engine] Batching ${currentBatch.length} requests. Total batch tokens: ${totalEstimatedTokens}`);
      await this.executeBatchInference(currentBatch);
    }

    this.isProcessing = false;
  }

  // Simulate GPU execution latency
  private async executeBatchInference(batch: InferenceRequest[]): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        batch.forEach(req => {
          req.resolve(`[Generated Response for request ID: ${req.id}] Content: SUCCESS`);
        });
        resolve();
      }, 500); // Mock 500ms network/GPU roundtrip
    });
  }
}

// Inline Test
const engine = new ModelServingEngine(3, 1000);
Promise.all([
  engine.enqueueRequest("Explain quantum physics simply.", 150),
  engine.enqueueRequest("Write a typescript function.", 200),
  engine.enqueueRequest("Summarize this news article.", 100),
  engine.enqueueRequest("Draft an email.", 300)
]).then(results => {
  results.forEach(res => console.log(res));
});
```

---

## 8. Interview Q&A

### 🔹 Basic Questions
#### Q1: What is Parameter-Efficient Fine-Tuning (PEFT) and why is it used?
PEFT is a collection of techniques (like LoRA) that adapts large pre-trained models by only training a small number of extra parameter weights, keeping the original base model frozen. This cuts GPU VRAM usage and storage overhead, allowing cost-effective fine-tuning.

#### Q2: What is Model Quantization?
Quantization is the process of mapping high-precision weight values (like 16-bit floating point) to lower-precision formats (like 8-bit or 4-bit integers), which reduces the memory size and speeds up execution with minimal loss in performance.

#### Q3: What is "Catastrophic Forgetting" in fine-tuning?
Catastrophic forgetting occurs when a model is fine-tuned extensively on a narrow dataset. The weight updates overwrite general knowledge patterns, causing the model to lose its original ability to perform basic tasks like translation, spelling, or logic.

#### Q4: What is the main difference between FP16 and BF16 precision formats?
Both are 16-bit floating point formats. FP16 allocates 5 bits for exponent and 10 bits for mantissa, offering high precision but easily triggering overflow/underflow. BF16 allocates 8 bits for exponent (same dynamic range as FP32) and 7 bits for mantissa, making it much more stable during LLM training.

#### Q5: What is the purpose of alignment algorithms in generative AI?
Alignment algorithms (like RLHF or DPO) guide models to match human preferences, safety regulations, and expectations. They ensure the model output is helpful, non-toxic, and truthful.

---

### 🔸 Intermediate Questions
#### Q6: Explain the mathematics behind Low-Rank Adaptation (LoRA).
Instead of updating the full weight matrix $W_0 \in \mathbb{R}^{d \times k}$ (which requires tracking $d \times k$ gradients), LoRA tracks updates via a low-rank decomposition: $\Delta W = B \cdot A$, where $B \in \mathbb{R}^{d \times r}$ and $A \in \mathbb{R}^{r \times k}$, with rank $r \ll \min(d, k)$. The number of parameters to train is reduced from $d \times k$ to $r \cdot (d + k)$, saving up to $99\%$ of GPU memory during backpropagation.

#### Q7: How does Direct Preference Optimization (DPO) compare to RLHF?
RLHF requires training a separate Reward Model, then running PPO reinforcement learning, which is unstable and requires managing multiple active models in VRAM (Base LLM, Policy LLM, Value LLM, Reward Model). DPO bypasses the reward model. It mathematically proves that preference optimization can be solved directly on the LLM policy using a binary cross-entropy loss on prompt pairs, saving compute and improving stability.

#### Q8: What is Post-Training Quantization (PTQ) vs. Quantization-Aware Training (QAT)?
* **PTQ:** Quantizes a pre-trained model directly without retraining (using calibration datasets to calculate scale factor and zero-point). Fast and cheap, but can degrade accuracy.
* **QAT:** Simulates quantization errors during model training (backpropagating through float weights while clamping them to simulated integer levels). More expensive, but yields much better accuracy for low-bit limits (e.g., 2-bit or 3-bit).

#### Q9: What is AWQ, and how does it protect model quality during quantization?
AWQ (Activation-aware Weight Quantization) recognizes that weight channels are not equally important. It observes the activation distribution of a calibration dataset. The channels with the highest activations are the most important. AWQ protects these top channels by keeping them in higher precision while quantizing the remaining weights, resulting in higher accuracy compared to GPTQ.

#### Q10: How does PagedAttention optimize GPU VRAM usage during LLM serving?
Standard serving allocates a contiguous chunk of memory for each request's KV Cache based on its maximum length limit. This leads to heavy fragmentation (unused pre-allocated space). PagedAttention breaks the KV Cache into fixed-sized pages (similar to OS paging) and maps them to non-contiguous physical GPU RAM blocks. This cuts VRAM waste to near $0\%$, enabling larger batch sizes.

---

### ⚡ Advanced Questions
#### Q11: Explain the concept of NormalFloat4 (NF4) quantization used in QLoRA.
NF4 is an information-theoretically optimal quantization type for zero-mean normally distributed data (which LLM weights generally are). Instead of standard linear spacing, NF4 defines quantile intervals such that each bin has an equal number of expected weight parameters. This yields lower quantization error than uniform 4-bit integers.

#### Q12: How does Speculative Decoding achieve speedup, and under what conditions does it fail?
* **Concept:** A small draft model generates $K$ tokens. The target model reviews them in parallel in a single forward pass.
* **Speedup:** If the draft tokens are accepted, generation speed increases because target model forward passes are bypassed.
* **Failure conditions:** If the draft model is inaccurate (e.g., code generation or complex math), the target model rejects the draft tokens, requiring it to regenerate them. The draft model's overhead actually increases latency.

#### Q13: What is "Double Quantization" in QLoRA, and how much VRAM does it save?
QLoRA quantizes the base model to 4-bit NF4, which requires scale factors (represented as 32-bit floats) for every block of 64 weights. Double Quantization quantizes these scale factors themselves from 32-bit floats to 8-bit floats with a block size of 256. This saves approximately $0.37$ bits per parameter, translating to $\sim 3\text{ GB}$ of VRAM savings on a 65B model.

#### Q14: Explain the mathematical role of the KL-divergence penalty in RLHF algorithms.
The KL-divergence term acts as a constraint in the objective function:
$$\text{Loss} = \text{Reward}(x, y) - \beta \cdot D_{\text{KL}}(\pi_{\theta}(y|x) \,\|\, \pi_{\text{ref}}(y|x))$$
It measures the difference between the active policy distribution ($\pi_{\theta}$) and the initial base reference model ($\pi_{\text{ref}}$). The penalty prevents the RL optimization from exploiting the reward model (e.g., generating gibberish that scores high but makes no sense) and limits catastrophic forgetting.

#### Q15: How would you architect a system to dynamically serve 100 different LoRA adapters on a single cluster?
1. **Base Model Load:** Load the base model weights (e.g., Mistral-7B) into GPU VRAM.
2. **Adapter Storage:** Store the LoRA adapter weight matrices in fast CPU memory or NVMe cache.
3. **Multi-LoRA Kernel:** Use a serving kernel (like S-LoRA or vLLM LoRA) that can perform matrix multiplication with different adapter weights in a single batch.
4. **Dynamic Swapping:** When requests arrive, group them by adapter ID, copy the adapter weights from CPU to GPU, run batch inference using custom scatter-gather kernels, and free adapter memory.

---

### 🏛️ System Design Questions
#### Q16: Design a cost-effective, high-throughput fine-tuning pipeline for a company that needs to train 50 customized models daily based on customer support logs.
* **Architecture:**
  * **Ingestion Queue:** Log files are pushed to an S3 bucket and queued in RabbitMQ.
  * **Preprocessing Node:** Cleans logs, formats them into Instruction-Response JSON pairs, and tokenizes.
  * **Training Node Pool:** A pool of nodes running QLoRA fine-tuning. Base models (e.g., LLaMA-3-8B-Instruct in 4-bit) are cached locally on GPU nodes.
  * **PEFT Execution:** Workers load the base model, mount the customer's dataset, attach a new LoRA adapter layer, and run SFT.
  * **Artifact Registry:** Saves the resulting LoRA adapter weights ($20\text{MB}$ file) to S3, while the $15\text{GB}$ base model weights are never duplicated.
  * **Orchestrator:** Manages cluster auto-scaling, shutting down GPU instances when the fine-tuning queue is empty.

```
Log Files ──► [Queue] ──► [Tokenize] ──► [QLoRA Fine-Tuning Workers]
                                                      │
                                                      ▼ (Saves Adapter weights)
                                              [S3 Adapter Registry]
```

#### Q17: Design an LLM inference service that guarantees sub-50ms TTFT (Time to First Token) and >30 tokens/sec generation throughput for concurrent web users.
* **Design Strategy:**
  * **Engine Layer:** Use vLLM with PagedAttention to eliminate memory fragmentation.
  * **Prefill-Decode Separation:** Deploy separate GPU nodes for the "Prefill" stage (which takes prompt tokens and generates KV caches) and "Decode" stages (which autoregressively generate next tokens).
  * **Model Quantization:** Quantize the model to 8-bit AWQ to speed up matrix operations.
  * **Speculative Decoding:** Attach a tiny draft model (e.g., 1.5B) to generate draft tokens, reducing target model evaluation loops.
  * **Continuous Batching:** Run a scheduler that injects incoming prefill requests into the decoding queue at the individual token generation step.
