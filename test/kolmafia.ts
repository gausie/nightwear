import type { Item as MafiaItem } from "kolmafia";

/**
 * A fake of the slice of mafia the gear arithmetic touches, so a test can
 * describe a character's wardrobe as data instead of stubbing call by call.
 *
 * `world` is mutable and read on every call, so a test sets it up and the
 * already-loaded script sees it.
 */
type ItemSpec = {
  slot: string;
  adv?: number;
  fites?: number;
  wearable?: boolean;
  hands?: number;
};

type OutfitSpec = {
  adv?: number;
  fites?: number;
  pieces: string[];
  /** mafia's hasAllPieces(), which is ownership and nothing more. */
  owned?: boolean;
};

const world = {
  items: {} as Record<string, Required<ItemSpec>>,
  outfits: {} as Record<string, Required<OutfitSpec>>,
};

export function reset(): void {
  world.items = {};
  world.outfits = {};
}

/** Declare an item. Anything left out is nothing. */
export function item(name: string, spec: ItemSpec): MafiaItem {
  world.items[name] = {
    adv: 0,
    fites: 0,
    wearable: true,
    hands: 1,
    ...spec,
  };
  return asItem(name);
}

/** Declare an outfit and its set bonus. */
export function outfit(name: string, spec: OutfitSpec): string {
  world.outfits[name] = { adv: 0, fites: 0, owned: true, ...spec };
  return name;
}

// The script only ever reads .name off an Item, so a name is the whole fake.
const asItem = (name: string) =>
  ({ name, toString: () => name }) as unknown as MafiaItem;

const lookup = (it: unknown): Required<ItemSpec> =>
  world.items[String(it)] ?? { slot: "none", adv: 0, fites: 0, wearable: true, hands: 1 };

export const Item = { all: () => Object.keys(world.items).map(asItem) };
export const Effect = { get: asItem };
export const Familiar = { get: asItem, all: () => [] };
export const Slot = { get: (name: string) => name };

export const toSlot = (it: unknown) => lookup(it).slot;
export const canEquip = (it: unknown) => lookup(it).wearable;
export const weaponHands = (it: unknown) => lookup(it).hands;
export const availableAmount = () => 1;

export function numericModifier(subject: unknown, modifier: string): number {
  const name = String(subject);
  // "Outfit:<name>" is the set bonus rather than any item of that name.
  const set = name.startsWith("Outfit:") ? world.outfits[name.slice(7)] : undefined;
  const source = set ?? lookup(subject);
  if (modifier === "Adventures") return source.adv;
  if (modifier === "PvP Fights") return source.fites;
  return 0;
}

export const allNormalOutfits = () => Object.keys(world.outfits);
export const haveOutfit = (name: string) => world.outfits[name]?.owned ?? false;
export const outfitPieces = (name: string) =>
  (world.outfits[name]?.pieces ?? []).map(asItem);

// Nothing below is exercised by the gear arithmetic, but the script
// destructures it at load.
export const haveEffect = () => 0;
export const haveSkill = () => false;
export const toSkill = () => asItem("none");
export const mpCost = () => 0;
export const myMp = () => 0;
export const useSkill = () => true;
export const haveFamiliar = () => false;
export const maximize = () => true;
export const myAdventures = () => 0;
export const print = () => {};
