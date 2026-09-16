/**
 * RunRules — the modifiers one run is played under.
 *
 * This is the spine that keeps content data-driven: weekly mutators, tournaments and equipment are
 * all just lists of `Effect`s over these fields, so a new event needs a data entry, never a new
 * branch in a system. Every field is a plain number with a neutral default (1 for multipliers,
 * 0 for counters), and every field is READ by exactly one owner system — a rule nobody reads is
 * dead weight and must not be added here.
 *
 * Rules are resolved once, before the run starts, and then treated as read-only by the sim, so a
 * run stays reproducible from (seed, rules, input timeline). They deliberately do NOT mutate the
 * tuning registry: tuning is the designer's baseline, rules are this run's deviation from it.
 */

export interface RunRules {
  // ---- score & economy ------------------------------------------------------------------
  /** Coins banked per coin picked up. */
  coinValue: number;
  /** Final multiplier on every point scored. */
  scoreMul: number;
  /** Extra score points per coin (challenges where coins ARE the score). */
  coinScoreBonus: number;
  /** Scales the combo bonus curve. */
  comboScoreMul: number;
  /** Scales near-miss and perfect-dodge awards. */
  skillScoreMul: number;
  /** Extra score fraction while at (near) top speed — the sword's payoff. */
  highSpeedScoreBonus: number;
  /** Score burst after a run of clean perfect dodges — the dagger's payoff. */
  perfectStreakBonus: number;
  /** 1 = the permanent guild multiplier counts; 0 = normalised (seeded competitive modes). */
  guildMultiplier: number;
  /** 1 = shop power-up upgrades count; 0 = normalised (seeded competitive modes). */
  upgrades: number;

  // ---- power-ups ------------------------------------------------------------------------
  powerupDurationMul: number;
  magnetDurationMul: number;
  griffinDurationMul: number;
  bootsDurationMul: number;
  blessingDurationMul: number;
  aegisDurationMul: number;
  hourglassDurationMul: number;
  /** How often a pickup appears in the gap after a pattern. */
  pickupChanceMul: number;
  magnetReachMul: number;
  /** Highlights upcoming pickups on the HUD — the wizard's eye. */
  revealPickups: number;

  // ---- defence --------------------------------------------------------------------------
  /** Crashes absorbed outright at the start of the run (heavy armour). */
  shieldCharges: number;
  /** Stumbles swallowed before they can reach the chaser (chainmail). */
  stumbleAbsorbs: number;
  /** Low barricades smashed through instead of crashing (hammer). */
  breakLowBarriers: number;
  /** Chance a breakable obstacle shatters instead of ending the run (bow). */
  breakChance: number;
  /** Chance a crash is survived outright, once per run (horseshoe). */
  luckChance: number;
  mountDurationMul: number;
  /** 1 = the mount button works this run. */
  mountAllowed: number;
  /** How many revives the run may buy. */
  revivesAllowed: number;

  // ---- movement -------------------------------------------------------------------------
  jumpHeightMul: number;
  airTimeMul: number;
  /** Scales the whole speed curve. */
  speedMul: number;

  // ---- run structure --------------------------------------------------------------------
  /** Gap between spawned patterns (< 1 = denser). */
  obstacleGapMul: number;
  /** How far back the chaser sits (< 1 = breathing down your neck). */
  chaserGapMul: number;
  /** How often run events fire. */
  eventChanceMul: number;
  coinDensityMul: number;
  /** Ends the run after this many seconds (0 = no limit). */
  timeLimitSeconds: number;
  /** Difficulty the run starts at (0..1), for "starts hard" challenges. */
  startDifficulty: number;

  // ---- skill ----------------------------------------------------------------------------
  /** Scales how long a combo survives without a new action. */
  comboWindowMul: number;
}

export type RuleKey = keyof RunRules;

export type EffectOp = "mul" | "add" | "set";

/** One modifier a mutator or an equipped item applies to a run. */
export interface Effect {
  rule: RuleKey;
  /** Default "mul" — the common case for percentage trade-offs. */
  op?: EffectOp;
  value: number;
}

/** Neutral rules: a plain run with nothing equipped and no mutators. */
export function defaultRules(): RunRules {
  return {
    coinValue: 1,
    scoreMul: 1,
    coinScoreBonus: 0,
    comboScoreMul: 1,
    skillScoreMul: 1,
    highSpeedScoreBonus: 0,
    perfectStreakBonus: 0,
    guildMultiplier: 1,
    upgrades: 1,

    powerupDurationMul: 1,
    magnetDurationMul: 1,
    griffinDurationMul: 1,
    bootsDurationMul: 1,
    blessingDurationMul: 1,
    aegisDurationMul: 1,
    hourglassDurationMul: 1,
    pickupChanceMul: 1,
    magnetReachMul: 1,
    revealPickups: 0,

    shieldCharges: 0,
    stumbleAbsorbs: 0,
    breakLowBarriers: 0,
    breakChance: 0,
    luckChance: 0,
    mountDurationMul: 1,
    mountAllowed: 1,
    revivesAllowed: 3,

    jumpHeightMul: 1,
    airTimeMul: 1,
    speedMul: 1,

    obstacleGapMul: 1,
    chaserGapMul: 1,
    eventChanceMul: 1,
    coinDensityMul: 1,
    timeLimitSeconds: 0,
    startDifficulty: 0,

    comboWindowMul: 1,
  };
}

/**
 * Applies effects in order onto `rules` (mutated in place; pass a fresh `defaultRules()`).
 * `mul` stacks multiplicatively, `add` accumulates, `set` overrides — so two items granting
 * +10% coins give +21%, never +20% flat, and "no mount" (set 0) survives later multipliers.
 */
export function applyEffects(rules: RunRules, effects: readonly Effect[] | undefined): RunRules {
  if (!effects) return rules;
  for (const e of effects) {
    const current = rules[e.rule];
    if (typeof current !== "number") continue;
    switch (e.op ?? "mul") {
      case "add":
        rules[e.rule] = current + e.value;
        break;
      case "set":
        rules[e.rule] = e.value;
        break;
      default:
        rules[e.rule] = current * e.value;
        break;
    }
  }
  return rules;
}

/** Resolves a run's rules from any number of effect lists (mode mutators, equipment, …). */
export function resolveRules(...sources: ReadonlyArray<readonly Effect[] | undefined>): RunRules {
  const rules = defaultRules();
  for (const list of sources) applyEffects(rules, list);
  return clampRules(rules);
}

/**
 * Keeps stacked effects inside sane bounds. Builds are meant to bend the run, not break it: an
 * unlucky stack of multipliers must never produce a negative duration or an unplayable speed.
 */
export function clampRules(rules: RunRules): RunRules {
  rules.coinValue = clamp(rules.coinValue, 0, 10);
  rules.scoreMul = clamp(rules.scoreMul, 0, 10);
  rules.coinScoreBonus = clamp(rules.coinScoreBonus, 0, 1000);
  rules.comboScoreMul = clamp(rules.comboScoreMul, 0, 10);
  rules.skillScoreMul = clamp(rules.skillScoreMul, 0, 10);
  rules.highSpeedScoreBonus = clamp(rules.highSpeedScoreBonus, 0, 2);
  rules.perfectStreakBonus = clamp(rules.perfectStreakBonus, 0, 5);
  rules.guildMultiplier = rules.guildMultiplier >= 0.5 ? 1 : 0;
  rules.upgrades = rules.upgrades >= 0.5 ? 1 : 0;

  for (const key of DURATION_KEYS) rules[key] = clamp(rules[key], 0.25, 4);
  rules.pickupChanceMul = clamp(rules.pickupChanceMul, 0, 8);
  rules.magnetReachMul = clamp(rules.magnetReachMul, 0.25, 4);
  rules.revealPickups = rules.revealPickups >= 0.5 ? 1 : 0;

  rules.shieldCharges = Math.max(0, Math.round(rules.shieldCharges));
  rules.stumbleAbsorbs = Math.max(0, Math.round(rules.stumbleAbsorbs));
  rules.breakLowBarriers = Math.max(0, Math.round(rules.breakLowBarriers));
  rules.breakChance = clamp(rules.breakChance, 0, 1);
  rules.luckChance = clamp(rules.luckChance, 0, 1);
  rules.mountAllowed = rules.mountAllowed >= 0.5 ? 1 : 0;
  rules.revivesAllowed = clamp(Math.round(rules.revivesAllowed), 0, 3);

  rules.jumpHeightMul = clamp(rules.jumpHeightMul, 0.6, 2);
  rules.airTimeMul = clamp(rules.airTimeMul, 0.6, 2);
  rules.speedMul = clamp(rules.speedMul, 0.5, 2);

  rules.obstacleGapMul = clamp(rules.obstacleGapMul, 0.5, 3);
  rules.chaserGapMul = clamp(rules.chaserGapMul, 0.2, 3);
  rules.eventChanceMul = clamp(rules.eventChanceMul, 0, 8);
  rules.coinDensityMul = clamp(rules.coinDensityMul, 0, 6);
  rules.timeLimitSeconds = Math.max(0, rules.timeLimitSeconds);
  rules.startDifficulty = clamp(rules.startDifficulty, 0, 1);
  rules.comboWindowMul = clamp(rules.comboWindowMul, 0.25, 4);
  return rules;
}

const DURATION_KEYS = [
  "powerupDurationMul",
  "magnetDurationMul",
  "griffinDurationMul",
  "bootsDurationMul",
  "blessingDurationMul",
  "aegisDurationMul",
  "hourglassDurationMul",
  "mountDurationMul",
] as const satisfies readonly RuleKey[];

function clamp(v: number, min: number, max: number): number {
  return !Number.isFinite(v) ? min : v < min ? min : v > max ? max : v;
}

// ---------------------------------------------------------------------------- presentation

/** pt-BR label for every rule, so item and mutator descriptions are generated from the data. */
const RULE_LABELS: Record<RuleKey, string> = {
  coinValue: "moedas",
  scoreMul: "pontos",
  coinScoreBonus: "pontos por moeda",
  comboScoreMul: "bônus de combo",
  skillScoreMul: "bônus de perícia",
  highSpeedScoreBonus: "pontos em alta velocidade",
  perfectStreakBonus: "bônus de esquiva perfeita",
  guildMultiplier: "multiplicador da guilda",
  upgrades: "melhorias da loja",
  powerupDurationMul: "duração de poderes",
  magnetDurationMul: "duração do amuleto",
  griffinDurationMul: "duração do grifo",
  bootsDurationMul: "duração das botas",
  blessingDurationMul: "duração da bênção",
  aegisDurationMul: "duração do escudo",
  hourglassDurationMul: "duração da ampulheta",
  pickupChanceMul: "frequência de poderes",
  magnetReachMul: "alcance do amuleto",
  revealPickups: "revela poderes à frente",
  shieldCharges: "proteção contra queda",
  stumbleAbsorbs: "tropeços absorvidos",
  breakLowBarriers: "barricadas destruídas",
  breakChance: "chance de quebrar obstáculo",
  luckChance: "chance de escapar de uma queda",
  mountDurationMul: "duração da montaria",
  mountAllowed: "montaria",
  revivesAllowed: "reerguimentos",
  jumpHeightMul: "altura do salto",
  airTimeMul: "tempo no ar",
  speedMul: "velocidade",
  obstacleGapMul: "espaço entre obstáculos",
  chaserGapMul: "distância do perseguidor",
  eventChanceMul: "frequência de eventos",
  coinDensityMul: "quantidade de moedas",
  timeLimitSeconds: "tempo de corrida",
  startDifficulty: "dificuldade inicial",
  comboWindowMul: "janela de combo",
};

/** Rules where a bigger number is worse for the player, so the UI can colour them correctly. */
const LOWER_IS_BETTER: ReadonlySet<RuleKey> = new Set<RuleKey>(["speedMul", "startDifficulty"]);

/** One short pt-BR line for an effect, e.g. "+15% moedas" or "−5% pontos". */
export function describeEffect(e: Effect): string {
  const label = RULE_LABELS[e.rule];
  const op = e.op ?? "mul";
  if (op === "mul") {
    const pct = Math.round((e.value - 1) * 100);
    if (pct === 0) return "";
    return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}% ${label}`;
  }
  if (op === "add") {
    if (e.value === 0) return "";
    const v = Number.isInteger(e.value) ? String(Math.abs(e.value)) : `${Math.round(Math.abs(e.value) * 100)}%`;
    return `${e.value > 0 ? "+" : "−"}${v} ${label}`;
  }
  if (e.value === 0) return `sem ${label}`;
  return `${label}: ${e.value}`;
}

/** True when the effect helps the player (for colouring trade-offs in the arsenal). */
export function isEffectPositive(e: Effect): boolean {
  const better = (e.op ?? "mul") === "mul" ? e.value > 1 : e.value > 0;
  return LOWER_IS_BETTER.has(e.rule) ? !better : better;
}

/** Every effect line of an item, dropping no-ops. */
export function describeEffects(effects: readonly Effect[]): string[] {
  return effects.map(describeEffect).filter((s) => s.length > 0);
}
