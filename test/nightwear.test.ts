import { beforeEach, describe, expect, it } from "vitest";
import { type ItemSpec, item, outfit, reset } from "./kolmafia.js";
import nightwear from "./load.js";

const { bonusOutfits, gearFor, pieceFor, planWith, plansFor, slotOptions, twoHanders } =
  nightwear;

/** Declare an item and hand back the Piece the gear arithmetic works in. */
const gear = (name: string, spec: ItemSpec) => pieceFor(item(name, spec));

/** What the script does per need, which the tests ask about one need at a time. */
const chooseGear = (...args: Parameters<typeof plansFor>) =>
  gearFor(plansFor(...args), args[2]);

const names = (items: { toString(): string }[]) => items.map(String).sort();

beforeEach(reset);

describe("bonusOutfits", () => {
  it("finds an outfit by its set bonus rather than by name", () => {
    item("time helmet", { slot: "hat", adv: 3 });
    item("time sword", { slot: "weapon", adv: 3 });
    item("time trousers", { slot: "pants", adv: 3 });
    outfit("Time Trappings", {
      adv: 3,
      pieces: ["time helmet", "time sword", "time trousers"],
    });

    const found = bonusOutfits([], new Set<string>());

    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("Time Trappings");
    expect(found[0].adv).toBe(3);
    expect(names(found[0].pieces.map((piece) => piece.item))).toEqual([
      "time helmet",
      "time sword",
      "time trousers",
    ]);
  });

  it("ignores an outfit whose set bonus is neither adventures nor fights", () => {
    item("hippy hat", { slot: "hat" });
    item("hippy pants", { slot: "pants" });
    outfit("Filthy Hippy Disguise", { pieces: ["hippy hat", "hippy pants"] });

    expect(bonusOutfits([], new Set<string>())).toEqual([]);
  });

  it("ignores an outfit we are missing a piece of", () => {
    item("sweatband", { slot: "hat", fites: 2 });
    item("gym shorts", { slot: "pants", fites: 2 });
    outfit("Workoutfit", {
      fites: 2,
      pieces: ["sweatband", "gym shorts"],
      owned: false,
    });

    expect(bonusOutfits([], new Set<string>())).toEqual([]);
  });

  it("ignores an outfit holding a piece we cannot wear", () => {
    // haveOutfit() is hasAllPieces(), so owning every piece is not the same as
    // being able to put it on.
    item("centurion helmet", { slot: "hat" });
    item("gladiator tunica", { slot: "shirt", wearable: false });
    outfit("Gladiatorial Glad Rags", {
      adv: 6,
      pieces: ["centurion helmet", "gladiator tunica"],
    });

    expect(bonusOutfits([], new Set<string>())).toEqual([]);
  });

  it("blocks the off-hand for an outfit that wants both hands", () => {
    item("big sword", { slot: "weapon", hands: 2 });
    item("big hat", { slot: "hat" });
    outfit("Two-Fisted Trousers", { adv: 5, pieces: ["big sword", "big hat"] });

    const found = bonusOutfits([], new Set<string>());

    expect(found).toHaveLength(1);
    expect(found[0].blocks).toEqual(["off-hand"]);
  });

  it("ignores an outfit wanting both hands and an off-hand at once", () => {
    item("big sword", { slot: "weapon", hands: 2 });
    item("small shield", { slot: "off-hand" });
    outfit("Impossible Kit", { adv: 5, pieces: ["big sword", "small shield"] });

    expect(bonusOutfits([], new Set<string>())).toEqual([]);
  });

  it("takes its pieces from the gear pool, and leaves what it added behind", () => {
    const helmet = gear("time helmet", { slot: "hat", adv: 3 });
    // Blank, so the gear pool has no reason to have heard of it.
    item("time trousers", { slot: "pants" });
    outfit("Time Trappings", {
      adv: 3,
      pieces: ["time helmet", "time trousers"],
    });

    const pool = [helmet];
    const found = bonusOutfits(pool, new Set<string>());

    // One Piece per item however it was reached, so doubling an off-hand or
    // dropping a piece from the pool lands on the outfit too.
    expect(found[0].pieces).toContain(helmet);
    expect(pool).toHaveLength(2);
    expect(pool).toContain(found[0].pieces[1]);
  });

  it("ignores an outfit reaching into a slot we were told to leave alone", () => {
    item("time helmet", { slot: "hat", adv: 3 });
    item("time trousers", { slot: "pants", adv: 3 });
    outfit("Time Trappings", { adv: 3, pieces: ["time helmet", "time trousers"] });

    expect(bonusOutfits([], new Set(["hat"]))).toEqual([]);
    expect(bonusOutfits([], new Set(["back"]))).toHaveLength(1);
  });
});

describe("chooseGear", () => {
  it("spends the fewest fights to reach the target", () => {
    const hat = gear("adv hat", { slot: "hat", adv: 5 });
    const pants = gear("adv pants", { slot: "pants", adv: 5 });
    const fitesPants = gear("fites pants", { slot: "pants", fites: 9 });

    // Both reach the target; only the pants cost anything to wear.
    expect(names(chooseGear([hat, pants, fitesPants], [], 5))).toEqual(["adv hat"]);
  });

  it("counts a set bonus towards a target the pieces alone cannot reach", () => {
    const helmet = gear("time helmet", { slot: "hat", adv: 3 });
    const sword = gear("time sword", { slot: "weapon", adv: 3 });
    const trousers = gear("time trousers", { slot: "pants", adv: 3 });
    const pool = [helmet, sword, trousers];
    const trappings = {
      name: "Time Trappings",
      adv: 3,
      fites: 0,
      pieces: pool,
      blocks: [],
    };

    // Nine adventures live on the pieces, so twelve is out of reach without
    // the set bonus. chooseGear() would answer either way - falling back to
    // the closest fit it found - so ask the plan whether it got there.
    expect(planWith(pool, null, 12)[12]).toBeNull();
    expect(planWith(pool, trappings, 12)[12]?.adv).toBe(12);

    expect(names(chooseGear(pool, [trappings], 12))).toEqual([
      "time helmet",
      "time sword",
      "time trousers",
    ]);
  });

  it("assembles an outfit whose pieces carry nothing on their own", () => {
    // Gladiatorial Glad Rags: all six pieces are blank and every adventure is
    // the set bonus, so nothing about them reaches the gear pool at all.
    const rags = {
      name: "Gladiatorial Glad Rags",
      adv: 6,
      fites: 0,
      pieces: [
        gear("centurion helmet", { slot: "hat" }),
        gear("madius", { slot: "weapon" }),
        gear("radiator heater shield", { slot: "off-hand" }),
        gear("gladiator tunica", { slot: "shirt" }),
        gear("pteruges", { slot: "pants" }),
        gear("Roman sadnals", { slot: "acc1" }),
      ],
      blocks: [],
    };
    const pool = [gear("fites hat", { slot: "hat", fites: 4 })];

    expect(chooseGear(pool, [], 6)).toHaveLength(0);
    expect(names(chooseGear(pool, [rags], 6))).toEqual([
      "Roman sadnals",
      "centurion helmet",
      "gladiator tunica",
      "madius",
      "pteruges",
      "radiator heater shield",
    ]);
  });

  it("prefers a set bonus to adventure gear when the set costs fewer fights", () => {
    const cloak = gear("adv cloak", { slot: "back", adv: 6 });
    const fitesCloak = gear("fites cloak", { slot: "back", fites: 9 });
    const meagreHat = gear("meagre hat", { slot: "hat", fites: 1 });
    const set = {
      name: "Cheap Set",
      adv: 6,
      fites: 0,
      pieces: [gear("plain hat", { slot: "hat" }), gear("plain pants", { slot: "pants" })],
      blocks: [],
    };
    const pool = [cloak, fitesCloak, meagreHat];

    // The cloak costs the 9 fight cloak; the set costs only the 1 fight hat.
    expect(names(chooseGear(pool, [], 6))).toEqual(["adv cloak"]);
    expect(names(chooseGear(pool, [set], 6))).toEqual(["plain hat", "plain pants"]);
  });

  it("wears a two-hander when it beats the off-hand it costs", () => {
    const sword = gear("huge sword", { slot: "weapon", adv: 8, hands: 2 });
    const shield = gear("fites shield", { slot: "off-hand", fites: 3 });
    const advHat = gear("adv hat", { slot: "hat", adv: 8 });
    const fitesHat = gear("fites hat", { slot: "hat", fites: 9 });
    const pool = [sword, shield, advHat, fitesHat];

    // The hat costs the 9 fight hat; the sword costs only the 3 fight shield.
    expect(names(chooseGear(pool, [], 8))).toEqual(["adv hat"]);
    expect(names(chooseGear(pool, twoHanders(pool), 8))).toEqual(["huge sword"]);
  });

  it("leaves a two-hander alone when the off-hand is worth more", () => {
    const sword = gear("huge sword", { slot: "weapon", adv: 8, hands: 2 });
    const shield = gear("fites shield", { slot: "off-hand", fites: 12 });
    const advHat = gear("adv hat", { slot: "hat", adv: 8 });
    const fitesHat = gear("fites hat", { slot: "hat", fites: 9 });
    const pool = [sword, shield, advHat, fitesHat];

    expect(names(chooseGear(pool, twoHanders(pool), 8))).toEqual(["adv hat"]);
  });

  it("counts the fights on a two-hander as gained rather than given up", () => {
    // Nothing is worn in two hands unless we commit to it, so a two-hander is
    // never part of what a slot would have carried left alone.
    const sword = gear("huge sword", { slot: "weapon", adv: 5, fites: 10, hands: 2 });
    const dagger = gear("dagger", { slot: "weapon", fites: 2 });
    const shield = gear("fites shield", { slot: "off-hand", fites: 4 });
    const advHat = gear("adv hat", { slot: "hat", adv: 5 });
    const fitesHat = gear("fites hat", { slot: "hat", fites: 1 });
    const pool = [sword, dagger, shield, advHat, fitesHat];

    // The sword gains 10 and gives up the dagger and the shield, so it pays 4
    // fights to wear. The hat costs 1.
    expect(names(chooseGear(pool, twoHanders(pool), 5))).toEqual(["huge sword"]);
  });

  it("breaks a set when the adventures can only come from a slot it claims", () => {
    const band = gear("sweatband", { slot: "hat", fites: 2 });
    const shorts = gear("gym shorts", { slot: "pants", fites: 2 });
    const advHat = gear("adv hat", { slot: "hat", adv: 6 });
    const workout = {
      name: "Workoutfit",
      adv: 0,
      fites: 2,
      pieces: [band, shorts],
      blocks: [],
    };

    expect(names(chooseGear([band, shorts, advHat], [workout], 6))).toEqual(["adv hat"]);
  });
});

describe("plansFor", () => {
  it("answers every need from one run at the ceiling", () => {
    // What solve() relies on: rather than solving again per need, it runs the
    // DP once as high as the wardrobe goes and reads each need out of that.
    const pool = [
      gear("adv hat", { slot: "hat", adv: 5 }),
      gear("fites hat", { slot: "hat", fites: 7 }),
      gear("adv pants", { slot: "pants", adv: 4, fites: 2 }),
      gear("fites pants", { slot: "pants", fites: 6 }),
      gear("adv weapon", { slot: "weapon", adv: 3 }),
      gear("adv cloak", { slot: "back", adv: 2, fites: 1 }),
      gear("ring A", { slot: "acc1", adv: 3 }),
      gear("ring B", { slot: "acc1", fites: 5 }),
      gear("ring C", { slot: "acc1", adv: 2, fites: 2 }),
    ];
    const set = {
      name: "Cheap Set",
      adv: 4,
      fites: 1,
      pieces: [gear("plain hat", { slot: "hat" }), gear("plain shirt", { slot: "shirt" })],
      blocks: [],
    };
    const outfits = [set];

    const ceiling =
      pool.reduce((total, piece) => total + piece.adv, 0) +
      outfits.reduce((total, o) => total + o.adv, 0);
    const hoisted = plansFor(pool, outfits, ceiling);

    for (let need = 1; need <= ceiling; need++) {
      expect(names(gearFor(hoisted, need))).toEqual(
        names(gearFor(plansFor(pool, outfits, need), need)),
      );
    }
  });
});

describe("slotOptions", () => {
  it("leaves an outfit only the accessory slots it has not claimed", () => {
    const weights = gear("ankleweights", { slot: "acc1", fites: 4 });
    const pool = [
      weights,
      gear("ring A", { slot: "acc1", adv: 4 }),
      gear("ring B", { slot: "acc1", adv: 4 }),
      gear("ring C", { slot: "acc1", adv: 4 }),
    ];

    const free = slotOptions(pool, "acc1", []).map((option) => option.adv);
    const claimed = slotOptions(pool, "acc1", [weights]).map((option) => option.adv);

    // Three accessories, so 12 adventures is on offer until the set takes one.
    expect(Math.max(...free)).toBe(12);
    expect(Math.max(...claimed)).toBe(8);
  });
});
