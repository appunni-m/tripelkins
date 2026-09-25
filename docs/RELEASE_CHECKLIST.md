# Tripelkins naming and release review

Audit date: 25 September 2026. Baseline: `3fcfd60`.

**Status: technical naming cleanup verified; release clearance remains open.** Checked boxes mean the stated inspection was completed. They are not a legal opinion or a guarantee against third-party claims. Unchecked items are real outstanding work.

## Naming and current files

- [x] Product spelling: **Tripelkins**; one resident: **Tripelkin**. Reviewed page titles, accessibility labels, menus, provider prompts, package metadata, export names, cache names and database namespace.
- [x] Scan current project files, paths and the three published commit messages for the former product, studio, franchise and character names. No matches in published project history. The scan covered 163 referenced objects across the three commits, reading every file blob.
- [x] Keep generic wood, stone, mining, gathering, care, multiplication, construction, exploration, fog, goals and local intelligence functionality. This is a scope decision, not legal clearance for the overall presentation.
- [x] Correct player-facing names: Banana, Cloth, Cricket ball, Rain shower, Banana grove, Bounce garden, Stone workshop, Cottage, Clubhouse, Survey beacon, Sky launcher and Reclaimer. Centralize object names so inspectors and recovery cards do not expose storage keys.
- [x] Correct new activity text and journal category labels for spacecraft arrival, surveys and demolition. Save-format identifiers remain stable to protect existing worlds.
- [x] Inspect the 16,384-name component dictionary and its allocation/custom-name system. It is generated from 64 × 16 × 16 components, not a copied character roster. Common name components do not establish exclusive rights. Remove the unsupported assertion that every generated name is original. Regenerate the dictionary text to fix 1,024 outdated fruit-prefix entries; all 16,384 lines now exactly match the runtime table without changing its indices.
- [ ] Complete trademark clearance for Tripelkins and the tagline in the intended release markets, including similar spellings, sounds, registered/pending marks and common-law use. The limited exact-name web search did not establish a competing game, but it does not establish availability.

## Presentation, story and assets

- [x] Inspect current procedural creature/scenery/icon source and the opening screen. The current tree ships no third-party game image files, logos, screenshots, music, video or sampled creature audio.
- [x] Inspect the sound implementation: creature voices and meteor effects are synthesized by Web Audio. Preserve the sound engine and its current behavior.
- [x] Remove the bundled speech-test recording because its voice redistribution permission was not documented. Speech verification now accepts a local recording supplied by the tester. Missing audio produces a skip before model download; it is never reported as a pass.
- [x] Correct the Bounce garden dialogue so it describes bouncing rather than traveling in circles.
- [ ] Human creative-distance review of creature silhouettes/animation, interface composition and synthesized sounds. Procedural implementation establishes how assets are rendered, not that their expressive design is independent.
- [ ] Resolve the inherited narrative combination: the moral choice to turn residents into bridge materials; paired survey objects and mountain demolition gates; orbital travel followed by a destructive ending with three survivors and a final evaluation. Renaming these elements does not resolve the combination. This remains a release concern.

### Proposed narrative revision for approval

Keep the intelligence layer, physical work, multiplication, movement, needs, history and saves. Give the spacecraft a survey-and-settlement mission. Make the bridge's alternative material mined stone rather than former residents. Use surveys to discover habitat sites, with orbital trips supporting an additional home. Conclude the settlement chapter with a factual community journal and continued expansion rather than a destructive personality-test-style ending. Review the resulting expression as a whole before clearance. This plan is not implemented by the naming cleanup.

## Third-party software, models and attribution

- [x] Add a Credits & licenses page linked only from Options → Advanced.
- [x] Include installed browser-library license texts, both matching ONNX runtime notice sets, both font licenses and the original Whisper implementation license. The build generates dependency notices and verifies that they are present in the deployment.
- [x] Identify Laya's model author and the independent FP16/Q8 conversion authors, using their published Apache 2.0 statements. Keep these factual credits; they do not claim endorsement.
- [ ] Confirm the exact Whisper ONNX conversion's distribution terms. The original implementation is MIT; the upstream Base English model card declares Apache 2.0; the selected conversion page does not publish a separate license declaration. The audit does not infer clearance from a public download URL.
- [ ] Human review of the final dependency/model inventory and hosted-provider terms for the intended distribution and use. Attribution is necessary but is not an all-purpose rights clearance.

## History and retained copies

- [x] Inspect all local branches, tags, remote-tracking refs, stash listing and reflogs. Scan the entire local object database, including unreachable objects: 32 commits, 586 blobs and 198 trees; 234 blobs, one tree and one commit still contain former references. Codex-managed checkpoint refs also exist and must be included in any coordinated purge.
- [x] Confirm the Tripelkins remote at the audit baseline has one branch, `main`, and no tags; its three published commits begin at a fresh root. The former project is not an ancestor of that main branch.
- [ ] Remove or isolate the local `codex/pre-tripelkins-migration` recovery branch and expire the associated reflogs/unreachable Git objects if permanent loss of the 29-commit recovery history is approved. The audit found 211 historical file versions containing former names, plus old commit messages and a historical filename.
- [ ] Owner will manually retire the separate legacy remote repository and its Pages deployment, actions artifacts, releases and other retained project metadata. At audit time it was public and unarchived, with Pages enabled, 26 Actions artifacts, no releases and no forks reported by the public API. Deleting a local branch does not remove it. The browser was signed out; the owner chose to handle hosted deletion directly.
- [ ] Rewrite the early Tripelkins commits if the removed speech recording and inherited narrative must disappear from every published revision. A normal cleanup commit does not remove those files from prior commits. This changes commit IDs and requires a coordinated force push. Three existing Tripelkins Actions artifacts also retain the pre-cleanup release files and need separate removal.
- [ ] Rename the active local workspace directory and update its desktop-project/dev-server configuration. Its directory name is still the former name; it is not part of the published site.
- [x] Read-only audit of this browser at `http://localhost:5173`: the old database namespace still exists with 227 journal records and six world-store records. No former-name matches in their serialized contents. Four old cache names remain; one current Laya cache also exists. No data was changed. The temporary audit page was removed before building.
- [ ] Migrate the old local database/cache names while preserving verified contents, and separately audit saved history at the Pages origin, other browser profiles and exported world files. Current migration intentionally preserves free-form history verbatim. No stored player history was deleted or silently rewritten by this audit.
- [ ] Request removal of retained host objects/caches where supported after any rewrite. Independent clones, forks, downloaded exports, search caches and this conversation cannot be guaranteed erased by changing this repository.

## Verification

- [x] Run the existing 104 regression tests after the naming and speech-fixture changes: all passed.
- [x] Build and inspect the asset manifest: 34 files including notices; the retired recording is absent.
- [x] Inspect opening-screen branding and recording-required behavior. A speech check without a file reports skipped in 1 ms, before worker/model loading.
- [x] Scan the candidate tree and build: 139 project files and all emitted files, including source maps, contained no matches for former names or brands. The retired recording is absent from the build.
- [ ] Re-scan published history after the approved history rewrite.
- [ ] Obtain human sign-off on the open items above. Do not describe this release as having “no IP issues pending” while these remain open.

## Guidance used

- [U.S. Copyright Office: games](https://www.copyright.gov/register/tx-games.html) distinguishes game ideas/methods from literary and pictorial expression.
- [USPTO: comprehensive clearance searches](https://www.uspto.gov/trademarks/search/comprehensive-clearance-search-similar-trademarks) describes the broader name-search work required beyond exact web matches.
- [Laya FP16 conversion](https://huggingface.co/inferenceprince/laya-onnx), [Laya Q8 conversion](https://huggingface.co/nvkudva/laya-web-q8), [Whisper Base English model card](https://huggingface.co/openai/whisper-base.en), [selected ONNX conversion](https://huggingface.co/onnx-community/whisper-base.en).

These sources are guidance and component provenance, not a legal assessment of this game.
