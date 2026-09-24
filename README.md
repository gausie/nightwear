# nightwear

Equips you for rollover. It works out how many adventures you need to reach the
200 adventure rollover cap given what you already have in hand, dresses for
exactly that many, and then spends every remaining slot on PvP fights. It only considers
gear you can actually wear right now, will change familiar where a familiar
equipment costume is worth the switch, will complete an outfit where the set
bonus is worth the slots it costs, and will cast Offhand Remarkable when an
off-hand you can wear carries something worth doubling.

Pass maximizer style slot exclusions to leave a slot alone, e.g. `nightwear
-hat`.

## Installing

```
git checkout gausie/nightwear release
nightwear
```

## Developing

`nightwear.js` in the root is the script. It is plain JavaScript checked with
`// @ts-check`, so there is no build step: `npm run check` runs TypeScript over
it against the `kolmafia` type definitions. Pushing to `main` copies the script
to `scripts/nightwear.js` on the `release` branch, which is what mafia's `git`
command installs.
