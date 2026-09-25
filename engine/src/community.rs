use crate::{
    Engine,
    memory::{clipped, tail},
    value::*,
};
use serde_json::{Value, json};
pub fn initial_community() -> Value {
    json!({"consent":"unasked","project":null,"projects":[],"nextProject":1,"lastProjectAt":-60,"completed":0,"inbox":[],"nextMessage":1,"lastNoticeAt":-60,"visited":[],"explored":0,"activity":[],"plan":null,"workTurn":0,"access":[],"nextAccess":1})
}
impl Engine {
    pub(crate) fn post_message(&mut self, input: Value) -> Option<Value> {
        let time = num(&self.world, "time");
        let s = &mut self.world["community"];
        let key = input["key"].as_str().filter(|k| !k.is_empty());
        if key.is_some_and(|k| list(s, "inbox").iter().any(|m| text(m, "key") == k)) {
            return None;
        }
        let id = num(s, "nextMessage");
        increment(s, "nextMessage", 1.);
        let message = json!({"id":id,"key":key,"title":clipped(input["title"].as_str().unwrap_or("A note from the colony"),100),"text":clipped(text(&input,"text"),1200),"tick":time,"story":input["story"],"action":input["action"],"category":input["category"].as_str().unwrap_or("letter"),"responseRequired":flag(&input,"responseRequired"),"read":false,"notified":false});
        let inbox = s["inbox"].as_array_mut().unwrap();
        inbox.push(message.clone());
        if inbox.len() > 64 {
            let i = inbox
                .iter()
                .position(|m| {
                    flag(m, "read") && m["action"].is_null() && !flag(m, "responseRequired")
                })
                .or_else(|| {
                    inbox
                        .iter()
                        .position(|m| m["action"].is_null() && !flag(m, "responseRequired"))
                })
                .unwrap_or(0);
            inbox.remove(i);
        }
        increment(&mut self.world, "revision", 1.);
        Some(message)
    }
    pub(crate) fn activity(&mut self, kind: &str, message: &str, source: &str, detail: &str) {
        let time = num(&self.world, "time");
        let a = &mut self.world["community"]["activity"];
        if a.as_array().unwrap().last().is_some_and(|last| {
            text(last, "kind") == kind
                && text(last, "text") == message
                && text(last, "source") == source
                && text(last, "detail") == detail
                && time - num(last, "tick") < 30.
        }) {
            return;
        }
        a.as_array_mut().unwrap().push(json!({"tick":time,"kind":kind,"text":clipped(message,220),"source":clipped(source,80),"detail":clipped(detail,300)}));
        *a = json!(tail(a, 40));
    }
    pub(crate) fn offer_independence(&mut self) {
        if num(&self.world, "population") <= 20.
            || text(&self.world["community"], "consent") != "unasked"
            || num(&self.world, "stage") >= 3.
        {
            return;
        }
        self.world["community"]["consent"] = json!("offered");
        self.post_message(json!({"key":"independence","title":"Could we stand on our own?","text":"There are more than twenty of us now. You helped our family survive. Could we use shared intelligence to gather timber and stone, grow food, and build a home of our own?","action":"independence","category":"help"}));
    }
    pub(crate) fn set_independence(&mut self, accepted: bool) -> bool {
        if accepted
            && num(&self.world, "population") <= 20.
            && text(&self.world["community"], "consent") == "unasked"
        {
            return false;
        }
        self.world["community"]["consent"] = json!(if accepted { "accepted" } else { "declined" });
        if !accepted {
            self.world["community"]["project"] = Value::Null;
            self.world["community"]["projects"] = json!([]);
        }
        increment(&mut self.world, "navRevision", 1.);
        for m in self.world["community"]["inbox"].as_array_mut().unwrap() {
            if text(m, "action") == "independence" {
                m["action"] = Value::Null;
                m["read"] = json!(true);
                m["notified"] = json!(true);
            }
        }
        increment(&mut self.world, "commandRevision", 1.);
        increment(&mut self.world, "revision", 1.);
        self.activity(
            "consent",
            if accepted {
                "You let us gather resources and build our own settlement."
            } else {
                "You will guide our building for now."
            },
            "Your choice",
            "",
        );
        true
    }
    pub(crate) fn next_notice(&mut self) -> Option<Value> {
        let time = num(&self.world, "time");
        let c = &mut self.world["community"];
        if time - num(c, "lastNoticeAt") < 50. {
            return None;
        }
        let inbox = c["inbox"].as_array_mut().unwrap();
        let pending: Vec<_> = inbox
            .iter()
            .enumerate()
            .filter(|(_, m)| !flag(m, "notified") && !flag(m, "read"))
            .map(|(i, _)| i)
            .collect();
        let i = pending
            .iter()
            .copied()
            .find(|i| !inbox[*i]["action"].is_null())
            .or_else(|| pending.last().copied())?;
        for old in pending {
            if inbox[old]["action"].is_null() {
                inbox[old]["notified"] = json!(true);
            }
        }
        inbox[i]["notified"] = json!(true);
        let result = inbox[i].clone();
        c["lastNoticeAt"] = json!(time);
        Some(result)
    }
    pub(crate) fn visit_frontier(&mut self, p: Point) {
        self.reveal(p, 10.);
        let key = format!("{}:{}", (p.x / 8.).floor(), (p.y / 8.).floor());
        let c = &mut self.world["community"];
        if !list(c, "visited").iter().any(|v| v.as_str() == Some(&key)) {
            c["visited"].as_array_mut().unwrap().push(json!(key));
            c["visited"] = json!(tail(&c["visited"], 64));
            increment(c, "explored", 1.);
        }
    }
}
fn words(input: &str, terms: &[&str]) -> bool {
    let text = input.to_lowercase();
    terms.iter().any(|term| {
        text.match_indices(term).any(|(i, _)| {
            let is_word = |c: char| c.is_ascii_alphanumeric() || c == '_';
            !text[..i].chars().last().is_some_and(is_word)
                && !text[i + term.len()..].chars().next().is_some_and(is_word)
        })
    })
}
pub fn simple_intent(input: &str) -> &'static str {
    for (id, terms) in [
        (
            "memory",
            &["remember", "earlier", "yesterday", "past", "last time"][..],
        ),
        (
            "status",
            &["how", "feeling", "feel", "need", "hungry", "happy", "okay"],
        ),
        (
            "care",
            &[
                "feed", "eat", "food", "wash", "clean", "play", "care", "rest",
            ],
        ),
        (
            "work",
            &[
                "build",
                "bridge",
                "haul",
                "wood",
                "work",
                "mine",
                "ore",
                "blocks",
                "factory",
                "factories",
            ],
        ),
        ("hello", &["hello", "hi", "hey", "hear", "name"]),
    ] {
        if words(input, terms) {
            return id;
        }
    }
    "wonder"
}
fn locale_number(value: f64) -> String {
    let base = value.to_string();
    let mut split = base.splitn(2, '.');
    let whole = split.next().unwrap_or("0");
    let chars: Vec<_> = whole.chars().collect();
    let mut result = String::new();
    for (i, c) in chars.iter().enumerate() {
        if i > 0 && (chars.len() - i) % 3 == 0 && *c != '-' && chars[i - 1] != '-' {
            result.push(',');
        }
        result.push(*c);
    }
    if let Some(decimals) = split.next() {
        result.push('.');
        result.push_str(decimals);
    }
    result
}
impl Engine {
    pub(crate) fn information_reply(&self, input: &str, listener: Option<&str>) -> String {
        let lower = input.to_lowercase();
        let mut resources: Vec<_> = ["ore", "wood", "blocks", "bones"]
            .into_iter()
            .filter_map(|r| {
                if words(input, &[r]) {
                    lower.find(r).map(|i| (i, r))
                } else {
                    None
                }
            })
            .collect();
        resources.sort_by_key(|(i, _)| *i);
        if words(input, &["how many", "how much"])
            && let Some((_, resource)) = resources.first()
        {
            return format!(
                "We have {} {resource} stored.",
                locale_number(num(&self.world["inventory"], resource).floor())
            );
        }
        if words(input, &["how many"])
            && lower
                .find("how many")
                .is_some_and(|i| words(&lower[i + 8..], &["tripelkins", "creatures", "us"]))
        {
            return format!(
                "There are {} of us, including those in homes and orbit.",
                locale_number(num(&self.world, "population"))
            );
        }
        self.local_reply(simple_intent(input), listener)
    }
    pub(crate) fn local_reply(&self, intent: &str, listener: Option<&str>) -> String {
        let w = &self.world;
        let creatures = list(w, "creatures");
        if creatures.is_empty() {
            return if flag(&w["progress"],"hatched"){"The clearing is quiet. Your story is still saved. Start a new landing in Options to meet another colony."}else{"A tiny sound comes from inside the spacecraft. Tap it in the clearing to meet us."}.into();
        }
        let creature = creatures.iter().find(|c| Some(text(c, "id")) == listener);
        let members: Vec<_> = creature
            .map(|c| vec![c])
            .unwrap_or_else(|| creatures.iter().collect());
        let needs: Vec<_> = ["fed", "clean", "amused"]
            .iter()
            .map(|k| members.iter().map(|c| num(c, k)).sum::<f64>() / members.len() as f64)
            .map(f64::round)
            .collect();
        let min = needs
            .iter()
            .enumerate()
            .min_by(|a, b| a.1.total_cmp(b.1))
            .unwrap()
            .0;
        let subject = if creature.is_some() { "I" } else { "We" };
        match intent {
            "hello" => {
                if let Some(c) = creature {
                    format!(
                        "You found me! I’m {}. It is nice having someone on the other side of the sky.",
                        text(c, "name")
                    )
                } else {
                    format!(
                        "We hear you. There are {} of us now, and you remembered to say hello.",
                        locale_number(num(w, "population"))
                    )
                }
            }
            "status" | "care" => format!(
                "{subject} {}. {} food, cleanliness and play are {} out of 100. {}",
                if needs[min] < 50. {
                    format!(
                        "could really use {}",
                        ["food", "a wash", "time to play"][min]
                    )
                } else {
                    "feel quite comfortable".into()
                },
                if creature.is_some() {
                    "My"
                } else {
                    "Our average"
                },
                needs
                    .iter()
                    .map(|n| n.to_string())
                    .collect::<Vec<_>>()
                    .join(", "),
                if num(&w["progress"], "pollution") > 30. {
                    "The air is getting rather heavy, though."
                } else {
                    "Thank you for checking on us."
                }
            ),
            "work" => format!(
                "Our next goal is: {} We have {} wood and {} ore. Give us somewhere to eat, wash and play while we work.",
                self.current_goal()[1].as_str().unwrap_or(""),
                num(&w["inventory"], "wood").floor(),
                num(&w["inventory"], "ore").floor()
            ),
            "memory" => {
                if let Some(prior) = list(&w["memory"], "conversations").last() {
                    return format!(
                        "You last said, “{}” We kept that little moment with us.",
                        clipped(text(prior, "text"), 160)
                    );
                }
                if let Some(e) = list(&w["memory"], "recent")
                    .iter()
                    .rev()
                    .find(|e| !["plan", "conversation"].contains(&text(e, "kind")))
                {
                    let message = text(e, "message");
                    let message = if text(e, "kind") == "goal" {
                        message
                            .find(" interpreted a lasting goal: ")
                            .map(|i| {
                                format!(
                                    "We agreed on a goal: {}",
                                    &message[i + " interpreted a lasting goal: ".len()..]
                                )
                            })
                            .unwrap_or_else(|| message.into())
                    } else {
                        message.into()
                    };
                    format!("We remember this: {message} Little things add up to a life.")
                } else {
                    "We are making our first memories together.".into()
                }
            }
            _ => format!(
                "There is a whole world beyond this clearing, isn’t there? {subject} {} glad you are here. You can ask how we feel, ask what we remember, or ask us to care for one another and work together.",
                if creature.is_some() { "am" } else { "are" }
            ),
        }
    }
}
impl Engine {
    pub(crate) fn conversation_begin(&mut self, input: &Value) -> Value {
        let message = text(input, "text");
        let constraints = self.parse_constraints(message, input["target"].as_str());
        let target = constraints["listener"]
            .as_str()
            .or(input["target"].as_str());
        let command =
            self.begin_command(message, text(input, "channel"), target, text(input, "id"));
        self.remember("command", message, target);
        json!({"command":command,"target":target})
    }
    pub(crate) fn conversation_complete(&mut self, input: &Value) -> Result<Value, String> {
        let id = text(input, "id");
        if !list(&self.world["memory"], "commands")
            .iter()
            .any(|c| text(c, "id") == id && text(c, "status") == "pending")
        {
            return Ok(json!({"discarded":true}));
        }
        // Model replies cross worker boundaries. A live command can change the
        // colony after the browser checks it but before this queue is reached.
        if input["expectedCommandRevision"].as_f64() != self.world["commandRevision"].as_f64()
            || !input["expectedCommandRevision"].is_number()
        {
            return Err("The colony changed while listening. Please try again.".into());
        }
        let message = text(input, "text");
        let target = input["target"].as_str();
        let answer = &input["answer"];
        if !answer["constraints"].is_null() {
            self.commit_constraints(&answer["constraints"]);
        }
        let mut mood = "reply";
        let mut reply = text(answer, "reply").to_string();
        let source = text(answer, "source");
        let mut goal_id = Value::Null;
        if !answer["goal"].is_null() {
            let objective = self.add_goal(&answer["goal"], message, source)?;
            goal_id = objective["id"].clone();
            for finished in self.advance_goals() {
                self.remember(
                    "goal-complete",
                    &format!(
                        "We reached our goal: {}.",
                        crate::goals::goal_title(&finished)
                    ),
                    None,
                );
            }
            let objective = list(&self.world["memory"], "goals")
                .iter()
                .find(|g| same_id(&g["id"], &objective["id"]))
                .cloned()
                .unwrap_or(objective);
            let state = self.inspect_goal(&objective);
            let title = crate::goals::goal_title(&objective);
            reply = if text(&objective, "status") == "completed" {
                format!("We have already reached that goal: {title}.")
            } else {
                format!(
                    "{}: {title}. {}",
                    match text(&objective, "status") {
                        "queued" => "We’ll remember this for next",
                        "paused" => "This goal is saved and paused",
                        _ => "We’ll keep working toward this",
                    },
                    if !text(&state, "blocker").is_empty() {
                        text(&state, "blocker")
                    } else {
                        text(&state, "step")
                    }
                )
            };
            self.remember("goal", &format!("We agreed on a goal: {title}."), None);
            if self
                .active_goal()
                .is_some_and(|g| same_id(&g["id"], &objective["id"]))
            {
                self.world["memory"]["lastPlan"] = json!({"policy":state["policy"],"source":"Goal planner","tick":num(&self.world,"time").floor(),"goalId":objective["id"]});
                let policy = self.goal_policy();
                let plan = self.make_plan(&policy);
                self.apply_plan(&plan);
            }
            mood = if !text(&state, "blocker").is_empty() {
                "blocked"
            } else {
                "goal"
            };
        }
        let command = self.world["memory"]["commands"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|c| text(c, "id") == id)
            .unwrap();
        command["status"] = json!("completed");
        command["reply"] = json!(clipped(&reply, 500));
        command["source"] = json!(source);
        command["goalId"] = goal_id.clone();
        let listener = target.filter(|id| {
            list(&self.world, "creatures")
                .iter()
                .any(|c| text(c, "id") == *id)
        });
        let turn = json!({"text":message,"reply":clipped(&reply,500),"source":source,"tick":num(&self.world,"time").floor(),"listener":listener});
        self.world["memory"]["conversations"]
            .as_array_mut()
            .unwrap()
            .push(turn);
        self.world["memory"]["conversations"] =
            json!(tail(&self.world["memory"]["conversations"], 24));
        self.remember(
            "conversation",
            &format!("You said: {}", clipped(message, 180)),
            target,
        );
        let posted=self.post_message(json!({"title":"A word with the colony","text":format!("You: {message}\nThe colony: {reply}")}));
        if let Some(posted) = posted
            && let Some(m) = self.world["community"]["inbox"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|m| same_id(&m["id"], &posted["id"]))
        {
            m["notified"] = json!(true);
        }
        self.activity("conversation", "Heard your words", source, &reply);
        Ok(json!({"reply":reply,"mood":mood,"goalId":goal_id,"source":source}))
    }
}
