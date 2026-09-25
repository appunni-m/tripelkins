# Tripelkin name dictionary

[`tripelkin-names-v1.txt`](tripelkin-names-v1.txt) contains **16,384 unique full names**: 64 given names × 16 byname beginnings × 16 endings. Examples: Pip Amberbell, Momo Mossbloom, Zeni Willowwhistle.

This combinatorial dictionary provides generated names for the colony. The components are readable English/fantasy names; they have not had a multilingual editorial review. Voice recognition must resolve names against the living roster, not assume every name transcribes correctly.

Regenerate from the repository root:

```sh
node scripts/generate-names.mjs
```

The generator preserves ordering and refuses duplicate entries or names exceeding the current save's 30-character allowance. The text file has one name per line. The game uses its compact component tables in `src/game/name-data.js`. Keep this version immutable once saves refer to its indices; publish a new version for changed ordering/components.

See `src/game/identity.js` for identity allocation, custom naming and migration. Shipping the dictionary must not create 16,384 creatures or copy it into every IndexedDB snapshot. A compact equivalent of its component tables can generate a name by index in constant space.
