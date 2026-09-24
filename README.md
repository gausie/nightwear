# nightwear

Works out the equipment that gives you the most rollover adventures, taking into
account what you can actually wear right now and which familiar is worth
swapping to for its costume.

## Installing

```
git checkout gausie/nightwear release
nightwear
```

## Developing

`nightwear.js` in the root is the script. It is plain JavaScript checked with
`// @ts-check`, so there is no build step - `npm run check` runs TypeScript over
it against the `kolmafia` type definitions. Pushing to `main` copies the script
to `scripts/nightwear.js` on the `release` branch, which is what mafia's `git`
command installs.
