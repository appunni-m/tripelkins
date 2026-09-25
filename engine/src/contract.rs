//! Public export adapter. Algorithms live in their owning engine modules; this
//! boundary only translates the source API's argument names and object handles.
use crate::{Engine, development, simulation, terrain, value::*};
use serde_json::{Value, json};
use std::sync::LazyLock;
static CONSTANTS: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../data/public-constants.json"))
        .expect("reviewed literal catalog")
});
fn entity_id(v: &Value) -> &str {
    v.as_str().unwrap_or_else(|| text(v, "id"))
}
fn provided<'a>(a: &'a Value, k: &str, fallback: &'a Value) -> &'a Value {
    a.get(k).unwrap_or(fallback)
}
impl Engine {
    pub(crate) fn contract_entity(&self, v: &Value) -> Value {
        let id = entity_id(v);
        if !id.is_empty() {
            for field in ["creatures", "objects"] {
                if let Some(o) = list(&self.world, field)
                    .iter()
                    .find(|o| text(o, "id") == id)
                {
                    return o.clone();
                }
            }
        }
        v.clone()
    }
    fn contract_delegate(&mut self, operation: &str, input: Value) -> Result<Value, String> {
        serde_json::from_str(&self.call_json(operation, &input.to_string())?)
            .map_err(|e| e.to_string())
    }
    pub(crate) fn contract_dispatch(
        &mut self,
        operation: &str,
        input: &Value,
    ) -> Result<Option<Value>, String> {
        if operation != "contract.call" && operation != "contract.constant" {
            return Ok(None);
        }
        let surface = text(input, "surface");
        let member = text(input, "operation");
        let key = format!("{surface}.{member}");
        if operation == "contract.constant" {
            return CONSTANTS
                .get(&key)
                .cloned()
                .map(Some)
                .ok_or_else(|| format!("Unknown public constant: {key}"));
        }
        let a = &input["arguments"];
        let c = self.contract_entity(&a["c"]);
        let o = self.contract_entity(&a["o"]);
        let p = &a["p"];
        macro_rules! call {
            ($op:expr,$value:expr) => {
                self.contract_delegate($op, $value)?
            };
        }
        let result = match key.as_str() {
            "game.access.accessBrief" => json!(self.access_brief()),
            "game.access.accessContext" => self.access_context(),
            "game.access.accessPoint" => json!(crate::access::access_point(&o, &c)),
            "game.access.accessPurpose" => json!(self.access_purpose(&a["r"])),
            "game.access.clearanceChoices" => json!(self.clearance_choices()),
            "game.access.clearanceEnabled" => json!(self.clearance_enabled()),
            "game.access.clearanceTask" => json!(self.clearance_task(&c)),
            "game.access.requestAccess" => {
                self.request_access(a["options1"].clone());
                Value::Null
            }
            "game.access.reviewAccess" => {
                self.review_access();
                Value::Null
            }
            "game.access.startClearance" => {
                json!(self.start_clearance(&a["choice"], text(a, "source")))
            }
            "game.bridge-project.bridgeProject" => {
                let b = a.get("bridge").map(|v| self.contract_entity(v));
                json!(self.bridge_project(b.as_ref()))
            }
            "game.care-context.careContext" => self.care_context(),
            "game.care-context.careDemand" => json!(self.care_demand(text(a, "type"))),
            "game.care-context.careServices" => {
                json!(crate::outposts::care_services(text(a, "type")))
            }
            "game.care-context.careSummary" => json!(crate::outposts::care_summary(&a["care"])),
            "game.catalog.buildingMaterials" => {
                json!({"wood":num(&a["spec"],"wood"),"blocks":num(&a["spec"],"cost")})
            }
            "game.catalog.buildingCost" => json!(simulation::building_cost(&a["spec"])),
            "game.catalog.displayName" => json!(simulation::display_name(text(a, "type"))),
            "game.catalog.eventLabel" => json!(match text(a, "kind") {
                "hatch" => "arrival".into(),
                "monolith" => "survey".into(),
                "tnt" => "demolition".into(),
                "nuke" => "departure".into(),
                s => s.replace('-', " "),
            }),
            "game.catalog.goal" => self.current_goal(),
            "game.catalog.lockReason" => {
                let s = &a["spec"];
                json!(if num(s, "population") != 0. {
                    format!("{} creatures", num(s, "population"))
                } else if num(s, "blocks") != 0. {
                    format!("{} blocks", simulation::format_count(num(s, "blocks")))
                } else if num(s, "energy") != 0. {
                    "1.5M energy".into()
                } else {
                    "Keep exploring".into()
                })
            }
            "game.catalog.unlocked" => json!(simulation::unlocked(&self.world, &a["spec"])),
            "game.colony-letters.completionLetter" => self.completion_letter(p, text(a, "title")),
            "game.commands.commandInput" => crate::commands::command_input(text(a, "text")),
            "game.commands.commandOptions" => crate::commands::command_options(text(a, "text")),
            "game.commands.commitConstraints" => {
                self.commit_constraints(&a["result"]);
                Value::Null
            }
            "game.commands.informationQuestion" => {
                json!(crate::commands::information_question(text(a, "text")))
            }
            "game.commands.parseConstraints" => {
                self.parse_constraints(text(a, "text"), a["selected"].as_str())
            }
            "game.community.activity" => {
                self.activity(
                    text(a, "kind"),
                    text(a, "text"),
                    a["source"].as_str().unwrap_or("Instincts"),
                    text(a, "detail"),
                );
                Value::Null
            }
            "game.community.initialCommunity" => crate::community::initial_community(),
            "game.community.nextNotice" => json!(self.next_notice()),
            "game.community.offerIndependence" => {
                self.offer_independence();
                Value::Null
            }
            "game.community.postMessage" => json!(self.post_message(a["options1"].clone())),
            "game.community.setIndependence" => json!(self.set_independence(flag(a, "accepted"))),
            "game.community.visitFrontier" => {
                self.visit_frontier(Point::read(p));
                Value::Null
            }
            "game.context-budget.packHostedContext" => {
                crate::context_budget::pack_hosted_context(&a["full"], num(a, "budget") as usize)?
            }
            "game.context-budget.utf8Size" => json!(
                a["value"]
                    .as_str()
                    .map(|s| s.len())
                    .unwrap_or_else(|| js_json(&a["value"]).len())
            ),
            "game.context.buildContext" => {
                self.build_context(a["options1"]["includePlans"].as_bool().unwrap_or(true))
            }
            "game.conversation.informationReply" => {
                json!(self.information_reply(text(a, "text"), a["listener"].as_str()))
            }
            "game.conversation.localReply" => {
                json!(self.local_reply(text(a, "intent"), a["listener"].as_str()))
            }
            "game.conversation.simpleIntent" => {
                json!(crate::community::simple_intent(text(a, "text")))
            }
            "game.decisions.bestPlan" => self.best_plan(list(a, "plans")),
            "game.decisions.feasiblePlans" => json!(self.feasible_plans()),
            "game.decisions.judgePlan" => self.judge_plan(p),
            "game.decisions.planReward" => self.plan_reward(p),
            "game.decisions.selectPlan" => self.select_plan(
                a["policy"].as_str(),
                text(a, "source"),
                text(a, "model"),
                a.get("initial").filter(|v| !v.is_null()),
            ),
            "game.density.densityAt" => self.density_at(Point::read(p)),
            "game.density.densityReward" => json!(crate::density::reward(
                num(a, "value"),
                a["target"].as_f64().unwrap_or(6.)
            )),
            "game.density.densitySummary" => self.density_summary(),
            "game.density.siteDensity" => self.site_density(Point::read(p)),
            "game.destruction.meteorImpact" => self.meteor_impact(Point::read(a)),
            "game.development-plan.developmentPlan" => self.development_plan(),
            "game.development-plan.updateDevelopmentPlan" => self.update_development_plan(),
            "game.development.colonyMilestone" => development::colony_milestone(&self.world),
            "game.development.industryMilestone" => development::industry_milestone(&self.world),
            "game.development.isConstruction" => json!(development::construction(p)),
            "game.development.projectFunded" => json!(development::project_funded(
                &self.world,
                provided(a, "p", &self.world["community"]["project"])
            )),
            "game.development.projectName" => json!(development::project_name(p)),
            "game.development.projectPercent" => {
                let material = development::material(text(p, "type"));
                let value = if text(p, "type") == "crossing" {
                    list(&self.world, "objects")
                        .iter()
                        .find(|o| text(o, "type") == "bridge")
                        .map(|o| num(o, "stock"))
                        .unwrap_or(0.)
                        / 24.
                } else if let Some(k) = material {
                    num(&self.world["inventory"], k) / num(p, "target")
                } else {
                    num(p, "progress") / num(p, "required")
                };
                json!((100. * value).floor().min(100.))
            }
            "game.development.projectRequirements" => {
                development::project_requirements(&self.world, p)
            }
            "game.development.projectStatus" => {
                json!(self.project_status(provided(a, "p", &self.world["community"]["project"])))
            }
            "game.development.timberReserve" => development::timber_reserve(&self.world),
            "game.development.uncommittedBlocks" => {
                json!(development::uncommitted_blocks(&self.world))
            }
            "game.discovery.createDiscovery" => crate::discovery::create(),
            "game.discovery.discoverySummary" => self.discovery_summary(),
            "game.discovery.isExplored" => json!(self.is_explored(Point::read(p))),
            "game.discovery.normalizeDiscovery" => {
                crate::discovery::normalize(&a["raw"], &self.world)?
            }
            "game.discovery.reveal" => {
                json!(self.reveal(Point::read(p), a["radius"].as_f64().unwrap_or(10.)))
            }
            "game.discovery.revealColony" => {
                self.reveal_colony();
                Value::Null
            }
            "game.exploration.discoveryGain" => json!(self.discovery_gain(Point::read(p))),
            "game.exploration.frontier" => json!(self.frontier(
                &c,
                list(a, "assignments"),
                a["policy"].as_str().unwrap_or("balanced")
            )),
            "game.exploration.scoutLimit" => json!(crate::exploration::scout_limit(
                &self.world,
                a["policy"].as_str().unwrap_or("balanced")
            )),
            "game.geometry.canPlace" => json!(self.can_place(
                text(a, "type"),
                Point::read(p),
                a["ignore"].as_str(),
                flag(&a["options4"], "ignoreCreatures")
            )),
            "game.geometry.clearPosition" => json!(self.clear_at(
                Point::read(p),
                a["r"].as_f64().unwrap_or(crate::geometry::BODY_RADIUS),
                a["ignore"].as_str()
            )),
            "game.geometry.freePosition" => {
                let default = self.world["creatures"].clone();
                let others = provided(a, "others", &default)
                    .as_array()
                    .map(|v| v.iter().map(Point::read).collect::<Vec<_>>())
                    .unwrap_or_default();
                json!(self.free_position(
                    Point::read(p),
                    &others,
                    a["maxRadius"].as_f64().unwrap_or(6.)
                ))
            }
            "game.geometry.separateBodies" => {
                self.separate_bodies();
                Value::Null
            }
            "game.geometry.serviceSlots" => {
                json!(self.service_slots(&o, Some(Point::read(provided(a, "from", &o)))))
            }
            "game.geometry.steerMove" => call!(
                "simulation.steerMove",
                json!({"id":entity_id(&c),"dx":a["dx"],"dy":a["dy"]})
            ),
            "game.geometry.sweptMove" => {
                let mut at = Point::read(&c);
                let result = self.swept_move(&mut at, num(a, "dx"), num(a, "dy"));
                if let Some(c) = self.world["creatures"]
                    .as_array_mut()
                    .and_then(|v| v.iter_mut().find(|v| same_id(&v["id"], &c["id"])))
                {
                    c["x"] = json!(at.x);
                    c["y"] = json!(at.y);
                }
                json!(result)
            }
            "game.goals.activeGoal" => json!(self.active_goal()),
            "game.goals.addGoal" => {
                self.add_goal(&a["spec"], text(a, "command"), text(a, "source"))?
            }
            "game.goals.advanceGoals" => json!(self.advance_goals()),
            "game.goals.changeGoal" => json!(self.change_goal(text(a, "id"), text(a, "action"))),
            "game.goals.goalPolicy" => json!(self.goal_policy()),
            "game.goals.goalTarget" => {
                json!(self.goal_target(text(a, "kind"), num(a, "requested")))
            }
            "game.goals.goalTitle" => json!(crate::goals::goal_title(&a["g"])),
            "game.goals.inspectGoal" => self.inspect_goal(&a["g"]),
            "game.goals.normalizeGoals" => crate::goals::normalize_goals(&a["input"]),
            "game.goals.numberFromCommand" => json!(crate::commands::number_from_command(
                text(a, "text"),
                text(a, "kind")
            )),
            "game.health.colonyHealth" => crate::state::colony_health(&self.world),
            "game.identity.dictionaryName" => {
                json!(crate::identity::dictionary_name(num(a, "index") as i64))
            }
            "game.identity.encounter" => {
                let mut c = c.clone();
                crate::identity::encounter(
                    &mut c,
                    text(a, "kind"),
                    a["other"].as_str(),
                    num(a, "tick"),
                );
                c
            }
            "game.identity.identity" => self.identity(a.get("parent").filter(|v| !v.is_null())),
            "game.identity.renameCreature" => self.rename_creature(entity_id(&c), text(a, "text")),
            "game.identity.resolveListener" => {
                self.resolve_listener(text(a, "text"), a["selected"].as_str())
            }
            "game.jobs.allowsTask" => json!(self.allows_task(text(a, "task"), &c)),
            "game.jobs.applyPlan" | "game.simulation.applyPlan" => {
                json!(self.apply_plan(&a["plan"]))
            }
            "game.jobs.capacity" | "game.simulation.capacity" => json!(public_capacity(&o)),
            "game.jobs.makePlan" | "game.simulation.makePlan" => {
                self.make_plan(a["policy"].as_str().unwrap_or("balanced"))
            }
            "game.jobs.minimum" => json!(development::minimum(&c)),
            "game.jobs.syncGroups" => {
                self.sync_groups();
                Value::Null
            }
            "game.map.biome" => json!(terrain::biome(
                num(&self.world["map"], "seed") as u32,
                Point::read(a)
            )),
            "game.map.chunkObjects" => json!(terrain::chunk(
                num(&self.world["map"], "seed") as u32,
                num(a, "cx") as i32,
                num(a, "cy") as i32
            )),
            "game.map.clearNatural" => json!(terrain::clear_natural(&mut self.world, &a["object"])),
            "game.map.coordinate" => {
                let n = js_number(&a["value"]);
                json!(if !a["value"].is_null() && n.is_finite() {
                    n.clamp(-terrain::WORLD_EDGE, terrain::WORLD_EDGE)
                } else {
                    num(a, "fallback")
                })
            }
            "game.map.createMap" => {
                let n = a["seed"].as_f64().unwrap_or(18492.);
                json!({"version":1,"seed":(n as i64) as u32,"revision":0,"cleared":{}})
            }
            "game.map.hash" => json!(terrain::hash(
                num(a, "seed") as u32,
                num(a, "x") as i32,
                num(a, "y") as i32,
                num(a, "salt") as u32
            )),
            "game.map.inClearing" => json!(terrain::clearing(Point::read(a))),
            "game.map.isGround" => json!(terrain::ground(
                num(&self.world["map"], "seed") as u32,
                Point::read(a)
            )),
            "game.map.isWater" => json!(terrain::water(
                num(&self.world["map"], "seed") as u32,
                Point::read(a)
            )),
            "game.map.naturalObject" => json!(self.natural_object(text(a, "id"))),
            "game.map.naturalObjects" => json!(terrain::natural(
                &self.world,
                Point {
                    x: num(a, "minX"),
                    y: num(a, "minY")
                },
                Point {
                    x: num(a, "maxX"),
                    y: num(a, "maxY")
                }
            )),
            "game.map.nearbyObjects" => {
                json!(self.nearby_objects(Point::read(a), a["radius"].as_f64().unwrap_or(5.)))
            }
            "game.map.normalizeMap" => terrain::normalize(&a["raw"], flag(a, "required"))?,
            "game.map.riverLeft" => json!(terrain::river_left(
                num(&self.world["map"], "seed") as u32,
                num(a, "y")
            )),
            "game.map.westBank" => {
                json!(crate::exploration::west_bank(&self.world, Point::read(p)))
            }
            "game.memory.beginCommand" => self.begin_command(
                text(a, "value"),
                text(a, "channel"),
                a["listener"].as_str(),
                text(a, "id"),
            ),
            "game.memory.compactEvents" => call!("memory.compactEvents", a.clone()),
            "game.memory.interruptCommands" => {
                self.interrupt_commands();
                self.world.clone()
            }
            "game.memory.normalizeMemory" => {
                if let Some(raw) = a.get("raw") {
                    crate::memory::validate_memory(raw)?;
                }
                crate::memory::normalize_memory(a.get("raw").unwrap_or(&json!({})))
            }
            "game.navigation.navigationMemory" => {
                json!({"fields":self.nav.field_count(),"bytes":self.nav.bytes(),"limit":192})
            }
            "game.navigation.routeCost" => json!(self.route_cost(Point::read(&c), Point::read(p))),
            "game.navigation.waypoint" => self.nav.waypoint_value(
                &crate::geometry::Geometry::new(&self.world),
                Point::read(&c),
                Point::read(&a["destination"]),
            ),
            "game.orbit-rules.orbitalReady" => {
                if !truthy(&self.world["progress"]["cannon"]) {
                    self.world["progress"]["cannon"].clone()
                } else {
                    json!(
                        num(&self.world["orbital"], "launches") >= 12.
                            && num(&self.world["orbital"], "population") >= 12.
                    )
                }
            }
            "game.outposts.assessOutpost" => self.assess_outpost(
                text(a, "type"),
                Point::read(p),
                num(a, "builderDistance"),
                flag(&a["options4"], "routed"),
            ),
            "game.outposts.outpostCamps" => json!(self.outpost_camps()),
            "game.outposts.outpostContext" => self.outpost_context(),
            "game.outposts.outpostEconomics" => crate::outposts::outpost_economics(&a["options"]),
            "game.outposts.workshopEconomics" => crate::outposts::workshop_economics(&a["options"]),
            "game.population.launch" => call!("population.launch", json!({"id":entity_id(&c)})),
            "game.population.refreshDistrict" => {
                self.refresh_district();
                Value::Null
            }
            "game.population.stepCohorts" => {
                self.step_cohorts(num(a, "dt"));
                Value::Null
            }
            "game.population.syncPopulation" => {
                self.sync_population();
                Value::Null
            }
            "game.projects.acceptsProject" => {
                json!(crate::resources::accepts_project(&o, text(a, "kind")))
            }
            "game.projects.projectState" => {
                if text(&o, "type") == "sculpture" {
                    json!({"material":"wood","required":12,"completion":"The sculpture keeps the shape of our first question.","delivered":num(&o,"stock").min(12.),"complete":num(&o,"stock")>=12.})
                } else {
                    Value::Null
                }
            }
            "game.projects.supplyProject" => call!(
                "resources.supplyProject",
                json!({"id":entity_id(&c),"target":entity_id(&o)})
            ),
            "game.resources.cleanPollution" => {
                self.clean_pollution(Point::read(p));
                Value::Null
            }
            "game.resources.deliver" => call!(
                "resources.deliver",
                json!({"id":entity_id(&c),"target":entity_id(&o)})
            ),
            "game.resources.deposit" => {
                json!(self.deposit(text(a, "type"), Point::read(a), num(a, "stock")))
            }
            "game.resources.die" => {
                let victims = list(a, "victims")
                    .iter()
                    .map(|v| self.contract_entity(v))
                    .collect::<Vec<_>>();
                json!(self.die(
                    &victims,
                    text(a, "cause"),
                    a["actor"].as_str().unwrap_or("caretaker"),
                ))
            }
            "game.resources.maintainFactory" => {
                json!(self.maintain_factory(&self.contract_entity(&a["factory"]), num(a, "amount")))
            }
            "game.resources.pollute" => {
                self.pollute(&o, num(a, "amount"));
                Value::Null
            }
            "game.resources.pollutionAt" => json!(self.pollution_at(Point::read(p))),
            "game.resources.releaseCargo" => {
                call!("resources.releaseCargo", json!({"id":entity_id(&c)}))
            }
            "game.save-schema.extendWorld" => call!("save-schema.extendWorld", json!({})),
            "game.save-schema.migrateExtensions" => {
                call!("save-schema.migrateExtensions", json!({"raw":a["raw"]}))
            }
            "game.settlement.constructionSlots" => {
                let p = provided(a, "project", &self.world["community"]["project"]).clone();
                json!(self.construction_slots(&p))
            }
            "game.settlement.currentSettlementChoice" => {
                json!(self.current_settlement_choice(&a["choice"]))
            }
            "game.settlement.deliveryStock" => json!(self.delivery_stock(text(a, "kind"))),
            "game.settlement.factoryInputTarget" => {
                json!(crate::settlement::factory_input_target(&o))
            }
            "game.settlement.finishSettlement" => {
                json!(self.finish_settlement())
            }
            "game.settlement.independent" => json!(self.independent()),
            "game.settlement.localOre" => json!(self.local_ore(p)),
            "game.settlement.outpostReason" => json!(crate::settlement::outpost_reason(p)),
            "game.settlement.prepareTimber" => {
                self.prepare_timber();
                Value::Null
            }
            "game.settlement.projectAllowed" => json!(self.project_allowed(&c)),
            "game.settlement.projectTask" => json!(self.project_task(&c)),
            "game.settlement.projectTasks" => json!(self.project_tasks(&c)),
            "game.settlement.refiningOreReserve" => json!(self.refining_ore_reserve()),
            "game.settlement.refiningShortage" => json!(self.refining_shortage(p)),
            "game.settlement.settlementChoices" => json!(self.settlement_choices()),
            "game.settlement.settlementContext" => self.settlement_context(list(a, "choices")),
            "game.settlement.settlementDecisionChoices" => {
                json!(self.settlement_decision_choices())
            }
            "game.settlement.settlementDecisionInput" => {
                self.settlement_decision_input(list(a, "choices"))
            }
            "game.settlement.startSettlement" => {
                json!(self.start_settlement(&a["choice"], text(a, "source")))
            }
            "game.settlement.storedSupply" => json!(self.stored_supply(&c, &o)),
            "game.simulation.choose" => json!(self.choose(
                text(a, "kind"),
                text(a, "answer"),
                a["entity"].as_str().or_else(|| a["entity"]["id"].as_str())
            )),
            "game.simulation.connectSurvivor" => json!(self.connect_survivor(text(a, "id"))),
            "game.simulation.distance" => {
                json!(Point::read(&a["a"]).distance(Point::read(&a["b"])))
            }
            "game.simulation.interact" => self.interact(
                text(a, "tool"),
                num(a, "x"),
                num(a, "y"),
                a["entity"].as_str().or_else(|| a["entity"]["id"].as_str()),
            ),
            "game.simulation.placeBuilding" => {
                json!(self.place_building(text(a, "type"), num(a, "x"), num(a, "y")))
            }
            "game.simulation.reachable" => json!(self.reachable(&c, &o)),
            "game.simulation.relocate" => {
                json!(self.relocate(entity_id(&a["entity"]), Point::read(p)))
            }
            "game.simulation.stepWorld" => {
                self.step_world(num(a, "dt"));
                Value::Null
            }
            "game.simulation.supplyBridge" => json!(self.supply_bridge(text(a, "id"))),
            "game.simulation.upgrade" => json!(self.upgrade(entity_id(&o))),
            "game.simulation.withdrawMaterial" => json!(self.withdraw_material(text(a, "kind"))),
            "game.state.addCreature" => json!(self.add_creature(
                num(a, "x"),
                num(a, "y"),
                a.get("source").filter(|v| !v.is_null())
            )),
            "game.state.addObject" => json!(self.add_object(
                text(a, "type"),
                num(a, "x"),
                num(a, "y"),
                a.get("extra").cloned().unwrap_or(json!({}))
            )),
            "game.state.clamp" => {
                json!(crate::memory::bounded(&a["v"], num(a, "lo"), num(a, "hi")))
            }
            "game.state.createWorld" => self.create_world(flag(&a["options"], "empty"), 18492),
            "game.state.materializeObject" => json!(self.materialize_object(&a["object"])),
            "game.state.migrateWorld" => self.migrate_world(a["raw"].clone())?,
            "game.state.random" => json!(self.random()),
            "game.state.remember" => {
                self.remember(text(a, "kind"), text(a, "message"), a["entity"].as_str());
                Value::Null
            }
            "game.story.answerStory" => {
                self.answer_story(text(a, "response"));
                Value::Null
            }
            "game.story.archiveEntries" => self.archive_entries(),
            "game.story.assessment" => self.assessment(),
            "game.story.collectStoryMessages" => {
                self.collect_story_messages();
                Value::Null
            }
            "game.story.initialEvidence" => crate::story::initial_evidence(),
            "game.story.initialStory" => crate::story::initial_story(),
            "game.story.nextStory" => json!(self.next_story()),
            "game.story.noteEvidence" => {
                self.note_evidence(
                    text(a, "kind"),
                    text(a, "text"),
                    a["amount"].as_f64().unwrap_or(1.),
                    a["entity"].as_str(),
                );
                Value::Null
            }
            "game.story.storyEntry" => json!(crate::story::entry(text(a, "id"))),
            "game.story.updateStory" => {
                self.update_story();
                Value::Null
            }
            "game.theme-compat.themeCompatibleWorld" => {
                crate::save::theme_compatible_world(&a["raw"])?
            }
            "game.timeline.appendTimeline" => call!(
                "timeline.appendTimeline",
                json!({"history":a["input"],"previous":a["previous"],"record":a["record"],"replacement":a["replacement"],"ids":a["ids"]})
            ),
            "game.timeline.historySize" => json!(crate::timeline::history_size(&a["history"])),
            "game.timeline.latestWorld" => crate::timeline::latest_world(&a["branch"])?,
            "game.timeline.readMoment" => {
                crate::timeline::read_moment(&a["branch"], text(a, "id"))?
            }
            "game.traffic.canEnterBridge" => {
                json!(self.can_enter_bridge(&c, Point::read(&a["destination"])))
            }
            "game.work-balance.recordWork" => {
                self.record_work(&c["id"]);
                Value::Null
            }
            "game.work-balance.workOrder" => {
                let first = num(&a["a"], "lastWorkTurn") - num(&a["b"], "lastWorkTurn");
                json!(if first != 0. {
                    first
                } else {
                    num(&a["a"], "birthOrdinal") - num(&a["b"], "birthOrdinal")
                })
            }
            "game.work-balance.workRole" => json!(development::work_role(&self.world, &c)),
            "game.work-balance.working" => json!(development::working(&c)),
            "game.work-projects.addWorkProject" => {
                self.add_work_project(p.clone());
                Value::Null
            }
            "game.work-projects.projectById" => self
                .work_projects()
                .into_iter()
                .find(|p| same_id(&p["id"], &a["id"]))
                .unwrap_or(Value::Null),
            "game.work-projects.projectLimit" => json!(development::project_limit(&self.world)),
            "game.work-projects.removeWorkProject" => {
                self.remove_work_project(&a["id"]);
                Value::Null
            }
            "game.work-projects.workProjects" => json!(self.work_projects()),
            "game.work-projects.workerProject" => json!(self.worker_project(&c)),
            _ => {
                if let Some(value) = self.spatial_contract(&key, a)? {
                    value
                } else {
                    return Err(format!("Unbound public function: {key}"));
                }
            }
        };
        Ok(Some(result))
    }
}

fn public_capacity(o: &Value) -> f64 {
    if text(o, "type") == "bridge" {
        return 4.;
    }
    let n = match text(o, "type") {
        "banana" | "bath" | "log" | "bone" | "ore" | "monolith" | "mountain" => 1.,
        "orchard" => 3.,
        "cricketball" | "mine" | "cannon" => 4.,
        "roundabout" | "factory" => 5.,
        "theatre" => 12.,
        "dwelling" => 6.,
        "sculpture" => 2.,
        _ => 0.,
    };
    n * o["level"].as_f64().filter(|n| *n != 0.).unwrap_or(1.)
}
