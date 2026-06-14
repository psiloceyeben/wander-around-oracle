// Wander Engine v2 — public API.
//
// Layered HRR-native game engine. Build games by composing the layers below.
// Every layer reads from and writes to the same HRR substrate; nothing
// circumvents the command bus or the routing manifold.

export * as hrr        from "./hrr/index.js";
export * as entity     from "./entity/index.js";
export * as world      from "./world/index.js";
export * as time       from "./time/index.js";
export * as cmd        from "./cmd/index.js";
export * as projection from "./projection/index.js";
export * as agent      from "./agent/index.js";
export * as cognition  from "./cognition/index.js";
export * as language   from "./language/index.js";
export * as social     from "./social/index.js";
export * as axiom      from "./axiom/index.js";
export * as features   from "./features/index.js";

// Direct re-exports of the most commonly used types and helpers
export { World } from "./world/index.js";
export { CommandBus, defaultReducer } from "./cmd/index.js";
export { Scheduler } from "./time/index.js";
export { EntityRegistry, identityTransform } from "./entity/index.js";
export { AgentSystem } from "./agent/index.js";
export { promptToCommand, decomposePrompt } from "./language/index.js";
export { StubOracle, HttpOracle, oracleCognitionOp } from "./cognition/index.js";
export { AsciiProjection, ThreeProjection, SimpleMeshTagRegistry } from "./projection/index.js";
export { InProcessRoomTransport, RoomClient } from "./social/index.js";
export { AxiomRegistry, axiomGuarded, axiomIdLength, axiomEntityCap, axiomSanctuary } from "./axiom/index.js";
export { SEPHIROTH, sephirahVec, pathVec } from "./hrr/index.js";
