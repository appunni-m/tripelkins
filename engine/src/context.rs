//! Bounded factual model input. Candidate assignments remain authoritative locally.
use crate::{Engine, development::*, goals::goal_title, outposts::*, planning::*, value::*};
use serde_json::{Map, Value, json};
fn tail(v: &Value, n: usize) -> Vec<Value> {
    v.as_array()
        .map(|a| a.iter().skip(a.len().saturating_sub(n)).cloned().collect())
        .unwrap_or_default()
}
fn pick(v: &Value, keys: &[&str]) -> Value {
    let mut m = Map::new();
    for k in keys {
        if let Some(x) = v.get(k) {
            m.insert((*k).into(), x.clone());
        }
    }
    Value::Object(m)
}
fn capacity(o: &Value) -> f64 {
    let base = match text(o, "type") {
        "bridge" => return 4.,
        "banana" | "bath" | "log" | "bone" | "ore" | "monolith" | "mountain" => 1.,
        "orchard" => 3.,
        "cricketball" | "mine" | "cannon" => 4.,
        "roundabout" | "factory" => 5.,
        "theatre" => 12.,
        "dwelling" => 6.,
        "sculpture" => 2.,
        _ => 0.,
    };
    base * num(o, "level").max(1.)
}
fn count_tasks(p: &Value) -> Value {
    let mut counts = json!({});
    for a in list(p, "assignments") {
        increment(&mut counts, text(a, "task"), 1.);
    }
    counts
}
impl Engine {
    pub fn settlement_decision_input(&mut self, choices: &[Value]) -> Value {
        let care = self.care_context();
        let reserve = timber_reserve(&self.world);
        let story = colony_milestone(&self.world);
        let industry = industry_milestone(&self.world);
        let care_first = choices
            .iter()
            .any(|c| CARE_BUILDINGS.contains(&text(c, "id")) && num(c, "priority") >= 80.);
        let mut options = Map::new();
        for c in choices {
            let kind = text(c, "id");
            let mut label = if kind == "clearance" {
                format!(
                    "Clear {} to {}",
                    c["obstacle"].as_str().unwrap_or("obstacle"),
                    c["resume"].as_str().unwrap_or("resume blocked work")
                )
            } else if kind == "cannon" {
                "Build one sky launcher for the shared orbital home; send at most twelve volunteers and keep eight on the ground".into()
            } else if c["density"].is_object() {
                let services = care_services(kind);
                format!(
                    "Build {}; {}; help {}; reward {}",
                    if services.is_empty() {
                        building_name(kind).to_owned()
                    } else {
                        services.join("/")
                    },
                    building_cost(kind),
                    num(c, "benefit").js_round(),
                    num(&c["density"], "reward").js_round()
                )
            } else {
                let description = match kind {
                    "crossing" => format!(
                        "Build the bridge with {} wood; open land and mining",
                        num(c, "target")
                    ),
                    "timber" => format!(
                        "Cut trees; store {} wood for future buildings",
                        num(c, "target")
                    ),
                    "quarry" => format!("Break rocks; store {} ore for the goal", num(c, "target")),
                    "refine" => format!(
                        "Quarry and refine {} blocks; unlock workplaces",
                        num(c, "target")
                    ),
                    _ => text(c, "description").into(),
                };
                format!(
                    "{description}; {} local crews",
                    list(c, "camps").len().max(1)
                )
            };
            if flag(&c["outpost"], "worthwhile") {
                label.push_str(&if num(&c["outpost"], "unserved") > 0. {
                    format!(
                        "; support {} remote residents",
                        num(&c["outpost"], "workers")
                    )
                } else {
                    format!(
                        "; saves {} travel seconds",
                        num(&c["outpost"], "savedSeconds").js_round()
                    )
                });
            }
            options.insert(c["key"].as_str().unwrap_or(kind).into(), json!(label));
        }
        options.insert(
            "wait".into(),
            json!(if care_first {
                "Postpone building; no new care capacity"
            } else {
                "Postpone building; no progress on construction or resources"
            }),
        );
        let shortage = ["food", "wash", "play"]
            .iter()
            .map(|k| {
                let s = &care[k];
                format!(
                    "{k}: {} low, {} short, {} urgent",
                    num(s, "low"),
                    num(s, "short"),
                    num(s, "urgent")
                )
            })
            .collect::<Vec<_>>()
            .join("; ");
        let milestone = if !flag(&self.world["progress"], "bridge")
            && choices.iter().any(|c| text(c, "id") == "crossing")
        {
            "Bridge unlocks land and mining."
        } else if num(&self.world, "stage") >= 2.
            && !list(&self.world, "objects")
                .iter()
                .any(|o| text(o, "type") == "factory")
        {
            "Blocks unlock workplaces."
        } else {
            "Grow useful workplaces and neighborhoods."
        };
        let priority = if care_first {
            format!(
                "Urgent care first; {}.",
                if flag(&reserve, "refill") {
                    "replenish timber before optional expansion"
                } else {
                    "gather missing building timber"
                }
            )
        } else {
            format!(
                "{milestone} Urgent care first; otherwise advance goals and unlock work. Gather missing timber."
            )
        };
        let orbital = orbital_plan(&self.world);
        let orbital_context = match text(&orbital, "phase") {
            "build" if flag(&orbital, "missionActive") => "The active orbital mission needs one sky launcher; keep eight residents on the ground.",
            "building" => "The sky launcher already has a building crew; do not start another.",
            _ => "",
        };
        let goal = self.active_goal();
        let goal = goal
            .as_ref()
            .map(|g| text(g, "kind").to_owned())
            .unwrap_or_else(|| {
                if !story.is_null() {
                    format!("first {} blocks", num(&story, "target"))
                } else if !industry.is_null() {
                    "build mines and stone workshops; produce energy".into()
                } else {
                    "grow".into()
                }
            });
        let access = self.access_brief();
        let required = format!(
            "{} residents; {}/{} crews active. Assign free local groups. {shortage}. Wood {} (refill below {}, target {}), ore {}, blocks {}. Goal {goal}. {access} {priority} {orbital_context} Prefer more help and reward closer to zero.",
            list(&self.world, "creatures").len(),
            projects(&self.world).len(),
            project_limit(&self.world),
            num(&reserve, "stock"),
            num(&reserve, "minimum"),
            num(&reserve, "target"),
            num(&self.world["inventory"], "ore").floor(),
            num(&self.world["inventory"], "blocks").floor()
        );
        let parts: Vec<_> = choices
            .iter()
            .map(|c| text(c, "description").to_owned())
            .collect();
        let context = std::iter::once(required.clone())
            .chain(parts.clone())
            .collect::<Vec<_>>()
            .join(" ");
        let question = if flag(&orbital, "missionActive") && text(&orbital, "phase") == "build" {
            "Which listed project and location best advance the goals? Build the one sky launcher for the active orbital mission while protecting urgent care and keeping eight residents on the ground."
        } else {
            "Which project and location best advance the goal?"
        };
        json!({"options":options,"requiredContext":required,"contextParts":parts,"context":context,"question":question,"maxTokens":320})
    }
    pub fn settlement_context(&mut self, choices: &[Value]) -> Value {
        let care = self.care_context();
        let plan = self.development_plan();
        let outposts = self.outpost_context();
        json!({"care":care,"plan":plan,"timber":timber_reserve(&self.world),"orbitalPlan":orbital_plan(&self.world),"densityRule":{"target":6,"above":4,"below":0.6,"units":"residents per 100 ground units; asymmetric squared penalty"},"outposts":outposts,"choices":choices.iter().map(|c|{let mut v=pick(c,&["key","id","target","cost","priority","description","density","benefit","travel","outpost","subgoal","request","blocker"]);v["at"]=json!([c["x"],c["y"]]);if c["camps"].is_array(){v["camps"]=json!(list(c,"camps").iter().map(|p|json!([num(p,"x").js_round(),num(p,"y").js_round()])).collect::<Vec<_>>());}v}).collect::<Vec<_>>()})
    }
    pub fn build_context(&mut self, include_plans: bool) -> Value {
        let started = crate::timing::now();
        let care = self.care_context();
        let objective = self.active_goal();
        let objective_state = objective.as_ref().map(|g| self.inspect_goal(g));
        let mut buckets: Vec<(String, Vec<Value>)> = Vec::new();
        for c in list(&self.world, "creatures") {
            let key = format!(
                "{}:{}",
                (num(c, "x") / 16.).floor(),
                (num(c, "y") / 16.).floor()
            );
            if let Some((_, members)) = buckets.iter_mut().find(|(k, _)| *k == key) {
                members.push(c.clone());
            } else {
                buckets.push((key, vec![c.clone()]));
            }
        }
        if buckets.len() > 8 {
            let others = buckets.drain(7..).flat_map(|(_, m)| m).collect();
            buckets.push(("other camps".into(), others));
        }
        let groups:Vec<_>=buckets.iter().map(|(id,members)|{let mut needs=Map::new();for key in ["fed","clean","amused"]{needs.insert(key.into(),json!({"mean":(members.iter().map(|c|num(c,key)).sum::<f64>()/members.len() as f64).js_round(),"min":members.iter().map(|c|num(c,key)).fold(f64::INFINITY,f64::min).js_round()}));}json!({"id":id,"members":members.iter().map(|c|c["id"].clone()).collect::<Vec<_>>(),"center":[(members.iter().map(|c|num(c,"x")).sum::<f64>()/members.len() as f64).js_round(),(members.iter().map(|c|num(c,"y")).sum::<f64>()/members.len() as f64).js_round()],"needs":needs,"urgent":members.iter().filter(|c|minimum(c)<30.).map(|c|c["id"].clone()).collect::<Vec<_>>()})}).collect();
        let plans = if include_plans {
            self.feasible_plans()
        } else {
            Vec::new()
        };
        let mut workload = json!({"tasks":{},"states":{},"available":0,"useful":0,"projectWorkers":projects(&self.world).iter().map(|p|list(p,"crew").len()).sum::<usize>(),"crews":projects(&self.world).len()});
        for c in list(&self.world, "creatures") {
            increment(&mut workload["tasks"], text(c, "task"), 1.);
            increment(
                &mut workload["states"],
                c["job"]["state"].as_str().unwrap_or("none"),
                1.,
            );
            if ["idle", "rest", "social"].contains(&text(c, "task"))
                && minimum(c) >= 68.
                && num(c, "sickness") < 50.
            {
                increment(&mut workload, "available", 1.);
            }
            if USEFUL_TASKS.contains(&text(c, "task")) {
                increment(&mut workload, "useful", 1.);
            }
        }
        let mut counts = json!({});
        for o in list(&self.world, "objects")
            .iter()
            .filter(|o| self.is_explored(Point::read(o)))
        {
            increment(&mut counts, text(o, "type"), 1.);
        }
        let mut observed: Vec<_> = self
            .nearby_objects(Point::read(&self.world["ui"]), 24.)
            .into_iter()
            .filter(|o| text(o, "id").starts_with("g:") && self.is_explored(Point::read(o)))
            .take(48)
            .collect();
        let selected = text(&self.world["ui"], "selected").to_owned();
        if let Some(o) = self.natural_object(&selected)
            && self.is_explored(Point::read(&o))
            && !observed.iter().any(|p| same_id(&p["id"], &o["id"]))
        {
            observed.insert(0, o);
        }
        let mut observed_counts = json!({});
        for o in &observed {
            increment(&mut observed_counts, text(o, "type"), 1.);
        }
        let milestone = {
            let v = colony_milestone(&self.world);
            if v.is_null() {
                industry_milestone(&self.world)
            } else {
                v
            }
        };
        let development = self.development_plan();
        let blocked = self.access_context();
        let mut long_goal = objective.clone().unwrap_or(Value::Null);
        if let Some(g) = &objective {
            long_goal["title"] = json!(goal_title(g));
            long_goal.as_object_mut().unwrap().extend(
                objective_state
                    .as_ref()
                    .unwrap()
                    .as_object()
                    .unwrap()
                    .clone(),
            );
        }
        let d = &self.world["discovery"];
        let discovery = json!({"area":d["regions"].as_object().map(|m|m.values().map(|n|n.as_u64().unwrap_or(0).count_ones() as f64).sum::<f64>()*num(d,"cell").powi(2)).unwrap_or(0.),"resolution":d["cell"],"regions":d["regions"].as_object().map_or(0,|m|m.len())});
        let area = if self.is_explored(Point::read(&self.world["ui"])) {
            crate::terrain::biome(
                num(&self.world["map"], "seed") as u32,
                Point::read(&self.world["ui"]),
            )
        } else {
            "unexplored"
        };
        let orbital = orbital_plan(&self.world);
        let candidates:Vec<_>=plans.iter().map(|p|{let reward=self.plan_reward(p);json!({"id":p["id"],"description":policy_name(text(p,"id")),"allocation":count_tasks(p),"expected":p["effects"],"reward":reward,"groups":groups.iter().map(|g|json!({"id":g["id"],"jobs":list(p,"assignments").iter().filter(|a|list(g,"members").iter().any(|id| same_id(id, &a["id"]))).cloned().collect::<Vec<_>>()})).collect::<Vec<_>>()})}).collect();
        let memory = &self.world["memory"];
        let commands: Vec<_> = list(memory, "commands")
            .iter()
            .filter(|c| text(c, "status") != "pending")
            .cloned()
            .collect();
        let growth = &self.world["runtime"]["growth"];
        let mut context = json!({"version":4,"workload":workload,"currentMilestone":milestone,"developmentPlan":development,"timber":timber_reserve(&self.world),"blockedWork":blocked,"growthBudget":if growth.is_object(){json!({"target":growth["target"],"held":growth["held"],"reason":growth["reason"],"metric":growth["source"],"renderDuty":growth["gpuDuty"]})}else{Value::Null},"care":care,"commandRevision":self.world["commandRevision"],"permissions":self.world["directives"],"independence":{"consent":self.world["community"]["consent"],"project":self.world["community"]["project"],"crews":projects(&self.world).iter().map(|p|json!({"id":p["id"],"type":p["type"],"at":[num(p,"x").js_round(),num(p,"y").js_round()],"members":list(p,"crew").len(),"target":p["target"],"blocked":p["blocked"]})).collect::<Vec<_>>(),"crewCapacity":project_limit(&self.world),"completed":self.world["community"]["completed"],"scouted":self.world["community"]["explored"]},"projects":list(&self.world,"groups").iter().map(|g|json!({"id":g["id"],"role":g["role"],"project":g["project"],"members":list(g,"members").len()})).collect::<Vec<_>>(),"orbital":self.world["orbital"],"orbitalPlan":orbital.clone(),"district":self.world["district"],"story":{"premise":"Tripelkins escaped a three-star system's simultaneous flares. A fictional DNA change preserved their bodies and instincts but cost them deliberate planning. Care helps them survive and multiply; shared intelligence, with the player's permission after twenty residents, helps them rebuild independently. Do not claim invented events or completed tasks.","completed":tail(&self.world["story"]["completed"],4),"promises":tail(&self.world["story"]["promises"],3)},"outcomes":tail(&self.world["decisions"],3),"tick":num(&self.world,"time").floor(),"population":self.world["population"],"represented":list(&self.world,"creatures").len(),"cohort":self.world["cohort"],"stage":self.world["stage"],"goal":self.current_goal()[1],"longTermGoal":long_goal,"goalQueue":list(memory,"goals").iter().filter(|g|text(g,"status")=="queued").map(|g|pick(g,&["id","kind","target","command"])).collect::<Vec<_>>(),"bridge":self.world["progress"]["bridge"],"bridgeConstruction":self.bridge_project(None),"terrain":{"generation":self.world["map"]["version"],"area":area,"discovery":discovery,"region":[(num(&self.world["ui"],"x")/16.).floor(),(num(&self.world["ui"],"y")/16.).floor()],"scope":"Fog clears around creatures, never the camera. Only explored objects are listed. Procedural world. Listed objects include saved colony objects and a bounded resource sample near the player's view. Object counts cover saved objects only. Jobs use nearby reachable facilities.","observedResources":observed_counts},"inventory":self.world["inventory"],"pollution":num(&self.world["progress"],"pollution").js_round(),"groups":groups,"objects":list(&self.world,"objects").iter().chain(&observed).filter(|o|self.is_explored(Point::read(o))&&!["tree","flowers","stump"].contains(&text(o,"type"))).map(|o|json!({"id":o["id"],"type":o["type"],"at":[(num(o,"x")*10.).js_round()/10.,(num(o,"y")*10.).js_round()/10.],"stock":num(o,"stock").floor(),"deliveredOre":num(o,"inputOre"),"capacity":capacity(o),"level":o["level"],"quality":num(o,"quality").max(1.)})).collect::<Vec<_>>(),"objectCounts":counts,"player":{"tool":self.world["ui"]["tool"],"selected":self.world["ui"]["selected"],"viewport":[num(&self.world["ui"],"x").js_round(),num(&self.world["ui"],"y").js_round(),self.world["ui"]["zoom"]]},"memory":{"totals":memory["totals"],"summary":memory["summary"],"commands":commands.iter().skip(commands.len().saturating_sub(3)).map(|c|pick(c,&["text","status","reply","goalId"])).collect::<Vec<_>>(),"choices":tail(&memory["choices"],6),"recent":tail(&memory["recent"],6).iter().map(|e|pick(e,&["kind","message"])).collect::<Vec<_>>(),"previous":memory["lastPlan"],"conversations":tail(&memory["conversations"],6),"completedJobs":tail(&memory["jobs"],16),"jobTotals":memory["activity"]},"candidates":candidates});
        if let Some(g) = context["growthBudget"].as_object_mut() {
            for (to, from) in [
                ("target", "target"),
                ("held", "held"),
                ("reason", "reason"),
                ("metric", "source"),
                ("renderDuty", "gpuDuty"),
            ] {
                if growth.get(from).is_none() {
                    g.remove(to);
                }
            }
        }
        let min_values: Vec<f64> = ["fed", "clean", "amused"]
            .iter()
            .map(|key| {
                if groups.is_empty() {
                    0.
                } else {
                    groups
                        .iter()
                        .map(|g| num(&g["needs"][key], "min"))
                        .fold(f64::INFINITY, f64::min)
                }
            })
            .collect();
        let minimum = min_values
            .iter()
            .map(|n| n.to_string())
            .collect::<Vec<_>>()
            .join("/");
        let goal_label = objective
            .as_ref()
            .map(|g| text(g, "kind").to_owned())
            .unwrap_or_else(|| {
                if text(&milestone, "kind") == "blocks" {
                    format!("first {} blocks", num(&milestone, "target"))
                } else if !milestone.is_null() {
                    "mine ore and produce energy".into()
                } else {
                    "healthy growth".into()
                }
            });
        let mut local = vec![format!(
            "Work {}; factories {}. Lowest food/clean/play {minimum}. Goal {goal_label}. {}/{} healthy residents available. Protect urgent care; otherwise put available residents to useful work or scouting. {}",
            if flag(&self.world["directives"], "pauseWork") {
                "paused"
            } else {
                "allowed"
            },
            if flag(&self.world["directives"], "avoidPollution") {
                "held"
            } else {
                "allowed"
            },
            num(&workload, "available"),
            list(&self.world, "creatures").len(),
            self.access_brief()
        )];
        local.push(match text(&orbital, "phase") {
            "locked" => "The orbital home is locked until second contact.".into(),
            "building" => "Our sky launcher is being built; finish that crew's work before assigning volunteers.".into(),
            "build" if flag(&orbital, "missionActive") => "Active orbital mission: build one sky launcher, then send up to twelve healthy volunteers while keeping eight residents on the ground.".into(),
            "build" => "A sky launcher is unlocked; hold its mission until independence is active and any resource goal is complete.".into(),
            "launch" => format!(
                "Orbital home {}/{} journeys; {}. Send healthy non-favorites only and keep eight residents on the ground.",
                num(&orbital, "launches"),
                num(&orbital, "target"),
                if flag(&orbital, "missionActive") { "the independent mission is active" } else { "waiting for independence or completion of the active resource goal" }
            ),
            "waiting" => "The orbital mission is waiting until at least nine residents can stay on the ground.".into(),
            _ => format!("The orbital home has its {} journeys. Do not send more residents.", num(&orbital, "target")),
        });
        for p in &plans {
            local.push(format!("{} planning score {:.2}; density cost {:.2}, travel cost {:.2}. Higher is better; estimates, not learned rewards.",text(p,"id"),num(&self.plan_reward(p),"total"),num(&p["effects"],"space"),num(&p["effects"],"travel")));
        }
        local.push(format!("Care capacity: {}.", care_summary(&care)));
        local.push(format!("Expansion: {}. Density target {} per 100 ground units; crowding penalty 4, isolation penalty 0.6. Child goals: {}.",if flag(&development,"expanding"){"scout new neighborhoods"}else{"balance space and care"},num(&development["density"],"target"),list(&development,"children").iter().filter(|s|text(s,"status")!="satisfied").map(|s|text(s,"kind")).collect::<Vec<_>>().join(",")));
        local.push(format!("Independent development {}; {} local crews, {} assigned workers. {}. Scouted {} areas.",text(&self.world["community"],"consent"),num(&workload,"crews"),num(&workload,"projectWorkers"),projects(&self.world).iter().take(3).map(|p|format!("{}: {}",project_name(p),self.project_status(p))).collect::<Vec<_>>().join("; "),num(&self.world["community"],"explored")));
        local.push(format!(
            "Lowest food/clean/play {minimum} (0 urgent,100 full). Population {}.",
            num(&self.world, "population")
        ));
        local.push(if let Some(g) = &objective {
            let s = objective_state.as_ref().unwrap();
            format!(
                "Goal {} {}/{}. Next {}. {}",
                text(g, "kind"),
                num(s, "value"),
                num(g, "target"),
                text(s, "policy"),
                text(s, "blocker")
            )
        } else {
            "No active player goal.".into()
        });
        local.push(format!(
            "Food {} bananas,{} orchards; wash {}; play {}; homes {}.",
            num(&counts, "banana"),
            num(&counts, "orchard"),
            num(&counts, "bath"),
            num(&counts, "cricketball") + num(&counts, "roundabout") + num(&counts, "theatre"),
            num(&counts, "dwelling")
        ));
        let construction = &context["bridgeConstruction"];
        local.push(format!(
            "Bridge {}. Wood {}; ore {}; pollution {}.",
            if flag(&self.world["progress"], "bridge") {
                String::from("done")
            } else {
                format!(
                    "{}/{} delivered; {} materials waiting",
                    num(construction, "delivered"),
                    construction["required"].as_f64().unwrap_or(24.),
                    num(construction, "staged")
                )
            },
            num(&self.world["inventory"], "wood"),
            num(&self.world["inventory"], "ore"),
            num(&self.world["progress"], "pollution").js_round()
        ));
        let mut by_need = groups.clone();
        let group_min = |g: &Value| {
            ["fed", "clean", "amused"]
                .iter()
                .map(|k| num(&g["needs"][k], "min"))
                .fold(f64::INFINITY, f64::min)
        };
        by_need.sort_by(|a, b| group_min(a).total_cmp(&group_min(b)));
        for g in by_need {
            local.push(format!(
                "{}: {} creatures; needs {}/{}/{}.",
                text(&g, "id"),
                list(&g, "members").len(),
                num(&g["needs"]["fed"], "min"),
                num(&g["needs"]["clean"], "min"),
                num(&g["needs"]["amused"], "min")
            ));
        }
        local.push(format!(
            "Lifetime births {}, losses {}.",
            num(&self.world["memory"]["totals"], "birth"),
            num(&self.world["memory"]["totals"], "loss")
        ));
        local.push(format!(
            "Near the player's view: {area}; {} wild trees, {} mineral nodes in the sampled area.",
            num(&observed_counts, "tree"),
            num(&observed_counts, "node")
        ));
        let key = json!([
            self.world["stage"],
            self.world["commandRevision"],
            orbital.clone(),
            self.world["community"]["consent"],
            self.work_projects(),
            workload,
            self.world["memory"]["activity"],
            list(&self.world["community"], "access")
                .iter()
                .map(|r| json!([r["id"], r["status"], r["blocker"], r["crew"]]))
                .collect::<Vec<_>>(),
            care,
            self.world["discovery"]["revision"],
            context["timber"],
            num(&self.world["inventory"], "blocks").floor(),
            plans
                .iter()
                .map(|p| json!([p["id"], count_tasks(p)]))
                .collect::<Vec<_>>(),
            list(&self.world, "objects")
                .iter()
                .map(|o| json!([o["id"], num(o, "stock").floor(), num(o, "inputOre").floor()]))
                .collect::<Vec<_>>(),
            self.world["progress"]["bridge"],
            groups
                .iter()
                .map(|g| json!([
                    g["id"],
                    list(g, "members").len(),
                    (num(&g["needs"]["fed"], "min") / 10.).floor(),
                    (num(&g["needs"]["clean"], "min") / 10.).floor(),
                    (num(&g["needs"]["amused"], "min") / 10.).floor()
                ]))
                .collect::<Vec<_>>(),
            counts,
            (num(&self.world["inventory"], "ore") / 3.).floor(),
            (num(&self.world["progress"], "pollution") / 20.).floor(),
            self.world["ui"]["tool"],
            self.world["memory"]["choices"],
            self.world["memory"]["lastPlan"]["policy"],
            list(&self.world["memory"], "conversations")
                .last()
                .map(|c| c["text"].clone()),
            objective.as_ref().map(|g| {
                let s = objective_state.as_ref().unwrap();
                json!([
                    g["id"],
                    g["kind"],
                    g["target"],
                    (num(s, "progress") * 10.).floor(),
                    s["blocker"],
                    s["policy"]
                ])
            })
        ]);
        let mut options = Map::new();
        for p in &plans {
            let counts = count_tasks(p);
            let assignments = list(p, "assignments");
            options.insert(
                text(p, "id").into(),
                json!(format!(
                    "{} orbital volunteers; {} scouts; {} other workers; {} rest; {} recover.",
                    assignments
                        .iter()
                        .filter(|a| text(a, "task") == "orbit")
                        .count(),
                    num(&counts, "explore"),
                    assignments
                        .iter()
                        .filter(|a| USEFUL_TASKS.contains(&text(a, "task"))
                            && !["explore", "orbit"].contains(&text(a, "task")))
                        .count(),
                    assignments
                        .iter()
                        .filter(|a| ["idle", "rest", "social"].contains(&text(a, "task")))
                        .count(),
                    assignments
                        .iter()
                        .filter(|a| ["eat", "wash", "play", "home"].contains(&text(a, "task")))
                        .count()
                )),
            );
        }
        let question = if flag(&orbital, "missionActive") && text(&orbital, "phase") == "launch" {
            "Which crew allocation sends eligible volunteers to orbit, protects care, and keeps eight residents on the ground?"
        } else {
            "Which crew allocation makes useful progress without unnecessary care or leaving healthy residents idle?"
        };
        json!({"context":context,"maxTokens":320,"question":question,"options":options,"local":local.join(" "),"localParts":local,"plans":plans,"key":crate::value::js_json(&key),"prepMs":crate::timing::now()-started})
    }
}
