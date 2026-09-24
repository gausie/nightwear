// @ts-check
const {
  availableAmount,
  canEquip,
  Effect,
  Familiar,
  haveEffect,
  haveSkill,
  Item,
  maximize,
  mpCost,
  myAdventures,
  myMp,
  numericModifier,
  print,
  Slot,
  toSkill,
  toSlot,
  useSkill,
  weaponHands,
  haveFamiliar,
} = require("kolmafia");

/** @typedef {{ item: Item, slot: string, adv: number, fites: number, wearable: boolean }} Piece */
/** @typedef {{ adv: number, cost: number, items: Item[] }} Option */

const ROLLOVER_CAP = 200;

/** Speculative maximizer runs to spend looking for a workable set. */
const PROBE_LIMIT = 30;

/** Slots worth filling, named as toSlot() reports them - every accessory is acc1. */
const SLOT_KEYS = [
  "hat",
  "back",
  "shirt",
  "weapon",
  "off-hand",
  "pants",
  "acc1",
  "familiar",
];

/**
 * How many items each toSlot() key can hold. Anything absent holds one.
 *
 * @type {Record<string, number>}
 */
const CAPACITY = { acc1: 3 };

/**
 * Doubles the enchantments of whatever is in an off-hand, ours and the
 * Left-Hand Man's alike, so an off-hand under it is worth two slots.
 */
const OFFHAND_REMARKABLE = Effect.get("Offhand Remarkable");

/**
 * Familiars that hold an ordinary weapon or off-hand in the familiar slot and
 * enchant us with it, which is worth most of a whole extra slot.
 *
 * Mad Hatrack and Fancypants Scarecrow carry hats and pants the same way and
 * are deliberately absent: those two are the one case where none of the carried
 * item's enchantments reach us - KoLCharacter.addItemAdjustment returns early
 * for a hat or pants in the familiar slot - so they can only cost us whatever
 * else the familiar would have held.
 */
const CARRIERS = [
  Familiar.get("Disembodied Hand"),
  Familiar.get("Left-Hand Man"),
];

/**
 * @param {Item} it
 * @returns {number}
 */
function advOf(it) {
  return numericModifier(it, "Adventures");
}

/**
 * @param {Item} it
 * @returns {number}
 */
function fitesOf(it) {
  return numericModifier(it, "PvP Fights");
}

/**
 * @param {Item} it
 * @returns {string}
 */
function slotKey(it) {
  return String(toSlot(it));
}

/**
 * @param {Piece} a
 * @param {Piece} b
 * @returns {number}
 */
function byFitesDesc(a, b) {
  return b.fites - a.fites;
}

/**
 * Everything we own that carries adventures or fights in a slot we care about.
 *
 * `wearable` is whether we could put it on right now, which for familiar
 * equipment means the familiar currently out can wear it. Pieces that fail it
 * are kept anyway - a costume we can't use is the whole reason to consider a
 * familiar we haven't taken.
 *
 * @param {Set<string>} excludedSlots
 * @returns {Piece[]}
 */
function ownedGear(excludedSlots) {
  /** @type {Piece[]} */
  const pieces = [];
  const all = Item.all();
  for (let i = 0; i < all.length; i++) {
    let it = all[i];
    if (availableAmount(it) === 0) continue;
    let slot = slotKey(it);
    if (SLOT_KEYS.indexOf(slot) < 0) continue;
    if (excludedSlots.has(slot)) continue;
    let adv = advOf(it);
    let fites = fitesOf(it);
    if (adv <= 0 && fites <= 0) continue;
    pieces.push({
      item: it,
      slot: slot,
      adv: adv,
      fites: fites,
      wearable: canEquip(it),
    });
  }
  return pieces;
}

/**
 * Is Offhand Remarkable up, casting it if it isn't and it would pay?
 *
 * It pays whenever an off-hand we could wear carries something this run is
 * optimising for. Adventures only count towards that while we still need some:
 * at the cap every slot is spent on fights, so an off-hand with nothing but
 * adventures on it has nothing to double.
 *
 * Reaching the skill through the effect rather than naming it keeps the one
 * fact we depend on - what the effect does - in one place, and picks up any
 * other source of it for free.
 *
 * @param {Piece[]} gear
 * @param {number} target
 * @returns {boolean}
 */
function offhandRemarkable(gear, target) {
  if (haveEffect(OFFHAND_REMARKABLE) > 0) return true;

  let worth = false;
  for (let i = 0; i < gear.length; i++) {
    let piece = gear[i];
    if (piece.slot !== "off-hand" || !piece.wearable) continue;
    if (piece.fites > 0 || (target > 0 && piece.adv > 0)) {
      worth = true;
      break;
    }
  }
  if (!worth) return false;

  const skill = toSkill(OFFHAND_REMARKABLE);
  if (!haveSkill(skill)) return false;
  if (skill.dailylimit === 0) return false;
  if (mpCost(skill) > myMp()) return false;

  useSkill(skill, 1);
  return haveEffect(OFFHAND_REMARKABLE) > 0;
}

/**
 * numericModifier() on an item reports what is stamped on it, so the doubling
 * is ours to apply. Nothing crosses zero, so no piece ownedGear() dropped for
 * carrying neither adventures nor fights would have been kept.
 *
 * @param {Piece[]} gear
 */
function doubleOffhands(gear) {
  for (let i = 0; i < gear.length; i++) {
    if (gear[i].slot !== "off-hand") continue;
    gear[i].adv *= 2;
    gear[i].fites *= 2;
  }
}

/**
 * Does `kept` already cover everything `reach` offers? The familiar slot holds
 * one item, so a familiar that can't beat what the one already out is allowed
 * to wear is a switch for nothing.
 *
 * @param {Piece[]} reach
 * @param {Piece[]} kept
 * @returns {boolean}
 */
function outclassed(reach, kept) {
  for (let i = 0; i < reach.length; i++) {
    let beaten = false;
    for (let j = 0; j < kept.length; j++) {
      if (kept[j].adv >= reach[i].adv && kept[j].fites >= reach[i].fites) {
        beaten = true;
        break;
      }
    }
    if (!beaten) return false;
  }
  return true;
}

/**
 * Familiars worth offering the maximizer, because they can hold gear the one
 * already out can't: every carrier we own, plus anything that can wear a piece
 * of familiar equipment we own and the current familiar can't match. The
 * Trick-or-Treating Tot and its li'l unicorn costume, +5 adv and +5 fites, is
 * the second kind in practice.
 *
 * @param {Piece[]} gear
 * @returns {Familiar[]}
 */
function candidates(gear) {
  /** @type {Familiar[]} */
  const out = [];
  /** @type {Record<string, boolean>} */
  const taken = {};
  for (let i = 0; i < CARRIERS.length; i++) {
    if (!haveFamiliar(CARRIERS[i]) || !canEquip(CARRIERS[i])) continue;
    taken[String(CARRIERS[i])] = true;
    out.push(CARRIERS[i]);
  }

  /** @type {Piece[]} */
  const famGear = [];
  /** @type {Piece[]} */
  const worn = [];
  for (let i = 0; i < gear.length; i++) {
    if (gear[i].slot !== "familiar") continue;
    famGear.push(gear[i]);
    if (gear[i].wearable) worn.push(gear[i]);
  }

  const all = Familiar.all();
  for (let i = 0; i < all.length; i++) {
    let fam = all[i];
    if (taken[String(fam)]) continue;
    if (!haveFamiliar(fam) || !canEquip(fam)) continue;

    /** @type {Piece[]} */
    let reach = [];
    for (let j = 0; j < famGear.length; j++) {
      if (canEquip(fam, famGear[j].item)) reach.push(famGear[j]);
    }
    if (outclassed(reach, worn)) continue;

    taken[String(fam)] = true;
    out.push(fam);
  }
  return out;
}

/**
 * Index combinations of `list` up to `maxSize`, including the empty one.
 *
 * @param {number} length
 * @param {number} maxSize
 * @returns {number[][]}
 */
function combinations(length, maxSize) {
  /** @type {number[][]} */
  let out = [[]];
  /** @type {number[][]} */
  let frontier = [[]];
  for (let size = 1; size <= maxSize; size++) {
    /** @type {number[][]} */
    let next = [];
    for (let i = 0; i < frontier.length; i++) {
      let combo = frontier[i];
      let start = combo.length > 0 ? combo[combo.length - 1] + 1 : 0;
      for (let j = start; j < length; j++) next.push(combo.concat([j]));
    }
    for (let i = 0; i < next.length; i++) out.push(next[i]);
    frontier = next;
  }
  return out;
}

/**
 * Most fights a slot can yield, given `forced` has to be worn in it.
 *
 * @param {Piece[]} pool every owned piece that lives in this slot
 * @param {number} capacity
 * @param {Piece[]} forced
 * @returns {number}
 */
function slotFites(pool, capacity, forced) {
  /** @type {Record<string, boolean>} */
  const spoken = {};
  let total = 0;
  for (let i = 0; i < forced.length; i++) {
    total += forced[i].fites;
    spoken[forced[i].item.name] = true;
  }

  /** @type {Piece[]} */
  const rest = [];
  for (let i = 0; i < pool.length; i++) {
    if (!spoken[pool[i].item.name]) rest.push(pool[i]);
  }
  rest.sort(byFitesDesc);

  const room = capacity - forced.length;
  for (let i = 0; i < room && i < rest.length; i++) {
    if (rest[i].fites <= 0) break;
    total += rest[i].fites;
  }
  return total;
}

/**
 * Every way one slot could carry adventure gear, priced in fights forgone:
 * what the slot would have yielded left alone, minus what it yields with the
 * adventure gear forced into it. An item carrying both pays its own way, which
 * is what makes a +4 adv / +4 fites worth more than a bare +9 adv.
 *
 * @param {Piece[]} inSlot
 * @param {string} slot
 * @returns {Option[]}
 */
function slotOptions(inSlot, slot) {
  const capacity = CAPACITY[slot] || 1;
  const base = slotFites(inSlot, capacity, []);

  /** @type {Piece[]} */
  const advPieces = [];
  for (let i = 0; i < inSlot.length; i++) {
    if (inSlot[i].adv <= 0) continue;
    // A two-hander forfeits the off-hand, which a slot-at-a-time model can't
    // express - and the off-hand is nearly always worth more than the trade.
    if (slot === "weapon" && weaponHands(inSlot[i].item) > 1) continue;
    advPieces.push(inSlot[i]);
  }

  /** @type {Option[]} */
  const options = [];
  const combos = combinations(advPieces.length, capacity);
  for (let i = 0; i < combos.length; i++) {
    let combo = combos[i];
    let adv = 0;
    /** @type {Piece[]} */
    let forced = [];
    /** @type {Item[]} */
    let items = [];
    for (let j = 0; j < combo.length; j++) {
      let piece = advPieces[combo[j]];
      adv += piece.adv;
      forced.push(piece);
      items.push(piece.item);
    }
    options.push({
      adv: adv,
      cost: base - slotFites(inSlot, capacity, forced),
      items: items,
    });
  }
  return options;
}

/**
 * Cheapest gear that covers `need` adventures, cheapest meaning fewest PvP
 * fights sacrificed. Exact: a slot-by-slot DP over adventures accumulated,
 * where ties go to whichever overshoots the cap by less.
 *
 * @param {Piece[]} pieces
 * @param {number} need
 * @returns {Item[]}
 */
function chooseGear(pieces, need) {
  if (need <= 0) return [];

  /** @type {Record<string, Piece[]>} */
  const bySlot = {};
  for (let i = 0; i < pieces.length; i++) {
    let piece = pieces[i];
    if (!bySlot[piece.slot]) bySlot[piece.slot] = [];
    bySlot[piece.slot].push(piece);
  }

  /** @type {({ cost: number, adv: number, items: Item[] } | null)[]} */
  let dp = [];
  for (let i = 0; i <= need; i++) dp.push(null);
  dp[0] = { cost: 0, adv: 0, items: [] };

  for (let s = 0; s < SLOT_KEYS.length; s++) {
    let slot = SLOT_KEYS[s];
    if (!bySlot[slot]) continue;
    let options = slotOptions(bySlot[slot], slot);
    let next = dp.slice();
    for (let a = 0; a <= need; a++) {
      let from = dp[a];
      if (from === null) continue;
      for (let o = 0; o < options.length; o++) {
        let option = options[o];
        if (option.items.length === 0) continue;
        let reached = Math.min(need, a + option.adv);
        let cost = from.cost + option.cost;
        let adv = from.adv + option.adv;
        let current = next[reached];
        if (
          current === null ||
          cost < current.cost ||
          (cost === current.cost && adv < current.adv)
        ) {
          next[reached] = { cost: cost, adv: adv, items: from.items.concat(option.items) };
        }
      }
    }
    dp = next;
  }

  const solved = dp[need];
  if (solved !== null) return solved.items;

  // Can't get there. Wear whatever gets closest so the caller can report it.
  for (let a = need - 1; a > 0; a--) {
    let closest = dp[a];
    if (closest !== null) return closest.items;
  }
  return [];
}

/**
 * @param {Familiar[]} offered
 * @returns {string[]}
 */
function switches(offered) {
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < offered.length; i++) out.push(`+"switch ${offered[i]}"`);
  return out;
}

/**
 * @param {Item[]} pinned
 * @param {Familiar[]} offered
 * @param {number} target
 * @param {string[]} excluded
 * @returns {string}
 */
function expressionFor(pinned, offered, target, excluded) {
  return [
    // Weight 0: the min is a pure feasibility check. Any weight here would put
    // us back to adv gear crowding fites out of the shortlist.
    "0 adv",
    `${target} min`,
    "1 fites",
    // Quoted whole, so item names containing a comma still parse.
    ...pinned.map((item) => `+"equip ${item.name}"`),
    // Offered rather than chosen for it: "switch" only adds a familiar to the
    // ones weighed, and the maximizer prices a carrier's extra slot against the
    // whole outfit far better than anything we could work out slot by slot.
    // Offering all of them at once matters - given only the Left-Hand Man it
    // settles for 15 fewer fights than it finds with the others on the table.
    ...switches(offered),
    ...excluded,
  ].join(", ");
}

/**
 * Fewest adventures we need to buy with pinned gear for the outfit to clear the
 * target, found by asking the maximizer rather than predicting it.
 *
 * Predicting meant subtracting what is worn in each slot from the current
 * Adventures modifier, which needs a correct list of every slot the maximizer
 * might touch. Too low and we over-pin and waste slots; too high and we
 * under-pin, the maximizer trades our adventures away for fights, and the run
 * fails - and the answer shifted between runs as gear moved around. Speculating
 * changes no equipment, so binary search it instead.
 *
 * A probe can fail because the set falls short, but also because it simply
 * can't be worn: MaximizerSpeculation fails anything introducing a new mutex
 * violation, quite apart from the min. So a failure means "try a different
 * set", never "the answer is bigger" - which rules out a binary search, since
 * unwearable sets cluster at the wide end and it would walk away from the
 * workable narrow ones. Ascending instead, so the first set that works is also
 * the cheapest that works, and no narrower candidate is ever skipped.
 *
 * Pinning less is what leaves room for a familiar to be worth switching to, so
 * ascending finds those too: pin the familiar slot and a carrier has nowhere to
 * put its hands.
 *
 * @param {Piece[]} pieces
 * @param {Familiar[]} offered
 * @param {number} target
 * @param {string[]} excluded
 * @returns {string | null} null if even everything we own falls short
 */
function solve(pieces, offered, target, excluded) {
  let ceiling = 0;
  for (let i = 0; i < pieces.length; i++) ceiling += pieces[i].adv;

  /** @type {Record<string, boolean>} */
  const tried = {};
  let probes = 0;
  for (let need = 0; need <= ceiling; need++) {
    let candidate = expressionFor(chooseGear(pieces, need), offered, target, excluded);
    // Consecutive needs usually want the same gear; only pay for new ones.
    if (tried[candidate] !== undefined) continue;
    if (probes++ >= PROBE_LIMIT) break;
    tried[candidate] = maximize(candidate, true);
    if (tried[candidate]) return candidate;
  }
  return null;
}

/**
 * Top up to exactly the 200 adventure rollover cap, then spend every remaining
 * slot on PvP fights. The maximizer can't do this in one expression, so we
 * achieve it in code. It will change familiar where that buys a slot, and cast
 * Offhand Remarkable where an off-hand is worth doubling.
 *
 * @param {string} [args] Maximizer slot exclusions, e.g. "-hat".
 */
module.exports.main = function main(args) {
  const excluded = (args || "").split(/\s+/).filter((s) => s.length > 0);
  const excludedSlots = new Set(
    excluded.map((s) => String(Slot.get(s.replace(/^-/, "")))),
  );

  const target = Math.max(0, ROLLOVER_CAP - myAdventures());
  const gear = ownedGear(excludedSlots);
  // Before anything is weighed, so both the maximizer and our own arithmetic
  // price off-hands at what they will actually be worth.
  if (offhandRemarkable(gear, target)) {
    doubleOffhands(gear);
    print("Offhand Remarkable is up, so off-hands count double.", "blue");
  }
  const offered = excludedSlots.has("familiar") ? [] : candidates(gear);
  const wearable = gear.filter((piece) => piece.wearable);
  // With a familiar on offer the familiar slot is theirs to bid for, so we stop
  // pinning it: a carrier can only earn the slot if the slot is free, and the
  // maximizer prices that against the rest of the outfit better than we can.
  // Pinning the +4 adv / +4 fites there looks free to us and costs 15 fights.
  const pool = offered.length > 0
    ? wearable.filter((piece) => piece.slot !== "familiar")
    : wearable;
  const expression = solve(pool, offered, target, excluded);

  if (expression !== null) {
    print(expression);
    maximize(expression, false);
    // Judge by what we ended up in rather than by what maximize() returned: a
    // familiar switch makes it lie both ways, reporting success having equipped
    // the familiar's half of the outfit and then dropped it. Asking again with
    // the familiar already changed settles it.
    if (numericModifier("Adventures") < target) maximize(expression, false);
  }

  if (numericModifier("Adventures") < target) {
    // The pinned set turned out to be unwearable together: a two-handed weapon
    // alongside an off-hand, a mutex pair, an outfit conflict. Rather than
    // model all of that, hand the whole problem to the maximizer unaided. It
    // overshoots - one item is never near the cap when the shortlist is built,
    // so weighted adv gear wins every slot - but it does get there.
    print("No workable pinned set, letting the maximizer solve it.", "red");
    const fallback = [
      "100 adv",
      `${target} max`,
      `${target} min`,
      "1 fites",
      ...switches(offered),
      ...excluded,
    ].join(", ");
    maximize(fallback, false);
    if (numericModifier("Adventures") < target) {
      print(`Couldn't reach ${target} rollover adventures, closest fit equipped.`, "red");
    }
  }

  const adv = numericModifier("Adventures");
  // target 0 means we're already past 200 in hand, so "over" is meaningless.
  const note = target === 0 ? "already at the cap" : `${Math.max(0, adv - target)} over the cap`;
  print(
    `Rollover: ${adv} adv (${note}), ${numericModifier("PvP Fights")} fites.`,
    "blue",
  );
};
