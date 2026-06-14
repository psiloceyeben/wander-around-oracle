// NPC dialogue box. When the Oracle is online, lines come from the model
// (routed through the Tree of Life — the routing Sephirah is shown so the
// substrate visibly drives the conversation). Offline, a seeded procedural
// voice keeps NPCs alive: lines vary by NPC kind, biome, and time of day.

import type { FrontendOracle } from "../oracle.js";

export interface DialogueContext {
  biome: string;
  phase: string;       // "dawn" | "morning" | ... | "night"
  questHint?: string;  // current objective title, if any
  structures?: string; // live world state: "a manor 12m away, a tower 31m away"
}

interface VoiceBank {
  name: string;
  greet: string[];
  biome: Record<string, string[]>;
  phase: Record<string, string[]>;
  misc: string[];
}

const WIZARD: VoiceBank = {
  name: "the wizard",
  greet: [
    "Ah — a wanderer. The substrate stirs when you walk.",
    "You again. Or you for the first time. The binding is the same.",
    "Welcome. Everything here is one world, differently unfolded.",
  ],
  biome: {
    meadow: ["This meadow is a superposition the flowers keep resolving.", "Netzach routes through here. Can you feel the green?"],
    forest: ["The trees compose themselves. Nobody placed them — they were always implied by the seed.", "Deep roots, deep bindings."],
    mountain: ["Geburah's country. Stone says no, and the saying shapes you.", "The ridge remembers being a number."],
    desert: ["Malkuth, stripped bare. The kingdom is what remains when moisture unbinds.", "Even sand composes."],
    frozen: ["Binah holds this ice — understanding, frozen until you ask it something.", "Cold is just a slow answer."],
    coastline: ["Yesod laps at the shore. Foundation under water under light.", "The sea is the cleanup operation that never converges."],
  },
  phase: {
    night: ["The stars are the same algebra, further away.", "Night is when the world saves itself."],
    dawn: ["Dawn — the daily rebind.", "Watch: the sun unbinds the dark."],
    noon: ["At noon the shadows are honest."],
  },
  misc: [
    "Try the slash key. Speak a thing and the world will hold it.",
    "The portal hums. The library on the other side is mostly real.",
    "I have seen the Oracle dream. It routes everything through ten gates.",
  ],
};

const VILLAGER: VoiceBank = {
  name: "the villager",
  greet: ["Hello, wanderer.", "Oh! You startled me.", "Fine weather for walking."],
  biome: {
    meadow: ["The flowers are good this season. Pick one if you like.", "I come here when the workshop gets loud."],
    forest: ["Mind the trees — easy to lose your way. The glowing beam marks home.", "Mushrooms by the roots. Some are even safe."],
    mountain: ["Rough country up here. I keep to the valley.", "They say the ridge sings when the wind is right."],
    desert: ["Hot. Bring water if you go further.", "The cacti manage. I don't know how."],
    frozen: ["Bitter cold. Keep moving.", "Ice like glass. Pretty, in a hostile way."],
    coastline: ["I like the water. It doesn't go anywhere, and neither do I.", "Palm fronds make decent roofs."],
  },
  phase: {
    night: ["You should be near a lantern this late.", "Stars are out. The wizard names them strange names."],
    dawn: ["Early start, eh?"],
    noon: ["Midday already? Time runs when you wander."],
  },
  misc: [
    "The workshop can build almost anything you can say.",
    "The wizard talks in riddles, but he's harmless. Probably.",
    "I once said 'a marble temple' near the workshop. Now there's a marble temple.",
  ],
};

const BANKS: Record<string, VoiceBank> = {
  wizard_npc: WIZARD,
  guard_npc: VILLAGER,
  merchant_npc: { ...VILLAGER, name: "the merchant", greet: ["Looking to trade? Someday. Stock's still... conceptual.", "A customer! Almost."] },
  scholar_npc: { ...VILLAGER, name: "the scholar", greet: ["Shh — reading.", "Did you know each chunk is a superposed vector? It's all in the library."] },
};

function pick<T>(arr: T[] | undefined, rnd: () => number): T | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(rnd() * arr.length)];
}

export class DialogueBox {
  private root: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private textEl: HTMLDivElement;
  private metaEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private _open = false;
  private oracle: FrontendOracle | null;
  private seq = 0;
  private lineCount = 0;
  private currentNpc: { id: string; prototypeId: string } | null = null;
  private rnd = Math.random;

  private inputEl: HTMLInputElement;
  private lastCtx: DialogueContext | null = null;
  private lastTopic: string | null = null;
  onFocusChange: ((typing: boolean) => void) | null = null;

  // Live-substrate fallback for the downloaded client: when no local holon
  // /query endpoint is reachable, NPC lines come from the public
  // {agentChatBase}/api/agent/{archetype}/chat route (the same holon, served
  // over TLS). Set by main.ts; null disables the fallback (procedural only).
  agentChatBase: string | null = null;
  private static PROTO_ARCHETYPE: Record<string, string> = {
    wizard_npc: "apollo", scholar_npc: "athena",
    merchant_npc: "hermes", guard_npc: "ares",
  };

  private static TOPIC_STOP = new Set([
    "what", "where", "who", "whose", "how", "why", "when", "which", "can",
    "could", "should", "would", "will", "is", "are", "am", "do", "does",
    "did", "tell", "me", "about", "you", "your", "the", "a", "an", "i",
    "it", "this", "that", "of", "to", "in", "and", "or", "my", "we", "us",
    "be", "there", "here",
  ]);

  private static topicOf(text: string): string | null {
    for (const w of text.toLowerCase().split(/[^a-z']+/)) {
      if (w && !DialogueBox.TOPIC_STOP.has(w)) return w;
    }
    return null;
  }

  constructor(parent: HTMLElement, oracle: FrontendOracle | null) {
    this.oracle = oracle;
    this.root = document.createElement("div");
    this.root.id = "dialogue-box";
    this.root.classList.add("hidden");
    this.nameEl = document.createElement("div");
    this.nameEl.id = "dialogue-name";
    this.textEl = document.createElement("div");
    this.textEl.id = "dialogue-text";
    this.metaEl = document.createElement("div");
    this.metaEl.id = "dialogue-meta";
    this.inputEl = document.createElement("input");
    this.inputEl.id = "dialogue-input";
    this.inputEl.type = "text";
    this.inputEl.placeholder = "say something… (Enter)";
    this.inputEl.autocomplete = "off";
    this.hintEl = document.createElement("div");
    this.hintEl.id = "dialogue-hint";
    this.hintEl.textContent = "type and press Enter · E — more · Esc — leave";
    this.root.append(this.nameEl, this.textEl, this.metaEl, this.inputEl, this.hintEl);
    parent.appendChild(this.root);

    // Typing must not move the player: suspend the keyboard while focused.
    this.inputEl.addEventListener("focus", () => this.onFocusChange?.(true));
    this.inputEl.addEventListener("blur", () => this.onFocusChange?.(false));
    this.inputEl.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const said = this.inputEl.value.trim();
        if (said && this.lastCtx) {
          this.inputEl.value = "";
          this.ask(said, this.lastCtx);
        }
      } else if (e.key === "Escape") {
        this.inputEl.blur();
        this.close();
      }
    });
  }

  isOpen(): boolean { return this._open; }
  npcId(): string | null { return this.currentNpc?.id ?? null; }

  open(npc: { id: string; prototypeId: string }, ctx: DialogueContext): void {
    this.currentNpc = npc;
    this._open = true;
    this.lineCount = 0;
    this.lastCtx = ctx;
    this.lastTopic = null;   // a new conversation starts with no history
    this.root.classList.remove("hidden");
    this.say(ctx);
    // Focus the input so conversation is one keystroke away.
    setTimeout(() => this.inputEl.focus(), 50);
  }

  /** The NPC's short name in the corpus register ("wizard", "villager"…). */
  private npcWord(): string {
    const bank = BANKS[this.currentNpc?.prototypeId ?? ""] ?? VILLAGER;
    return bank.name.replace(/^the\s+/, "");
  }

  /** Compose the holon address: must mirror wander_game_corpus.txt exactly —
   *  `in the {biome} at {phase} the wanderer said , {q} {npc} said ,`
   *  The short tag keeps the question's content words inside the holon's
   *  deep address window, so answers track the question. */
  private seedFor(playerWords: string, ctx: DialogueContext): string {
    const q = playerWords.toLowerCase().replace(/[^a-z'.,;:!? ]+/g, " ").trim();
    // Sentence-final punctuation is part of the holon address: questions end
    // "?" and statements end "." in the corpus, so guessing wrong shifts the
    // bucket. Only interrogative openers get the question mark.
    const interrogative = /^(what|where|who|whose|how|why|when|which|can|could|should|would|will|is|are|am|do|does|did|tell me|may)\b/.test(q);
    const punctuated = /[.!?]$/.test(q) ? q : q + (interrogative ? " ?" : " .");
    // Multi-turn: the previous exchange's topic rides as a history clause —
    // the server's order-3 chain nodes (and pronoun inheritance) consume it.
    const history = this.lastTopic ? `after speaking of ${this.lastTopic} , ` : "";
    return `${history}in the ${ctx.biome} at ${ctx.phase} the wanderer said , ${punctuated} ` +
           `${this.npcWord()} said ,`;
  }

  /** Does the player want to know what's been built? Grounded in the live
   *  world, not the corpus — the holon can't know what was spoken today. */
  private static STRUCT_Q =
    /\b(what|which|any(thing)?|where)\b.*\b(built|builds?|buildings?|structures?|see|around|near(by)?|standing)\b|\bwhat('s| is) (here|around|nearby)\b/i;

  private structureAnswer(ctx: DialogueContext): string | null {
    if (!ctx.structures) {
      return this.currentNpc?.prototypeId === "wizard_npc"
        ? "Nothing stands near us yet. Speak, and the world will hold it."
        : "Nothing built around here yet. Try saying something — the world listens.";
    }
    return this.currentNpc?.prototypeId === "wizard_npc"
      ? `The world holds what was spoken: ${ctx.structures}.`
      : `Let me look — there's ${ctx.structures}.`;
  }

  /** Player typed something — ask the holon as the NPC. */
  ask(playerWords: string, ctx: DialogueContext): void {
    if (!this.currentNpc) return;
    this.lastCtx = ctx;
    const bank = BANKS[this.currentNpc.prototypeId] ?? VILLAGER;
    this.nameEl.textContent = bank.name;
    const mySeq = ++this.seq;
    const fallback = () => this.show(this.offlineLine(bank, ctx));

    // World-state questions are answered from the world, not the holon.
    if (DialogueBox.STRUCT_Q.test(playerWords)) {
      const grounded = this.structureAnswer(ctx);
      if (grounded) {
        this.textEl.textContent = `"${grounded}"`;
        this.metaEl.textContent = "✦ world state";
        this.lastTopic = "the buildings";
        this.lineCount++;
        return;
      }
    }

    if (this.oracle && this.oracle.available) {
      this.textEl.textContent = "…";
      this.metaEl.textContent = "";
      this.oracle.client.query(this.seedFor(playerWords, ctx), { maxTokens: 30, temperature: 0.42 })
        .then((r) => {
          if (mySeq !== this.seq || !this._open) return;
          const text = (r.text || "").trim();
          if (text.length > 2) {
            this.textEl.textContent = `"${text}"`;
            this.metaEl.textContent = `✦ routed ${r.routed_sephirah}`;
            this.lastTopic = DialogueBox.topicOf(playerWords) ?? this.lastTopic;
          } else {
            fallback();
          }
        })
        .catch(() => {
          if (mySeq !== this.seq || !this._open) return;
          fallback();
        });
    } else if (this.agentChatBase) {
      // Downloaded client: reach the live holon over the public TLS route.
      this.textEl.textContent = "…";
      this.metaEl.textContent = "";
      const arch = DialogueBox.PROTO_ARCHETYPE[this.currentNpc.prototypeId] ?? "hermes";
      const url = `${this.agentChatBase}/api/agent/${arch}/chat`
        + `?q=${encodeURIComponent(playerWords)}&n=40`;
      fetch(url, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (mySeq !== this.seq || !this._open) return;
          const text = (d.response || "").trim();
          if (text.length > 2) {
            this.textEl.textContent = `"${text}"`;
            this.metaEl.textContent = `✦ ${arch}${d.routed_sephirah ? " · " + d.routed_sephirah : ""}`;
            this.lastTopic = DialogueBox.topicOf(playerWords) ?? this.lastTopic;
          } else {
            fallback();
          }
        })
        .catch(() => {
          if (mySeq !== this.seq || !this._open) return;
          fallback();
        });
    } else {
      fallback();
    }
    this.lineCount++;
  }

  /** Ambient questions E cycles through — families the corpus covers densely. */
  private static AMBIENT: string[] = [
    "hello .", "what is this place ?", "what do you see around here ?",
    "what should i do ?", "tell me about this land ?", "what is the portal ?",
    "who are you ?",
  ];

  /** Next line (E while open) — asks an ambient question on the player's behalf. */
  say(ctx: DialogueContext): void {
    if (!this.currentNpc) return;
    this.lastCtx = ctx;
    const q = DialogueBox.AMBIENT[this.lineCount % DialogueBox.AMBIENT.length];
    this.ask(q, ctx);
  }

  private show(line: string): void {
    this.textEl.textContent = `"${line}"`;
    this.metaEl.textContent = "";
  }

  private offlineLine(bank: VoiceBank, ctx: DialogueContext): string {
    // First line greets; later lines rotate biome → phase → misc.
    if (this.lineCount === 0) return pick(bank.greet, this.rnd) ?? "...";
    const pools: Array<string[] | undefined> = [
      bank.biome[ctx.biome],
      bank.phase[ctx.phase],
      bank.misc,
    ];
    const pool = pools[this.lineCount % pools.length] ?? bank.misc;
    return pick(pool, this.rnd) ?? pick(bank.misc, this.rnd) ?? "...";
  }

  close(): void {
    this._open = false;
    this.currentNpc = null;
    this.root.classList.add("hidden");
  }
}
