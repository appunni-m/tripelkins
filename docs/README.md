# Tripelkins documentation

[Play Tripelkins](https://appunni-m.github.io/tripelkins/) · [Project overview](../README.md)

## Play, understand, recover

| I want to… | Start here |
| --- | --- |
| Meet my first Tripelkin and learn the controls | [Game guide](GAME_GUIDE.md) |
| Fix a loading, sound, voice or save problem | [Troubleshooting](TROUBLESHOOTING.md) |
| Choose intelligence speed and worker count | [Intelligence controls](INTELLIGENCE_CONTROLS.md) |
| Understand download sizes, caches and resume | [Model downloads](MODEL_DOWNLOADS.md) |
| Understand voice capture and transcription | [Voice](VOICE.md) |
| Understand colony permission and self-sufficiency | [Colony independence](COLONY_INDEPENDENCE.md) |
| Understand goals, context and remembered commands | [Goals](GOALS.md) · [Context and recovery](CONTEXT_ARCHITECTURE.md) |
| Understand what leaves my browser | [Data and trust boundaries](../SECURITY.md) |

## Build and maintain

Start with [Contributing](../CONTRIBUTING.md). The live engine is Rust/WASM;
JavaScript game-rule files remain a pinned comparison reference and diagnostic
implementation. Older subsystem notes may name those files. Use the
[architecture](ARCHITECTURE.md) and [migration report](RUST_ENGINE_MIGRATION.md)
for the current execution boundary.

| Topic | Documentation |
| --- | --- |
| Worker ownership and application structure | [Architecture](ARCHITECTURE.md) |
| Migration contracts and reproducible evidence | [Migration report](RUST_ENGINE_MIGRATION.md) · [Generated contract](generated/engine-contract.md) · [Verification status](generated/engine-migration-status.md) |
| Static hosting, release checks and rollback | [Deployment](DEPLOYMENT.md) |
| Current documentation evidence and open gaps | [Documentation review](DOCUMENTATION_REVIEW.md) |
| Licensing, notices and manual review | [Third-party notices](../THIRD_PARTY_NOTICES.md) · [Release checklist](RELEASE_CHECKLIST.md) |

## Mechanics and design notes

These explain individual systems. Revision-specific measurements and old test
counts describe their original workload; they are not current performance or
cross-device guarantees.

- **World and travel:** [Procedural world](PROCEDURAL_WORLD.md), [fog and intelligence](FOG_AND_INTELLIGENCE_REVIEW.md), [bridge and meteor](BRIDGE_AND_METEOR.md), [work and access](WORK_AND_ACCESS.md), [local crews and routing review](LOCAL_CREWS_AND_ROUTING_REVIEW.md).
- **Work and expansion:** [Economy](ECONOMY.md), [independent development](INDEPENDENT_DEVELOPMENT.md), [outpost planning](OUTPOST_PLANNING.md), [adaptive expansion](ADAPTIVE_EXPANSION.md).
- **Personality and decisions:** [Story and task context](STORY_AND_TASK_CONTEXT.md), [name dictionary](resources/README.md), [intelligence audit](INTELLIGENCE_AUDIT.md).
- **Earlier reviews and measurements:** [Feature review](FEATURE_REVIEW.md), [stone, voice and performance review](STONE_VOICE_PERFORMANCE_REVIEW.md), [performance](PERFORMANCE.md), [resource optimization](RESOURCE_OPTIMIZATION.md).

## Reading the evidence

A configured feature, a passing check and a planned improvement are different
claims. The migration status records concrete runs and their scope. It does not
prove model quality, recognition accuracy on every microphone, unlimited scale,
or legal clearance. Generated documents include their regeneration commands;
edit their source contracts instead of manually changing generated counts.
