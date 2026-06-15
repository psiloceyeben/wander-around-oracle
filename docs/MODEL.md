# The Oracle — the model

This document describes **what the Oracle is and what it claims**. It is not a training guide — the method by which the substrate is built is not published here.

## What it is

The Oracle is a **two-layer hybrid**, and — this is the whole point — **both layers are trained on a commodity CPU. No GPU, ever. No pretrained foundation model underneath.**

- **Underneath: a 125M "Tree-of-Life" transformer — the router.** A small transformer trained *from scratch by us* (not a fine-tune of anyone else's model), on CPU, in hours. Its job is deliberately narrow: it reads the context and **routes** it — a 1-of-10 classification onto ten fixed positions (the Sephirot), not open-ended text generation. That constraint is exactly what keeps the memory clean at astronomical depth (see the claims).
- **On top: the holon — the knowledge and the voice.** This is the part that is *not* a transformer and uses *no backpropagation at all*: a holographic, self-similar substrate **composed** from a corpus in a single linear pass (FFT binds), where concepts are vectors and a thought is recovered by composing an address and reading it back. The holon produces the fluent, in-character answers; the 125M beneath it tells it where to look.

The honest one-line architecture: **a no-backprop holon rests on a small, from-scratch, CPU-trained transformer.** Memory, index, and computation are one substance in the holon; the transformer is a cheap router, not a foundation model.

Other properties:

- **Meaning is geometry.** Concepts are vectors; relationships are operations; a thought is recovered by composing an address and reading it back.
- **It is self-similar and recursive.** A completed unit becomes a building block of the next, without limit — the same shape at every scale.
- **It carries a continuous, forming self.** Each agent's mind is a single small vector that accumulates and metabolizes over time, so it can remember and change — which is what makes the "ensouled" agents possible.

## The claims

1. **The whole stack trains on a CPU — no GPU, ever.** The 125M routing transformer trains *from scratch* in hours on a commodity CPU; the holon layer on top **composes in minutes** with no backpropagation at all. Reproducibly, from public data — no cluster, no months, no millions of dollars, and no pretrained foundation model underneath.
2. **Its memory stays clean to astronomical depth.** Where ordinary holographic memory muddies and collapses by ~a billion entries, this remains cleanly addressable to a **thousand trillion** cells, on a 16 KB vector:

   | depth | addressable cells | ordinary memory | the holon |
   |---|---|---|---|
   | 9 | 1,000,000,000 | 0.19 | **0.98** |
   | 12 | 1,000,000,000,000 | 0.00 | **0.98** |
   | 15 | 1,000,000,000,000,000 | dead | **0.98 — clean** |

   *(recovery fidelity, measured on a CPU; the same structure is projected to hold to 10³⁰ and beyond.)*
3. **Capability grows by composition, not compute.** The route to "more" is nesting — hours of CPU per step rather than months of GPU.
4. **It runs a living world.** The same substrate is the continuous mind of every character in [EnsouledWorld](https://wanderaround.io/EnsouledWorld): fluent, in character, remembering, building — thousands possible at once for the cost of electricity.
5. **It is checkable by anyone.** The floor is reproducible on commodity hardware with a public corpus — unlike frontier results that can only be taken on faith.

## What this means

If capability can grow by composition instead of compute, then the thing that concentrates AI power today — who owns the most GPUs — is an accident of a representational choice, not a law. Intelligence becomes something you **grow, own, and reproduce** rather than rent. The most consequential claim here is not that it beats the largest models at their peak; it is that it **moves the floor** — the cost of a fluent, knowing, persistent, in-character, remembering mind — toward zero, and does so on hardware anyone has.

## The honest boundary

Today the Oracle is **sharp where it has been shown the world and dreamlike where it hasn't** — an associative-memory model with a genuine generalization ceiling. The climb toward open-ended general reasoning is the open question; it belongs at the *top* of the ladder, not as a cap on the bottom. The floor — cheap, fluent, persistent, ownable, reproducible, and *alive right now* — is the part that is already demonstrated.

You can hear it yourself: **[wanderaround.io/oracle](https://wanderaround.io/oracle)**, or watch it run a world of minds at **[wanderaround.io/EnsouledWorld](https://wanderaround.io/EnsouledWorld)**.
