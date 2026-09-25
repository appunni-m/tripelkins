import { goal } from "./catalog.js";

export const INTENTS = {
  hello: "Greeting or introduction",
  status: "Ask about feelings or needs",
  care: "Request food cleaning or play",
  work: "Request building mining or work",
  memory: "Ask about past events",
  wonder: "Other question or conversation",
};
export function informationReply(w, text, listener) {
  const resource = /\b(ore|wood|blocks|bones)\b/i.exec(text)?.[1].toLowerCase();
  if (resource && /\b(?:how many|how much)\b/i.test(text))
    return `We have ${Math.floor(w.inventory[resource] || 0).toLocaleString()} ${resource} stored.`;
  if (/\b(?:how many)\b.*\b(?:tripelkins|creatures|us)\b/i.test(text))
    return `There are ${w.population.toLocaleString()} of us, including those in homes and orbit.`;
  return localReply(w, simpleIntent(text), listener);
}
export function simpleIntent(text) {
  if (/\b(remember|earlier|yesterday|past|last time)\b/i.test(text))
    return "memory";
  if (/\b(how|feeling|feel|need|hungry|happy|okay)\b/i.test(text))
    return "status";
  if (/\b(feed|eat|food|wash|clean|play|care|rest)\b/i.test(text))
    return "care";
  if (
    /\b(build|bridge|haul|wood|work|mine|ore|blocks|factory|factories)\b/i.test(text)
  )
    return "work";
  if (/\b(hello|hi|hey|hear|name)\b/i.test(text)) return "hello";
  return "wonder";
}
export function localReply(w, intent, listener) {
  if (!w.creatures.length)
    return w.progress.hatched
      ? "The clearing is quiet. Your story is still saved. Start a new landing in Options to meet another colony."
      : "A tiny sound comes from inside the spacecraft. Tap it in the clearing to meet us.";
  const creature = w.creatures.find((c) => c.id === listener);
  const members = creature ? [creature] : w.creatures;
  const names = { fed: "food", clean: "a wash", amused: "time to play" };
  const needs = Object.keys(names)
    .map((key) => [
      key,
      Math.round(members.reduce((n, c) => n + c[key], 0) / members.length),
    ])
    .sort((a, b) => a[1] - b[1]);
  const subject = creature ? "I" : "We";
  if (intent === "hello")
    return creature
      ? `You found me! I’m ${creature.name}. It is nice having someone on the other side of the sky.`
      : `We hear you. There are ${w.population.toLocaleString()} of us now, and you remembered to say hello.`;
  if (intent === "status" || intent === "care")
    return `${subject} ${needs[0][1] < 50 ? `could really use ${names[needs[0][0]]}` : "feel quite comfortable"}. ${creature ? "My" : "Our average"} food, cleanliness and play are ${["fed", "clean", "amused"].map((key) => Math.round(members.reduce((n, c) => n + c[key], 0) / members.length)).join(", ")} out of 100. ${w.progress.pollution > 30 ? "The air is getting rather heavy, though." : "Thank you for checking on us."}`;
  if (intent === "work")
    return `Our next goal is: ${goal(w)[1]} We have ${Math.floor(w.inventory.wood)} wood and ${Math.floor(w.inventory.ore)} ore. Give us somewhere to eat, wash and play while we work.`;
  if (intent === "memory") {
    const prior = w.memory.conversations.at(-1);
    if (prior)
      return `You last said, “${prior.text.slice(0, 160)}” We kept that little moment with us.`;
    const event = w.memory.recent
      .filter((e) => !["plan", "conversation"].includes(e.kind))
      .at(-1);
    return event
      ? `We remember this: ${event.kind === "goal" ? event.message.replace(/^.*? interpreted a lasting goal: /, "We agreed on a goal: ") : event.message} Little things add up to a life.`
      : "We are making our first memories together.";
  }
  return `There is a whole world beyond this clearing, isn’t there? ${subject} ${creature ? "am" : "are"} glad you are here. You can ask how we feel, ask what we remember, or ask us to care for one another and work together.`;
}
