# Procedural world

## Generation

`src/game/map.js` implements a versioned coordinate hash plus smooth value noise at two scales. The seed is independent of the simulation's mutable random-number generator. A new world receives a random terrain seed; a legacy save without map metadata uses the stable seed 18492. Generator version 1 must remain reproducible for saved worlds; future incompatible generators need a new version and migration.

Chunks are 16 × 16 world tiles. Moisture selects woodland, meadow or highland. Each 4 × 4 cell has at most one deterministic natural object: tree, rock, mineral node or flowers. IDs derive from chunk coordinates and cell slot, including negative coordinates. Generation excludes the original 64 × 48 clearing, whose authored objects remain saved as before. The river is straight through the original clearing and bends smoothly outside it. Rendering, construction and navigation use the same river function.

The coordinate safety range is ±1 billion tiles. This is effectively endless for play, not a claim of mathematical infinity or infinite browser storage. There is no download or model inference involved in generation.

## Rendering and memory

- Stream chunk meshes for the viewport plus a small margin; dispose texture/material resources as chunks leave it.
- Cap the visible width at 2,048 world pixels and retain the existing zoom range, bounding visible chunk count even on wide monitors.
- Share chunk geometry and sprite materials. Cull saved objects and creatures outside the view.
- Keep up to 128 generated resource chunks in a per-world LRU cache. These contain descriptions, not live simulation objects.
- Subtract a chunk-aligned camera origin from mesh coordinates before sending them to Three.js, avoiding GPU precision loss far from the clearing.
- Keep the existing 192 simulated individuals and 768 persistent objects. Larger populations continue as the existing cohort count.

Exploration does not create a list of every visited region. Panning changes only the camera in the save and its bounded history.

## Changes and snapshots

Every generated chunk has 16 possible resource slots. A cleared-slot bitmask records which resources were consumed or replaced. Harvesting a natural tree or rock materializes its changed state as a regular saved object (stump/log or ore); placing a mine clears the natural node and creates a saved mine. Removing a mine returns a saved node with its remaining stock. Unchanged generated resources never enter `world.objects` or IndexedDB.

`world.map` contains generator version, immutable seed, edit revision and cleared masks. Up to 2,048 changed chunks are retained; an operation needing another changed chunk fails visibly before consuming inventory or changing that resource. Existing masks are never evicted, preventing harvested resources from reappearing. Persistent object limits are checked before materializing resources. These bounds limit saved construction/resource edits, not camera exploration.

The existing exact snapshot/delta timeline includes these fields. Restoring a moment restores its seed, resource masks and buildings together. World save schema 4 accepts coordinates beyond the former clearing and migrates schema-1/schema-2/schema-3 saves. Older builds reject schema-3 exports instead of clamping imported positions. IndexedDB version 5 also prevents older clients from reopening and overwriting this browser’s map changes.

## Simulation and context

Navigation uses target-centered 128 × 128 tile flow fields, with at most 48 cached fields. The grid is derived from the river, procedural obstacles and saved buildings. Jobs use reachable facilities within 48 tiles instead of sending creatures across the entire generated world. Wandering uses local coordinates and retries blocked destinations. The original bridge remains the crossing gate; collected wood is credited locally after its completion.

Tripelkin groups use chunk coordinates. If more than eight regions are occupied, remaining members are combined into a summary group, preserving global urgent needs and covering every individual assignment. Hosted context adds a bounded nearby natural-resource sample and a terrain description; saved-object counts remain explicitly distinct from that sample. Laya receives an optional short terrain summary under its existing token budget. Generated tiles and resource edit masks are never sent to either model.

## Controls and review

Drag or use arrow keys to explore at any population. Wheel/pinch zooms; COLONY returns to a living member or the original clearing. The original colony and narrative landmarks stay in place.

The production build was run. Browser review covered rendering beyond the former boundary and inspecting a generated node. No automated terrain, navigation or recovery tests were added or run for this change.
