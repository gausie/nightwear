// @ts-check
const {
  allNormalOutfits,
  availableAmount,
  canEquip,
  Effect,
  Familiar,
  haveEffect,
  haveOutfit,
  haveSkill,
  Item,
  maximize,
  mpCost,
  myAdventures,
  myMp,
  numericModifier,
  outfitPieces,
  print,
  Slot,
  toSkill,
  toSlot,
  useSkill,
  weaponHands,
  haveFamiliar,
} = require("kolmafia");

/** @typedef {{ item: Item, slot: string, adv: number, fites: number, wearable: boolean, hands: number }} Piece */
/** @typedef {{ adv: number, cost: number, items: Item[] }} Option */
/** @typedef {{ name: string, adv: number, fites: number, pieces: Piece[], blocks: string[] }} EquipmentSet */
/** @typedef {{ cost: number, adv: number, items: Item[] }} Plan */

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
 * How many items `slot` holds. Anything absent from CAPACITY holds one.
 *
 * @param {string} slot
 * @returns {number}
 */
function capacityOf(slot) {
  return CAPACITY[slot] || 1;
}

/**
 * A slot we fill, and one we were not told to leave alone.
 *
 * @param {string} slot
 * @param {Set<string>} excludedSlots
 * @returns {boolean}
 */
function usableSlot(slot, excludedSlots) {
  return SLOT_KEYS.indexOf(slot) >= 0 && !excludedSlots.has(slot);
}

/**
 * Needs both hands, so the off-hand goes with it. A model pricing one slot at a
 * time can't express that, so a two-hander is never among a slot's own options:
 * the only way to wear one is as an equipment set that blocks the off-hand.
 *
 * @param {Piece} piece
 * @returns {boolean}
 */
function twoHanded(piece) {
  return piece.slot === "weapon" && piece.hands > 1;
}

/**
 * Slots an equipment set takes without filling: a two-hander forfeits the
 * off-hand.
 * Blocking the slot rather than refusing the set is what makes a two-hander
 * wearable at all, and prices it at the fights the off-hand would have carried.
 * null for a set wanting both hands and an off-hand at once, which no amount of
 * pricing makes wearable.
 *
 * @param {Piece[]} pieces
 * @returns {string[] | null}
 */
function blockedSlots(pieces) {
  let hands = false;
  let offhand = false;
  for (let i = 0; i < pieces.length; i++) {
    if (twoHanded(pieces[i])) hands = true;
    if (pieces[i].slot === "off-hand") offhand = true;
  }
  if (!hands) return [];
  return offhand ? null : ["off-hand"];
}

/**
 * Which pieces are spoken for, by the name that identifies one.
 *
 * @param {Piece[]} pieces
 * @returns {Record<string, boolean>}
 */
function nameSet(pieces) {
  /** @type {Record<string, boolean>} */
  const spoken = {};
  for (let i = 0; i < pieces.length; i++) spoken[pieces[i].item.name] = true;
  return spoken;
}

/**
 * @param {Piece[]} pieces
 * @returns {Record<string, Piece[]>}
 */
function groupBySlot(pieces) {
  /** @type {Record<string, Piece[]>} */
  const bySlot = {};
  for (let i = 0; i < pieces.length; i++) {
    let piece = pieces[i];
    if (!bySlot[piece.slot]) bySlot[piece.slot] = [];
    bySlot[piece.slot].push(piece);
  }
  return bySlot;
}

/**
 * @param {Item} it
 * @returns {Piece}
 */
function pieceFor(it) {
  return {
    item: it,
    slot: slotKey(it),
    adv: advOf(it),
    fites: fitesOf(it),
    wearable: canEquip(it),
    hands: weaponHands(it),
  };
}

/**
 * The Piece for `it` in `pool`, or a fresh one if the pool has never heard of
 * it. Every piece the script weighs comes from here, so an item reached twice -
 * once as loose gear, once as part of an outfit - is one object, and whatever
 * is done to it afterwards lands everywhere it appears.
 *
 * @param {Piece[]} pool
 * @param {Item} it
 * @returns {Piece}
 */
function knownPiece(pool, it) {
  for (let i = 0; i < pool.length; i++) {
    if (pool[i].item.name === it.name) return pool[i];
  }
  return pieceFor(it);
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
    if (!usableSlot(slotKey(it), excludedSlots)) continue;
    let adv = advOf(it);
    let fites = fitesOf(it);
    if (adv <= 0 && fites <= 0) continue;
    // canEquip() is the expensive part, so it waits until the cheap filters
    // above have thrown out all but a few dozen of the game's items.
    pieces.push(pieceFor(it));
  }
  return pieces;
}

/**
 * Outfits whose completion bonus is worth chasing: every one we own all of, can
 * wear, and whose set bonus carries adventures or fights. Derived rather than
 * listed, so nothing here has to know it currently means Gladiatorial Glad
 * Rags, Time Trappings and Workoutfit.
 *
 * Pieces come out of `gear`, and anything it was missing goes into it, so an
 * outfit piece and the loose gear of the same item are one object.
 *
 * @param {Piece[]} gear
 * @param {Set<string>} excludedSlots
 * @returns {EquipmentSet[]}
 */
function bonusOutfits(gear, excludedSlots) {
  /** @type {EquipmentSet[]} */
  const out = [];
  const all = allNormalOutfits();
  for (let i = 0; i < all.length; i++) {
    let name = all[i];
    // "Outfit:" picks the set bonus rather than any item of the same name.
    let adv = numericModifier(`Outfit:${name}`, "Adventures");
    let fites = numericModifier(`Outfit:${name}`, "PvP Fights");
    if (adv <= 0 && fites <= 0) continue;
    // haveOutfit() is hasAllPieces(), ownership alone, so wearing it is ours
    // to check - the same standard the rest of the script holds gear to.
    if (!haveOutfit(name)) continue;

    let pieces = wearableSet(gear, outfitPieces(name), excludedSlots);
    if (pieces === null) continue;
    let blocks = blockedSlots(pieces);
    if (blocks === null) continue;

    out.push({
      name: name,
      adv: adv,
      fites: fites,
      pieces: pieces,
      blocks: blocks,
    });
  }
  return out;
}

/**
 * Every two-handed weapon worth a run of its own, each as an equipment set. A
 * two-hander costs the off-hand, which is the same shape as an outfit costing
 * the slots it fills, so it gets the same treatment: worn up front with the
 * off-hand blocked, and weighed against the run that left both slots free.
 *
 * Only ones carrying adventures. A two-hander we would wear for its fights
 * alone is the maximizer's business, not ours.
 *
 * @param {Piece[]} pieces
 * @returns {EquipmentSet[]}
 */
function twoHanders(pieces) {
  /** @type {EquipmentSet[]} */
  const out = [];
  for (let i = 0; i < pieces.length; i++) {
    let piece = pieces[i];
    if (!twoHanded(piece) || piece.adv <= 0) continue;
    out.push({
      name: piece.item.name,
      adv: 0,
      fites: 0,
      pieces: [piece],
      blocks: ["off-hand"],
    });
  }
  return out;
}

/**
 * The set as we would wear it, or null if we could not: a slot we don't fill or
 * were told to leave alone, or a piece we can't equip. Built a piece at a time
 * so a set that fails on its first piece doesn't pay to inspect the rest.
 *
 * A set we would wear joins `pool`, since its pieces are gear like any other -
 * blank ones included, which cost nothing to carry and are how a set whose
 * every adventure is the set bonus still has somewhere to live. A set we would
 * not wear leaves nothing behind.
 *
 * @param {Piece[]} pool
 * @param {Item[]} items
 * @param {Set<string>} excludedSlots
 * @returns {Piece[] | null}
 */
function wearableSet(pool, items, excludedSlots) {
  if (items.length === 0) return null;

  /** @type {Piece[]} */
  const pieces = [];
  for (let i = 0; i < items.length; i++) {
    let piece = knownPiece(pool, items[i]);
    if (!piece.wearable) return null;
    if (!usableSlot(piece.slot, excludedSlots)) return null;
    pieces.push(piece);
  }
  for (let i = 0; i < pieces.length; i++) {
    if (pool.indexOf(pieces[i]) < 0) pool.push(pieces[i]);
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
  const spoken = nameSet(forced);
  let total = 0;
  for (let i = 0; i < forced.length; i++) total += forced[i].fites;

  /** @type {Piece[]} */
  const rest = [];
  for (let i = 0; i < pool.length; i++) {
    if (spoken[pool[i].item.name]) continue;
    if (twoHanded(pool[i])) continue;
    rest.push(pool[i]);
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
 * Fights `slot` gives up by having `forced` worn in it, against what it would
 * have carried left to fights. `forced` null is a slot blocked outright, which
 * carries nothing at all.
 *
 * @param {Piece[]} pool every owned piece that lives in this slot
 * @param {string} slot
 * @param {Piece[] | null} forced
 * @returns {number}
 */
function slotCost(pool, slot, forced) {
  const capacity = capacityOf(slot);
  const kept = forced === null ? 0 : slotFites(pool, capacity, forced);
  return slotFites(pool, capacity, []) - kept;
}

/**
 * Every way one slot could carry adventure gear, priced in fights forgone:
 * what the slot would have yielded left alone, minus what it yields with the
 * adventure gear forced into it. An item carrying both pays its own way, which
 * is what makes a +4 adv / +4 fites worth more than a bare +9 adv.
 *
 * `claimed` is what an outfit has already put in this slot. It is worn either
 * way, so it belongs to the baseline rather than to any one option, and the
 * room left for adventure gear shrinks by however much of the slot it takes.
 *
 * @param {Piece[]} inSlot
 * @param {string} slot
 * @param {Piece[]} claimed
 * @returns {Option[]}
 */
function slotOptions(inSlot, slot, claimed) {
  const capacity = capacityOf(slot);
  const base = slotFites(inSlot, capacity, claimed);
  const spoken = nameSet(claimed);

  /** @type {Piece[]} */
  const advPieces = [];
  for (let i = 0; i < inSlot.length; i++) {
    if (inSlot[i].adv <= 0) continue;
    if (spoken[inSlot[i].item.name]) continue;
    if (twoHanded(inSlot[i])) continue;
    advPieces.push(inSlot[i]);
  }

  /** @type {Option[]} */
  const options = [];
  const combos = combinations(advPieces.length, capacity - claimed.length);
  for (let i = 0; i < combos.length; i++) {
    let combo = combos[i];
    let adv = 0;
    /** @type {Piece[]} */
    let forced = claimed.slice();
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
 * Does a plan costing `cost` for `adv` adventures beat `incumbent`? Fewest
 * fights sacrificed wins, and at equal cost the one overshooting by less.
 *
 * @param {number} cost
 * @param {number} adv
 * @param {Plan | null} incumbent
 * @returns {boolean}
 */
function beats(cost, adv, incumbent) {
  if (incumbent === null) return true;
  if (cost !== incumbent.cost) return cost < incumbent.cost;
  return adv < incumbent.adv;
}

/**
 * A slot-by-slot DP over adventures accumulated: cell `a` is the cheapest way
 * found to reach `a` of them, cheapness meaning fewest PvP fights sacrificed,
 * with ties going to whichever overshoots by less. Cell `need` is capped, so
 * anything that reaches or passes the target lands there.
 *
 * `equipment`, if given, is worn before any of it: its pieces claim their
 * slots, any slot it blocks is out of play, its own adventures and whatever it
 * pays on top seed the starting cell, and the fights all of those slots would
 * have carried are what it costs. Every cost in here is measured against the
 * same baseline - every slot left to fights - so plans built on different sets
 * compare directly.
 *
 * @param {Piece[]} pieces
 * @param {EquipmentSet | null} equipment
 * @param {number} need
 * @returns {(Plan | null)[]}
 */
function planWith(pieces, equipment, need) {
  const bySlot = groupBySlot(pieces);
  const claimed = groupBySlot(equipment === null ? [] : equipment.pieces);
  const blocks = equipment === null ? [] : equipment.blocks;

  /** @type {Item[]} */
  const worn = [];
  let cost = 0;
  let adv = 0;
  if (equipment !== null) {
    for (let i = 0; i < equipment.pieces.length; i++) {
      worn.push(equipment.pieces[i].item);
      adv += equipment.pieces[i].adv;
    }
    adv += equipment.adv;
    // Whatever it pays on top of its pieces - a set bonus - is fights we would
    // not otherwise have had, so it pays us.
    cost -= equipment.fites;
    for (let slot in claimed) {
      cost += slotCost(bySlot[slot] || [], slot, claimed[slot]);
    }
    for (let i = 0; i < blocks.length; i++) {
      cost += slotCost(bySlot[blocks[i]] || [], blocks[i], null);
    }
  }

  /** @type {(Plan | null)[]} */
  let dp = [];
  for (let i = 0; i <= need; i++) dp.push(null);
  dp[Math.min(need, adv)] = { cost: cost, adv: adv, items: worn };

  for (let s = 0; s < SLOT_KEYS.length; s++) {
    let slot = SLOT_KEYS[s];
    if (!bySlot[slot]) continue;
    if (blocks.indexOf(slot) >= 0) continue;
    let options = slotOptions(bySlot[slot], slot, claimed[slot] || []);
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
        if (beats(cost, adv, next[reached])) {
          next[reached] = { cost: cost, adv: adv, items: from.items.concat(option.items) };
        }
      }
    }
    dp = next;
  }
  return dp;
}

/**
 * One run per equipment set, plus one with none of them on.
 *
 * A set bonus spans slots, and so does a two-hander taking the off-hand with
 * it; a DP pricing one slot at a time has no way to express either. So each set
 * gets a run of its own with the whole thing already worn, and the cheapest run
 * wins. That is why neither is ever taken on by accident: a set is either worth
 * its slots outright or it loses to the run that left them free.
 *
 * @param {Piece[]} pieces
 * @param {EquipmentSet[]} sets
 * @param {number} ceiling every adventure the wardrobe could possibly carry
 * @returns {(Plan | null)[][]}
 */
function plansFor(pieces, sets, ceiling) {
  /** @type {(Plan | null)[][]} */
  const plans = [planWith(pieces, null, ceiling)];
  for (let i = 0; i < sets.length; i++) {
    plans.push(planWith(pieces, sets[i], ceiling));
  }
  return plans;
}

/**
 * Cheapest gear in `plans` covering `need` adventures, cheapest meaning fewest
 * PvP fights sacrificed.
 *
 * @param {(Plan | null)[][]} plans
 * @param {number} need
 * @returns {Item[]}
 */
function gearFor(plans, need) {
  if (need <= 0) return [];

  /** @type {Plan | null} */
  let best = null;
  // Every cell at or past the target clears it, and since no slot can be
  // filled for free, none of them is cheaper for the overshoot.
  for (let i = 0; i < plans.length; i++) {
    for (let a = need; a < plans[i].length; a++) {
      let plan = plans[i][a];
      if (plan !== null && beats(plan.cost, plan.adv, best)) best = plan;
    }
  }
  if (best !== null) return best.items;

  // Can't get there. Wear whatever gets closest so the caller can report it.
  for (let a = need - 1; a > 0; a--) {
    for (let i = 0; i < plans.length; i++) {
      let plan = plans[i][a];
      if (plan !== null && beats(plan.cost, plan.adv, best)) best = plan;
    }
    if (best !== null) return best.items;
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
 * @param {EquipmentSet[]} sets
 * @param {Familiar[]} offered
 * @param {number} target
 * @param {string[]} excluded
 * @returns {string | null} null if even everything we own falls short
 */
function solve(pieces, sets, offered, target, excluded) {
  let ceiling = 0;
  for (let i = 0; i < pieces.length; i++) ceiling += pieces[i].adv;
  // What a set pays on top of its pieces, which are counted already.
  for (let i = 0; i < sets.length; i++) ceiling += sets[i].adv;

  // The DP fills a cell per adventure total, so one run at the ceiling already
  // answers every need below it. Solving again per need would be the same
  // tables rebuilt a few hundred times over.
  const plans = plansFor(pieces, sets, ceiling);

  /** @type {Record<string, boolean>} */
  const tried = {};
  let probes = 0;
  for (let need = 0; need <= ceiling; need++) {
    let candidate = expressionFor(gearFor(plans, need), offered, target, excluded);
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
 * achieve it in code. It will change familiar where that buys a slot, complete
 * an outfit where the set bonus is worth its slots, wear a two-handed weapon
 * where it beats the off-hand it costs, and cast Offhand Remarkable where an
 * off-hand is worth doubling.
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
  const offered = excludedSlots.has("familiar") ? [] : candidates(gear);

  // One pool from here on, outfit pieces included: everything we could put on
  // right now, less a familiar slot we are about to offer the maximizer, which
  // fills it better than we can.
  const dropFamiliar = offered.length > 0;
  const pool = gear.filter(
    (piece) => piece.wearable && !(dropFamiliar && piece.slot === "familiar"),
  );
  const outfits = bonusOutfits(pool, excludedSlots);
  // Before anything is weighed, so both the maximizer and our own arithmetic
  // price off-hands at what they will actually be worth. An outfit's pieces are
  // the pool's own, so one pass over it reaches them too.
  if (offhandRemarkable(gear, target)) doubleOffhands(pool);
  const expression = solve(
    pool,
    outfits.concat(twoHanders(pool)),
    offered,
    target,
    excluded,
  );

  if (expression !== null) {
    print(expression);
    maximize(expression, false);
    // Judge by what we ended up in rather than by what maximize() returned
    if (numericModifier("Adventures") < target) maximize(expression, false);
  }

  if (numericModifier("Adventures") < target) {
    // The pinned set turned out to be unwearable together: a mutex pair, an
    // outfit conflict, something else we don't model. Rather than model all of
    // that, hand the whole problem to the maximizer unaided. It
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

// The gear arithmetic is pure, so the tests drive it directly. Mafia only ever
// calls main().
module.exports.bonusOutfits = bonusOutfits;
module.exports.twoHanders = twoHanders;
module.exports.pieceFor = pieceFor;
module.exports.slotOptions = slotOptions;
module.exports.planWith = planWith;
module.exports.plansFor = plansFor;
module.exports.gearFor = gearFor;
