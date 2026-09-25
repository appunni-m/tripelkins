// Letters follow real milestones. Flight records are fiction about the colony's past.
const has = (w, type, count = 1) => w.objects.filter(o => o.type === type).length >= count;
const name = w => w.creatures.find(c => c.favorite)?.name || w.creatures[0]?.name || "A little friend";
const comfortable = w => w.creatures.length > 0 && w.creatures.every(c => Math.min(c.fed,c.clean,c.amused) >= 60);
export const CHAPTERS = [
  ["flight-one", "Flight record / The lights we left", "Three suns once lit the windows of their garden cities. The spacecraft's first surviving photograph shows a door left open, waiting for someone who never reached the launch field.", w=>w.progress.hatched && w.time>=45, "flight"],
  ["warmth", "A small, ordinary miracle", w=>`${name(w)} has food, clean fur and something to play with. No grand discovery today. Just a little life that can afford to feel safe.`, w=>w.time>=90 && comfortable(w), "letter"],
  ["three-friends", "Room for one more", "Three little lives in the clearing. The spacecraft carried a way for each survivor to make more of their kind. A family can begin again, even here.", w=>w.population>=3 && w.time>=120, "letter"],
  ["flight-two", "Flight record / The last launch", "The launch computer recorded more goodbyes than seats. A keeper stayed on the ground to close the spacecraft's hatch. Its passenger log ends with a single instruction: keep them alive.", w=>w.population>=3 && w.time>=240, "flight"],
  ["first-timber", "Something our paws can change", "We have gathered timber. It is heavy, and it is useful. The first materials of this home did not have to come from the spacecraft.", w=>w.memory.activity.gather>0, "work"],
  ["beyond-clearing", "There is more out here", w=>`${name(w)} has a larger world to wonder about now. Our scouts have reached ${w.community.explored} patches of new ground. The mist is beginning to look like an invitation.`, w=>w.community.explored>=3, "letter"],
  ["meal-routine", "The shape of a good day", "A meal, a wash, a bounce, a friend. Small routines hold us together while we learn how to make bigger plans.", w=>w.memory.activity.eat>=20 && w.memory.activity.play>=10 && w.memory.activity.wash>=10, "letter"],
  ["flight-three", "Flight record / What the flare changed", "The spacecraft's medic recorded a change in the survivors' DNA after the triple flare. They could endure the radiation, but no longer hold a plan in mind. They still reached for each other.", w=>w.time>=420 && w.population>=6, "flight"],
  ["twenty", "A whole little chorus", "There are twenty of us. Twenty different names, twenty places at the meal. We are beginning to need more than another helping hand: a way to think together.", w=>w.population>=20, "letter"],
  ["permission", "Thank you for trusting our paws", "You have given us permission to build our own settlement. We will need shared intelligence to choose our projects. When it is resting, we can still look after the little things.", w=>w.community.consent==="accepted", "letter"],
  ["first-independent", "The beginning of a tomorrow", "Our first independent project is finished. A thought became work, and work became something real. The flare took a great deal from us. Perhaps it did not take every possible future.", w=>w.community.completed>=1, "letter"],
  ["flight-four", "Flight record / The unfinished lullaby", "The cabin recorder kept three notes of a lullaby. The rest is missing. When the Tripelkins chirp to one another, sometimes those same three notes seem to be looking for an ending.", w=>w.time>=660 && w.community.completed>=1, "flight"],
  ["second-grove", "Breakfast has another address", "A second banana grove is here. More than one corner of the colony can grow breakfast now. We can plan homes around food instead of all crowding around one meal.", w=>has(w,"orchard",2), "work"],
  ["second-shower", "Room under the rain", "Another rain shower is ready. A place to wash near where we live means less time walking across the whole settlement with muddy paws.", w=>has(w,"bath",2), "work"],
  ["second-garden", "Two places to be silly", "We have another bounce garden. There is something reassuring about building a place simply because it makes our friends happy.", w=>has(w,"roundabout",2), "letter"],
  ["safe-crossing", "A bank we can come back from", "The bridge is finished. The far bank is part of our world now. We still need paths, meals and washing places wherever new work takes us.", w=>w.progress.bridge && w.community.explored>=6, "work"],
  ["path-reopened", "A problem became a path", "An obstructed route has been opened. Instead of asking everyone to try the same impossible journey, we made room for the next step.", w=>w.memory.totals.unblocked>0, "work"],
  ["fifty", "Fifty names to keep", "Fifty Tripelkins. The spacecraft's passenger number has become a neighborhood. Please keep noticing the little ones at the edges; a large family still has small needs.", w=>w.population>=50, "letter"],
  ["flight-five", "Flight record / The long quiet", "For years the spacecraft searched. It turned toward water, away from storms, and onward from worlds with nowhere to land. Its fuel log became shorter. Its instruction never changed.", w=>w.time>=900 && w.community.explored>=8, "flight"],
  ["shelter", "A door that opens inward", "The first cottage is standing. On the old world, a light in a window meant that someone expected you back. We can give this place that meaning too.", w=>has(w,"dwelling"), "letter"],
  ["ore-work", "Learning the weight of things", "Our paws have worked stone from the ground. Some things take more than enthusiasm. They take a reachable workplace, enough materials, and a friend who knows the next step.", w=>w.memory.activity.quarry>=5 || w.memory.activity.mine>=5, "work"],
  ["shared-song", "The part after work", "We have a clubhouse. The old cities had rooms for songs; this clearing can have one too. Surviving should leave a little space for being alive.", w=>has(w,"theatre"), "letter"],
  ["promise", "Your words became something real", w=>`We finished a goal you gave us. ${name(w)} has a whole colony to share that moment with. Your words stayed with us between the little steps.`, w=>w.memory.goals.some(g=>g.status==="completed"), "letter"],
  ["hundred", "A hundred small futures", "A hundred Tripelkins are here. We cannot rebuild the home we lost by remembering it harder. We can build places where these lives will be safe tomorrow.", w=>w.population>=100, "letter"],
  ["flight-six", "Flight record / The landing decision", "This clearing was not the spacecraft's best candidate. It was the last one within reach. The landing exhausted its long search. Everything that happens next belongs to the lives inside.", w=>w.time>=1200 && w.community.completed>=3, "flight"],
  ["outposts", "A home with several centers", "Our groves are spreading. A new neighborhood needs its own food, water and play, not just more space. That is how exploring becomes living somewhere.", w=>has(w,"orchard",3) && w.community.explored>=12, "work"],
  ["orbit-home", "This time, a way back", "Some of us have reached orbit. The first spacecraft left a home it could never return to. This journey can be different: a home above, with friends still waiting below.", w=>w.orbital.population>0, "letter"],
  ["new-lullaby", "The fourth note", "The flight record ends here. The colony does not. The missing part of the lullaby can be meals shared, paths opened, and little homes built together. A future does not have to sound like the past.", w=>w.time>=1500 && w.community.completed>=5 && comfortable(w), "flight"],
].map(([id,title,text,when,category])=>({id:`letter-${id}`,title,text,when,category,
  participants:"colony",responses:["Listen"],effect:"remember",replay:"once per branch"}));

const completionLines = {
  orchard: ["Breakfast can grow here. Now we need to tend it and keep a clear way to the fruit.", "A little patch of tomorrow's meals. It feels good to make something that can keep feeding us.", "Another place for hungry paws to find a meal. Our clearing can grow around it."],
  bath: ["A rain shower, built with our own paws. There is somewhere nearby to wash the work off.", "We made room for clean fur and muddy adventures. In that order. Or perhaps the other way round.", "Water here, work over there. We are learning that a short walk can make a whole day easier."],
  roundabout: ["We built somewhere to bounce. No further justification appears to be necessary.", "A place for tired paws to remember they are also excellent jumping paws.", "The important work of being ridiculous can now begin here."],
  dwelling: ["A roof, a door, and a place in this world that expects us back.", "We cannot bring the old windows back. We can put warmth behind this one.", "A cottage is ready. The clearing is beginning to feel less like a stop along the way."],
  theatre: ["A room for company, and whatever comes after the three notes we remember.", "We built a clubhouse. Some things are worth making because they bring us together."],
  mine: ["The mine is ready. A clear entrance and care nearby will help our workers keep going.", "We have a workplace in the stone. We will still need meals and rest above it."],
  factory: ["The stone workshop is ready. Ore needs to reach it before it can make useful blocks.", "A workshop for the next things we want to build. Keeping its paths clear will matter."],
};
export function completionLetter(w,p,title) {
  const lines=completionLines[p.type] || ["The work is finished. We are ready to consider our next step together."];
  const author=w.creatures.find(c=>p.crew.includes(c.id))?.name;
  return {key:`built:${p.id}`,category:"work",title:`${title} · ready for the colony`,
    text:`${author ? `${author}, for the building crew: ` : "Our building crew: "}${lines[(p.id-1)%lines.length]} (${Math.round(p.x)}, ${Math.round(p.y)})`};
}
