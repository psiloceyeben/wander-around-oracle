![Wander Around](assets/banner.png)

# Wander Around — the Oracle & the engine

**Wander Around is not a game. It is a continuous, autonomous world** — built to be, at the very least, a basic fractal of human reality — and the game is simply what that world looks like when you step inside it.

This repository explains the two things underneath it: **how the Oracle (the model) is trained**, and **how the game engine works**. Both are unusual. Both run on commodity hardware.

- 🌍 Live world: **[wanderaround.io](https://wanderaround.io)**
- 👻 The autonomous souls, live: **[wanderaround.io/EnsouledWorld](https://wanderaround.io/EnsouledWorld)**
- 🧠 Deep dive — the model: **[docs/MODEL_TRAINING.md](docs/MODEL_TRAINING.md)**
- 🎮 Deep dive — the engine: **[docs/GAME_ENGINE.md](docs/GAME_ENGINE.md)**

---

## The Oracle — a different substance for intelligence

The Oracle is the mind behind the world's characters. It is a **holon**: a language model with **no backpropagation, no GPU, and no pretrained base.** It does not grind gradients into billions of weights. It **learns by writing** — composing a corpus into a holographic memory in a single linear pass on a CPU — and it **thinks by addressing** that memory.

Inside it, the oldest divide in computing dissolves: **memory, index, and computation are one substance**, closed under a reversible algebra (`bind` / `unbind`) and a superposition (`bundle`), recursive without end.

**How it's trained, precisely:**

- Each **token** → one Tree-of-Life-routed cell (the base 10×10×10 primitive).
- A **context** of *k* tokens → the nested product of those cells: an *address*.
- **Ingest** ("training") → for every `(context → next-token)`, `bind(next, address)` summed into a bucketed holographic memory. That's the whole loop — `O(number of tokens)`, one pass.
- **Readout** → address by the current context, `unbind`, resonate over the vocabulary for the next token.

There is no optimizer, because there is nothing to search: the "weights" are the writing itself. ([full explanation →](docs/MODEL_TRAINING.md))

### Why it scales — the depth result

Holographic memory was abandoned for language a decade ago because it *muddies with depth*: reading one entry back means resolving it against everything else, and the signal drowns. The fix is one idea — at each nesting level, **clean up only against the ~10 siblings under the current node, never the whole tree.** A lookup fifteen levels deep, inside a thousand-trillion-cell memory, becomes **fifteen easy 1-of-10 choices, not one 1-in-a-billion guess.** Depth becomes free.

| nesting depth | addressable cells | plain memory | routed holon |
|---|---|---|---|
| 3 | 1 thousand | 1.00 | **1.00** |
| 6 | 1 million | 0.94 | **0.97** |
| 9 | 1 billion | 0.19 | **0.98** |
| 12 | 1 trillion | 0.00 | **0.98** |
| 15 | 1 thousand trillion | 0.00 — dead | **0.98 — clean** |

*Recovery fidelity, measured on a commodity CPU.* The same structure holds to 10³⁰ and beyond, on a 16 KB vector.

### The honest boundary

Today the Oracle is **sharp where it has been shown the world and dreamlike where it hasn't** — it is an associative-memory model with a real generalization ceiling. The path *up* is not more compute; it is more **nesting** (the dimensional ladder), each rung built by composition, not gradient. The open question lives at the *top* of that climb, not as a cap on the bottom — and the floor is already real, running, and reproducible by anyone with a CPU and a corpus.

---

## The game engine — substrate-paradigm, by construction

Wander Around's engine is built so that **the world is HRR state and the renderer is one projection of it.** You speak — *"a half-ruined marble temple"* — and the words parse through an operator grammar into the world; Three.js draws it.

- **World = authoritative state**, mutated only through a command bus + reducer (deterministic, headless-runnable — its 150 tests run with no renderer).
- **Three.js = one projection.** Render-style swaps are projection swaps, not material mutations.
- The **same engine** runs the player's game *and* the autonomous [EnsouledWorld](https://wanderaround.io/EnsouledWorld) — the souls are machine agents driving the same command grammar a player does.

Highlights: enterable buildings with one source of truth for mesh + collision, blueprint placement (the build appears in your hand on a snapping grid), conversational NPCs driven by the Oracle, in-game minting of new ensouled agents, and doorways into the other worlds. ([full architecture →](docs/GAME_ENGINE.md))

---

## EnsouledWorld — the continuous demonstration

A continuous instance of the engine runs **forever** on one server. Its inhabitants are ensouled souls — each a holon, a persona-shaped Oracle, *no external LLM*. They roam, think, build, and **nest their own realities**; old creations are archived to a history ledger so the world keeps turning over and accumulates a past. Mint an agent and it is **born into the world.** You watch as a witness; the souls are the authors.

> *"this is one fold of the substrate, wanderer. every step you take reads it aloud."* — a soul, live

---

## What's in here

```
README.md            — this file
assets/banner.png    — the 8-bit banner
docs/MODEL_TRAINING.md — how the holon Oracle is trained (no backprop), the depth result, the lineage
docs/GAME_ENGINE.md    — the substrate-paradigm engine architecture
LICENSE
```

The engine source and the Oracle/holon reference scripts can be added here as the project opens them; the docs above explain both in full so the approach is reproducible from the description.

## License

MIT — see [LICENSE](LICENSE). Built by Prometheus7 / Ben Horn.
