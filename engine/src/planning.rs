use crate::{Engine, density, development::*, value::*};
use serde_json::{Map, Value, json};
use std::collections::HashSet;
pub const POLICIES: [&str; 6] = ["care", "balanced", "expand", "build", "industry", "mine"];
pub fn policy_name(p: &str) -> &'static str {
    match p {
        "care" => "Recover needs",
        "balanced" => "Share care and useful work",
        "expand" => "Scout new ground and spread the settlement",
        "build" => "Deliver bridge materials",
        "industry" => "Supply ore and produce blocks",
        "mine" => "Reserve mined ore",
        _ => "",
    }
}
fn assignment_key(plan: &Value) -> String {
    let mut a: Vec<_> = list(plan, "assignments")
        .iter()
        .map(|a| {
            format!(
                "{}:{}:{}:{}:{:.2}:{:.2}",
                a["id"],
                text(a, "task"),
                a["target"],
                a["slot"],
                num(&a["point"], "x"),
                num(&a["point"], "y")
            )
        })
        .collect();
    a.sort();
    a.join("|")
}
impl Engine {
    pub fn judge_plan(&mut self, p: &Value) -> Value {
        let mut effects = json!({"care":0.,"material":0.,"production":0.,"discovery":0.,"commitment":0.,"maintenance":0.,"space":0.,"travel":0.});
        let mut issues = Vec::new();
        let assignments = list(p, "assignments");
        for a in assignments {
            let Some(c) = list(&self.world, "creatures")
                .iter()
                .find(|c| same_id(&c["id"], &a["id"]))
                .cloned()
            else {
                issues.push("Missing creature");
                continue;
            };
            let task = text(a, "task");
            if !self.allows_task(task, &c) {
                issues.push("Instruction restriction");
            }
            let care = ["eat", "wash", "play", "home"].contains(&task);
            if minimum(&c) < 35. && !care && !["idle", "rest"].contains(&task) {
                issues.push("Urgent care displaced");
            }
            let travel = Point::read(&c).distance(Point::read(&a["point"])) / 1.65;
            let cycle = travel + 4.;
            if care {
                let needs: &[&str] = match task {
                    "eat" => &["fed"],
                    "wash" => &["clean"],
                    "play" => &["amused"],
                    _ => &["fed", "clean"],
                };
                let deficit = needs
                    .iter()
                    .map(|k| (68. - num(&c, k)).max(0.))
                    .sum::<f64>()
                    / needs.len() as f64;
                increment(&mut effects, "care", deficit / cycle.max(4.));
            }
            if ["haul", "gather", "quarry", "construct"].contains(&task) {
                increment(&mut effects, "material", 3. / cycle.max(4.));
            }
            if ["mine", "work", "refine", "orbit"].contains(&task) {
                increment(
                    &mut effects,
                    "production",
                    if task == "work" { 3. } else { 1. } / cycle.max(4.),
                );
            }
            if task == "explore" {
                increment(&mut effects, "discovery", 1. / cycle.max(4.));
            }
            if task == "clean" {
                increment(&mut effects, "maintenance", 20. / cycle.max(5.));
            }
            if flag(a, "keep") {
                increment(&mut effects, "commitment", 1.);
            }
            increment(
                &mut effects,
                "space",
                density::reward(self.resident_density(Point::read(&a["point"])), 6.)
                    / assignments.len().max(1) as f64,
            );
            increment(
                &mut effects,
                "travel",
                -travel / (60. * assignments.len().max(1) as f64),
            );
        }
        json!({"effects":effects,"issues":issues})
    }
    pub fn feasible_plans(&mut self) -> Vec<Value> {
        self.with_route_costs(|engine| engine.feasible_plans_uncached())
    }
    fn feasible_plans_uncached(&mut self) -> Vec<Value> {
        let mut distinct = HashSet::new();
        let mut all = Vec::new();
        for policy in POLICIES {
            let mut p = self.make_plan(policy);
            let review = self.judge_plan(&p);
            if !list(&review, "issues").is_empty() {
                continue;
            }
            if policy == "care"
                && num(&review["effects"], "care") == 0.
                && !list(&self.world, "creatures")
                    .iter()
                    .any(|c| num(c, "sickness") >= 50.)
            {
                continue;
            }
            let required: &[&str] = match policy {
                "industry" => &["work", "mine", "refine", "orbit"],
                "mine" => &["mine", "quarry"],
                "build" => &["haul", "gather", "construct"],
                _ => &[],
            };
            if !required.is_empty()
                && !list(&p, "assignments")
                    .iter()
                    .any(|a| required.contains(&text(a, "task")))
            {
                continue;
            }
            if distinct.insert(assignment_key(&p)) {
                p.as_object_mut()
                    .unwrap()
                    .extend(review.as_object().unwrap().clone());
                all.push(p);
            }
        }
        let nondominated: Vec<_> = all
            .iter()
            .enumerate()
            .filter(|(i, p)| {
                !all.iter().enumerate().any(|(j, q)| {
                    i != &j
                        && p["effects"]
                            .as_object()
                            .unwrap()
                            .keys()
                            .all(|k| num(&q["effects"], k) >= num(&p["effects"], k))
                        && p["effects"]
                            .as_object()
                            .unwrap()
                            .keys()
                            .any(|k| num(&q["effects"], k) > num(&p["effects"], k) + 0.01)
                })
            })
            .map(|(_, p)| p.clone())
            .collect();
        let mut result = if nondominated.is_empty() {
            all
        } else {
            nondominated
        };
        result.truncate(5);
        result
    }
    pub fn plan_reward(&mut self, p: &Value) -> Value {
        let goal = self.active_goal();
        let kind = goal.as_ref().map(|g| text(g, "kind")).unwrap_or("");
        let crowded = num(&self.density_summary(), "crowded") > 0.;
        let effects = if p["effects"].is_object() {
            p["effects"].clone()
        } else {
            self.judge_plan(p)["effects"].clone()
        };
        let components = json!({"care":num(&effects,"care")*8.,"commitment":num(&effects,"commitment")*0.15,"material":num(&effects,"material")*if ["wood","bridge"].contains(&kind){6.}else{2.},"production":num(&effects,"production")*if ["ore","blocks"].contains(&kind){6.}else{2.},"discovery":num(&effects,"discovery")*if crowded||kind=="grow"{8.}else{3.},"space":num(&effects,"space"),"maintenance":num(&effects,"maintenance")*2.,"travel":num(&effects,"travel")});
        let total = components
            .as_object()
            .unwrap()
            .values()
            .map(number)
            .sum::<f64>();
        json!({"total":total,"components":components})
    }
    pub fn best_plan(&mut self, plans: &[Value]) -> Value {
        let mut scored: Vec<_> = plans
            .iter()
            .map(|p| (p.clone(), num(&self.plan_reward(p), "total")))
            .collect();
        scored.sort_by(|a, b| b.1.total_cmp(&a.1));
        scored
            .into_iter()
            .next()
            .map(|p| p.0)
            .unwrap_or_else(|| self.make_plan("care"))
    }
    pub fn select_plan(
        &mut self,
        policy: Option<&str>,
        source: &str,
        model: &str,
        initial: Option<&Value>,
    ) -> Value {
        let plans = initial
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_else(|| self.feasible_plans());
        let mut selected = plans
            .iter()
            .find(|p| Some(text(p, "id")) == policy)
            .cloned();
        if selected.is_none() && policy.is_some_and(|p| POLICIES.contains(&p)) {
            let mut expanded = self.make_plan(policy.unwrap());
            let review = self.judge_plan(&expanded);
            if list(&review, "issues").is_empty()
                && plans
                    .iter()
                    .any(|p| assignment_key(p) == assignment_key(&expanded))
            {
                expanded
                    .as_object_mut()
                    .unwrap()
                    .extend(review.as_object().unwrap().clone());
                selected = Some(expanded);
            }
        }
        let fallback = self.best_plan(&plans);
        let plan = selected.clone().unwrap_or(fallback);
        let effects = if plan["effects"].is_object() {
            plan["effects"].clone()
        } else {
            self.judge_plan(&plan)["effects"].clone()
        };
        let mut counts: Vec<(String, usize)> = Vec::new();
        for a in list(&plan, "assignments") {
            let task = text(a, "task");
            if let Some(c) = counts.iter_mut().find(|c| c.0 == task) {
                c.1 += 1;
            } else {
                counts.push((task.into(), 1));
            }
        }
        let expected = counts
            .iter()
            .map(|(t, n)| format!("{n} {t}"))
            .collect::<Vec<_>>()
            .join(", ");
        let chosen_source = if selected.is_some() {
            source
        } else {
            "Local fallback"
        };
        let goal = self.active_goal();
        let record = json!({"tick":self.world["time"],"goal":goal.as_ref().map(|g|text(g,"kind")).unwrap_or("colony"),"source":chosen_source,"model":model,"candidate":plan["id"],"facts":format!("{} urgent; {} ore; work {}.",list(&self.world,"creatures").iter().filter(|c|minimum(c)<35.).count(),num(&self.world["inventory"],"ore"),if flag(&self.world["directives"],"pauseWork"){"held"}else{"allowed"}),"expected":expected,"observed":"","rejection":if selected.is_some(){""}else{"Returned choice was unavailable or dominated."},"baseline":self.world["metrics"]["completed"],"completed":0});
        let decisions = self.world["decisions"].as_array_mut().unwrap();
        decisions.push(record);
        if decisions.len() > 32 {
            decisions.drain(..decisions.len() - 32);
        }
        increment(&mut self.world["metrics"], "decisions", 1.);
        json!({"plan":plan,"policy":plan["id"],"source":chosen_source,"model":model,"note":expected,"effects":effects})
    }
}
impl Engine {
    pub fn commit_decision(&mut self, result: &Value) -> bool {
        if result["revision"].as_f64() != self.world["commandRevision"].as_f64()
            || !self.apply_plan(&result["plan"])
        {
            return false;
        }
        let mut counts: Vec<(String, usize)> = Vec::new();
        for a in list(&result["plan"], "assignments") {
            let task = text(a, "task");
            if let Some(c) = counts.iter_mut().find(|c| c.0 == task) {
                c.1 += 1;
            } else {
                counts.push((task.into(), 1));
            }
        }
        let task_name = |task: &str| match task {
            "gather" => "Cutting and gathering timber",
            "quarry" => "Breaking stone and collecting ore",
            "refine" => "Working ore into blocks",
            "construct" => "Building for the colony",
            "clean" => "Caring for the clearing",
            "idle" => "Looking around",
            "explore" => "Investigating",
            "social" => "Spending time together",
            "rest" => "Resting",
            "eat" => "Looking for a banana",
            "wash" => "Taking a shower",
            "play" => "Playing",
            "haul" => "Carrying wood",
            "mine" => "Mining",
            "work" => "Making blocks",
            "home" => "Resting at home",
            "orbit" => "Going to orbit",
            _ => "",
        };
        self.activity(
            "schedule",
            if text(result, "policy") == "care" {
                "Care comes first."
            } else {
                "Chose our next group schedule."
            },
            text(result, "source"),
            &counts
                .iter()
                .map(|(t, n)| format!("{n} {}", task_name(t)))
                .collect::<Vec<_>>()
                .join(" · "),
        );
        self.world["memory"]["lastPlan"] = json!({"policy":result["policy"],"source":result["source"],"tick":num(&self.world,"time").floor(),"goalId":result["goalId"]});
        if let Some(g) = self.active_goal()
            && same_id(&result["goalId"], &g["id"])
            && text(result, "source") != "Cached AI policy"
        {
            let reason = result["note"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| text(&self.inspect_goal(&g), "step").to_owned());
            let review = json!({"tick":num(&self.world,"time").floor(),"policy":result["policy"],"source":result["source"],"reason":reason.chars().take(240).collect::<String>()});
            if let Some(goal) = self.world["memory"]["goals"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|p| same_id(&p["id"], &g["id"]))
            {
                let reviews = goal["reviews"].as_array_mut().unwrap();
                reviews.push(review);
                if reviews.len() > 8 {
                    reviews.drain(..reviews.len() - 8);
                }
            }
        }
        if text(result, "source") != "Cached AI policy" {
            self.remember(
                "plan",
                &format!(
                    "{} chose {}: {} individual assignments.",
                    text(result, "source"),
                    text(result, "policy"),
                    list(&result["plan"], "assignments").len()
                ),
                None,
            );
        }
        true
    }
    pub fn commit_settlement_decision(&mut self, result: &Value) -> bool {
        if flag(&self.world["ui"], "paused")
            || !self.independent()
            || result["revision"].as_f64() != self.world["commandRevision"].as_f64()
        {
            return false;
        }
        if result["choice"].is_object() {
            self.start_settlement(&result["choice"], text(result, "source"))
        } else {
            self.world["community"]["lastProjectAt"] = self.world["time"].clone();
            self.activity(
                "construction",
                "We will keep caring and scouting before building.",
                text(result, "source"),
                "",
            );
            true
        }
    }
    pub fn planning_dispatch(
        &mut self,
        operation: &str,
        input: &Value,
    ) -> Result<Option<Value>, String> {
        let out = match operation {
            "planning.makePlan" | "jobs.makePlan" => {
                self.make_plan(input["policy"].as_str().unwrap_or("balanced"))
            }
            "planning.applyPlan" | "jobs.applyPlan" => json!(self.apply_plan(&input["plan"])),
            "planning.feasiblePlans" => json!(self.feasible_plans()),
            "planning.judgePlan" => self.judge_plan(&input["plan"]),
            "planning.reward" | "planning.planReward" => self.plan_reward(&input["plan"]),
            "planning.bestPlan" => self.best_plan(list(input, "plans")),
            "planning.selectPlan" => {
                if input
                    .get("expectedCommandRevision")
                    .is_some_and(|revision| {
                        revision.as_f64() != self.world["commandRevision"].as_f64()
                    })
                {
                    return Err("The colony changed while planning.".into());
                }
                self.select_plan(
                    input["policy"].as_str(),
                    text(input, "source"),
                    text(input, "model"),
                    input.get("initial").or(input.get("plans")),
                )
            }
            "planning.buildContext" | "planning.context" | "context.build" => {
                self.build_context(input["includePlans"].as_bool().unwrap_or(true))
            }
            "planning.packContext" => crate::context_budget::pack_hosted_context(
                &input["context"],
                input["budget"].as_f64().unwrap_or(16000.) as usize,
            )?,
            "planning.commitDecision" => json!(self.commit_decision(&input["result"])),
            "planning.reschedule" => {
                let policy = input["policy"]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| self.goal_policy());
                let plan = self.make_plan(&policy);
                json!(self.apply_plan(&plan))
            }
            "planning.ui" => {
                let mut states = Map::new();
                for goal in list(&self.world["memory"], "goals").to_vec() {
                    states.insert(text(&goal, "id").into(), self.inspect_goal(&goal));
                }
                json!({"goalStates":states,"health":crate::state::colony_health(&self.world),"building":self.selected_building()})
            }
            "jobs.allowsTask" => json!(self.allows_task(text(input, "task"), &input["creature"])),
            "jobs.workTargets" => json!(self.work_targets(&input["creature"], text(input, "task"))),
            "jobs.syncGroups" => {
                self.sync_groups();
                self.world["groups"].clone()
            }
            "settlement.choices" => json!(self.settlement_choices()),
            "settlement.decisionChoices" => json!(self.settlement_decision_choices()),
            "settlement.decisionInput" => self.settlement_decision_input(list(input, "choices")),
            "settlement.context" => self.settlement_context(list(input, "choices")),
            "settlement.currentChoice" => json!(self.current_settlement_choice(&input["choice"])),
            "settlement.start" => {
                json!(self.start_settlement(&input["choice"], text(input, "source")))
            }
            "settlement.commitDecision" => json!(self.commit_settlement_decision(&input["result"])),
            "settlement.prepareTimber" => {
                self.prepare_timber();
                Value::Null
            }
            "settlement.finish" => json!(self.finish_settlement()),
            "settlement.constructionSlots" => json!(self.construction_slots(&input["project"])),
            "settlement.projectTasks" => json!(self.project_tasks(&input["creature"])),
            "settlement.projectTask" => json!(self.project_task(&input["creature"])),
            "settlement.refiningShortage" => json!(self.refining_shortage(&input["project"])),
            "settlement.localOre" => json!(self.local_ore(&input["project"])),
            "settlement.storedSupply" => {
                json!(self.stored_supply(&input["creature"], &input["object"]))
            }
            "settlement.deliveryStock" => json!(self.delivery_stock(text(input, "kind"))),
            "settlement.refiningOreReserve" => json!(self.refining_ore_reserve()),
            "settlement.independent" => json!(self.independent()),
            "development.plan" => self.development_plan(),
            "development.update" => self.update_development_plan(),
            "development.timberReserve" => timber_reserve(&self.world),
            "development.projectFunded" => json!(project_funded(&self.world, &input["project"])),
            "development.projectRequirements" => {
                project_requirements(&self.world, &input["project"])
            }
            "development.projectStatus" => json!(self.project_status(&input["project"])),
            "development.colonyMilestone" => colony_milestone(&self.world),
            "development.industryMilestone" => industry_milestone(&self.world),
            "care.context" => self.care_context(),
            "care.demand" => json!(self.care_demand(text(input, "type"))),
            "density.at" => self.density_at(Point::read(&input["point"])),
            "density.site" => self.site_density(Point::read(&input["point"])),
            "density.summary" => self.density_summary(),
            "density.reward" => json!(density::reward(
                num(input, "value"),
                input["target"].as_f64().unwrap_or(6.)
            )),
            "outposts.camps" => json!(self.outpost_camps()),
            "outposts.context" => self.outpost_context(),
            "outposts.assess" => self.assess_outpost(
                text(input, "type"),
                Point::read(&input["point"]),
                num(input, "builderDistance"),
                flag(input, "routed"),
            ),
            "outposts.economics" => crate::outposts::outpost_economics(input),
            "outposts.workshopEconomics" => crate::outposts::workshop_economics(input),
            "access.request" => {
                self.request_access(input.clone());
                Value::Null
            }
            "access.review" => {
                self.review_access();
                Value::Null
            }
            "access.choices" => json!(self.clearance_choices()),
            "access.start" => json!(self.start_clearance(&input["choice"], text(input, "source"))),
            "access.task" => json!(self.clearance_task(&input["creature"])),
            "access.context" => self.access_context(),
            "access.brief" => json!(self.access_brief()),
            "access.purpose" => json!(self.access_purpose(&input["request"])),
            "exploration.frontier" => json!(self.frontier(
                &input["creature"],
                list(input, "assignments"),
                input["policy"].as_str().unwrap_or("balanced")
            )),
            "exploration.gain" => json!(self.discovery_gain(Point::read(&input["point"]))),
            "exploration.scoutLimit" => json!(crate::exploration::scout_limit(
                &self.world,
                input["policy"].as_str().unwrap_or("balanced")
            )),
            "goals.active" => json!(self.active_goal()),
            "goals.inspect" => self.inspect_goal(&input["goal"]),
            "goals.policy" => json!(self.goal_policy()),
            "goals.add" => self.add_goal(
                &input["spec"],
                text(input, "command"),
                text(input, "source"),
            )?,
            "goals.change" => json!(self.change_goal(text(input, "id"), text(input, "action"))),
            "goals.advance" => json!(self.advance_goals()),
            "goals.target" => json!(self.goal_target(text(input, "kind"), num(input, "requested"))),
            "goals.normalize" => crate::goals::normalize_goals(&input["goals"]),
            "goals.title" => json!(crate::goals::goal_title(&input["goal"])),
            "commands.input" => crate::commands::command_input(text(input, "text")),
            "commands.options" => crate::commands::command_options(text(input, "text")),
            "goals.numberFromCommand" | "commands.number" => json!(
                crate::commands::number_from_command(text(input, "text"), text(input, "kind"))
            ),
            "commands.parseConstraints" | "commands.constraints" => self.parse_constraints(
                text(input, "text"),
                input["selected"].as_str().or(input["listener"].as_str()),
            ),
            "commands.commit" => {
                self.commit_constraints(&input["result"]);
                Value::Null
            }
            _ => return Ok(None),
        };
        Ok(Some(out))
    }
}
