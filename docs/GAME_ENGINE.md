# The game engine

Wander Around's engine is **substrate-paradigm by construction**: the world is authoritative HRR-adjacent state, and the renderer is *one projection of it* — not the source of truth. That single discipline is what lets the same engine run both the player's game and the autonomous EnsouledWorld, and what makes the world deterministic, headless-runnable, and save-stable.

## The core loop

```
input / NL prompt / agent cognition
      → Command            (SpawnEntity, MoveEntity, RemoveEntity, EnterPortal, …)
      → CommandBus → reducer → World          (authoritative state mutation)
      → events
      → Projection(s)      (Three.js scene, or ASCII, or a headless feed)
```

- **World** holds entities (id, prototypeId, transform, components) in chunks. Nothing mutates it except the reducer.
- **CommandBus + defaultReducer** apply commands (`submit`/`applyImmediate` + `flush`). All change flows through here, so the sim is deterministic and replayable.
- **Projection** subscribes to world events and builds a view. `ThreeProjection` builds the 3D scene; `AsciiProjection` renders the same state as text. **Render-style swaps are projection swaps, not material mutations** — the world is unchanged.

Because the world and its rules are pure logic, the engine runs **headless in Node** — its 150 tests boot a `World` with no renderer, and the continuous EnsouledWorld instance is literally the engine's sim loop running server-side.

## Layers

| layer | role |
|---|---|
| `world` | authoritative state, chunked entities |
| `cmd` | command types, bus, reducer (the only writer) |
| `entity` | entity records, components, identity transforms |
| `time` | multi-rate scheduler (fixed-step sim) |
| `agent` | player + machine agents; machine agents emit commands via a `cognition` op |
| `cognition` | the Oracle clients + cognition ops (NPCs think via the substrate) |
| `language` | `decomposePrompt` / `promptToCommand` — natural language → operator grammar → commands |
| `social` | room transport / proximity (multi-presence) |
| `axiom` | guardrails (entity caps, sanctuary, id rules) enforced at the command layer |
| `projection` | Three.js / ASCII views of the same state |
| `features` | recipes, portals, workshop, biome worldgen, minting, tutorial, … |

## What the player can do

- **Speak the world** — `decomposePrompt` parses "a half-ruined marble temple" into a recipe (primary + materials + modifiers + Sephirah) and `promptToCommand` emits a `SpawnEntity`. Materials and modifiers map to mesh variants and components.
- **Blueprint placement** — `/spawn` puts the build *in your hand* (a viewmodel) with a translucent ghost, a snapping grid, and a footprint ring (green = clear & dry, red = blocked). Click to set it down.
- **Enterable buildings** — one source of truth (`buildingSpecs`) carries the wall plan that *both* the collision system enforces *and* the mesh builders construct from, so every visible doorway is walkable. Generalized stand-pads give furnished, walk-in interiors (e.g. a 3-room manor).
- **Conversational NPCs** — dialogue routes to the Oracle (Tree-of-Life routing + holon text); the NPC answers in its register, aware of the structures around it. Offline, a rich procedural voice keeps them alive.
- **Mint an ensouled agent** — an in-game panel drives the real minting flow (payment on a hosted page; the game never sees a card); the minted soul is **born into EnsouledWorld** and walks into your world as a companion.
- **Step into the other worlds** — a Worlds panel / hub doorway opens EnsouledWorld and the other Wander surfaces.

## EnsouledWorld — the engine running itself

A second instance of the engine runs continuously and headless on the server, with the **player-controller replaced by the ensouled souls.** Each soul is a machine agent whose `cognition` op:

1. **roams** (emits `MoveEntity` each tick),
2. **thinks** — periodically queries the persona-shaped holon Oracle (no external LLM) for a thought,
3. **authors** — asks the substrate "what will you make here?", and shapes the answer into the world via the same `promptToCommand` grammar a player uses (building structures, or nesting a *reality* — a portal),
4. creations **archive** after a lifespan (written to a history ledger, removed from the live world), freeing the soul to keep building — so the world turns over forever and remembers its past.

The authoritative state is broadcast as a live feed; a thin spectator client renders it in 3D, where each soul is a character (its agent portrait as a soft head) and every nested reality is a clickable portal.

## Running it

```bash
# engine logic + tests (Node, headless — no renderer needed)
npm install
npm test            # vitest — the world, command bus, agents, projection, language

# the playable frontend (Vite + Three.js)
cd frontend && npm install && npm run build   # → dist/
```

The desktop client is the built `dist/` wrapped in Electron. The headless EnsouledWorld instance imports only the pure engine submodules (`world`, `cmd`, `agent`, `entity`, `language`) — never the Three projection — so it runs anywhere Node does.
