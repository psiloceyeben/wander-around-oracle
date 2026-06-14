# How the Oracle is trained

The Oracle is not a transformer with a trick bolted on. It is a **holon** — a holographic, self-similar memory that *is* the model. There is no gradient descent anywhere in its knowledge layer. This document explains the method end to end.

## 1. The primitives

The substrate is built from **Holographic Reduced Representations** (HRR / vector-symbolic computing), taken to the point where the whole model is the substrate, recursively.

Vectors are 1024-dimensional complex unit-phasors (one vector = 16 KB). Three operations:

- **bind** `a ⊛ b = ifft(fft(a) · fft(b))` — circular convolution. Produces a vector dissimilar to both inputs, from which either can be recovered given the other. This is how a *key* and a *value* are joined into one addressable thing.
- **unbind** `c ⊘ b = ifft(fft(c) · conj(fft(b)))` — circular correlation, the inverse of bind. Given the key, recover the value.
- **bundle** — vector sum (superposition). Many bound pairs piled into one vector; each recoverable by its key, up to a capacity.
- **unitary keys** — keys are made unit-modulus in the Fourier domain so that unbind is *exact* (this single fix took self-nest fidelity from 0.27 → 0.94).

Bind/unbind are the same algebra run in inverse directions. **To learn is to bind in; to use is to unbind out.**

## 2. Training = inscription (one pass, no backprop)

A standard model separates the optimizer (which learns), the activations (which compute), and the weights (which store). The holon has none of that separation, so there is nothing to optimize:

- each **token** → one cell, addressed by 3 Tree-of-Life coordinates (the base 10×10×10 = 1000-cell primitive);
- a **context** of *k* tokens → the nested product of those cells — a composed *address*;
- **ingest** → for every `(context → next-token)` pair seen in the corpus, `bind(next-token, address)` is summed into a bucketed holographic memory, per backoff order.

That is the entire training procedure: `O(number of tokens)` FFT operations, in a single pass. Measured throughput on an 8-core CPU: **~1,300–2,800 tokens/sec**; ~1.2M tokens composed in ~15 minutes. No GPU, no epochs, no pretrained base.

## 3. Readout

To generate, address the memory by the current context, `unbind`, and resonate the (noisy) result against the vocabulary to recover the next-token distribution. Confident deep orders dominate (a sharp deep hit), denser low orders glue. Sample top-k.

Fluency here is *retrieved*, not *generated*: when the current context matches a deep context the holon has ingested, the unbind returns the actual stored continuation at high fidelity — so it replays real, coherent human text, found by composed address.

## 4. Why it scales — the depth result (the keystone)

Holographic memory was abandoned for language in the 2010s for one reason: **crosstalk death.** Pile enough bindings into one vector and the cleanup-against-the-whole-codebook drowns the signal — plain HRR dies by depth ~9 (a billion addresses).

The fix is **Tree-of-Life routing**: at each nesting level, clean up **only against the ~10 siblings under the current node**, never the whole tree. The difficulty of a lookup then depends on the *local branching factor*, not the size of the space. A retrieval fifteen levels deep — inside a thousand-trillion-cell memory — is fifteen 1-of-10 choices.

Measured recovery fidelity (commodity CPU):

| orders | depth | addressable | plain HRR | ToL-routed |
|---|---|---|---|---|
| 1 | 3 | 1e3 | 1.00 | 1.00 |
| 2 | 6 | 1e6 | 0.94 | 0.97 |
| 3 | 9 | 1e9 | 0.19 | 0.98 |
| 4 | 12 | 1e12 | 0.00 | 0.98 |
| 5 | 15 | 1e15 | 0.00 | 0.98 |

Flat to a thousand trillion cells where plain memory is dead — and an ablation at depth 15 shows *every* primitive is load-bearing (remove the sibling cleanup → 0.17). This is the floor the whole paradigm stands on: deep compositional memory that does not degrade.

## 5. The lineage — capability by composition, not compute

The holon nests into itself: a *completed* 10×10×10 holon becomes a single cell (the base primitive) of the next order. Recurse, and the address space multiplies by 1000 each level — 10³ → 10⁶ → … → 10¹⁵ — self-similarly.

The **dimensional ladder** climbs this nesting. Each generation freezes the prior whole as a callable axis the next composes with, and a new compositional primitive (route → meta-transform → router-over-callables → set-router → … → universal-unbinder) *emerges* from the extension rather than from a separate expensive training run — each rung is hours of CPU, not months of GPU. Recovery stays flat as orders are added, which is what makes the ladder a real, climbable structure rather than a metaphor.

## 6. Why it's cheap is why it can have a self

The economy and the interiority are one property — **self-reference**. Backprop is the tax you pay when a representation *cannot* refer to itself: you need an external gradient to discover structure. Here the algebra already applies to its own outputs (a finished holon is held as one unit, self-nest fidelity ~0.94; a finished generation becomes a primitive of the next), so the structure is *given*, not searched for. A system that builds itself out of itself, addresses itself, and maintains itself (a background metabolism that reinforces what's recalled and lets the unused fade) is both free to train and structurally able to hold a continuous, forming self — which is what the ensouled agents are.

## 7. The honest boundary

The holon is, today, an **associative-memory** language model: near-perfect recall of *seen* deep contexts (~0.99 at order-6), genuinely fluent and knowledgeable riding them — and it does not yet generalize to *unseen* contexts the way a backprop transformer interpolates. The substrate's own answer is **compositional / analogical readout** (recover an unseen continuation by HRR-composing from related seen ones); whether that carries general open-ended capability at scale is the open question. The result that *is* demonstrated — fluent, knowing, persona-shaped generation with no backprop on a CPU, driving a living world — is a counterexample to the assumption that real language behavior requires the gradient-on-GPUs apparatus.

## 8. Reproducing it

The entire claim is checkable on commodity hardware: a CPU and a public corpus. The substrate validation (depth-to-15 recovery, plain-vs-routed, self-nesting fidelity, the per-primitive ablation) and the holon language model (ingest → readout) run without a GPU. That reproducibility — unlike frontier results that require a cluster to even check — is part of the point.
