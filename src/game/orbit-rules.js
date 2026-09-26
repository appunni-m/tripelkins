// The orbital home grows through real journeys, never automatic reproduction.
export const ORBIT_SETTLERS = 12;
export const GROUND_RESERVE = 8;
export const ORBIT_VOLUNTEER_NEED = 68;
export const orbitalReady = w => w.progress.cannon &&
  w.orbital.launches >= ORBIT_SETTLERS && w.orbital.population >= ORBIT_SETTLERS;

export function orbitalPlan(w) {
  const launcherBuilt = !!w.progress.cannon;
  const launcherInProgress = [w.community.project, ...(w.community.projects || [])]
    .some(p => p?.type === "cannon");
  const launches = Math.floor(w.orbital?.launches || 0);
  const residents = Math.floor(w.orbital?.population || 0);
  const remaining = Math.max(0, Math.min(ORBIT_SETTLERS - launches, ORBIT_SETTLERS - residents));
  const unlocked = !!w.progress.secondContact;
  const activeGoal = w.memory.goals.find(g => g.status === "active");
  const blockingGoal = activeGoal && !["grow", "care"].includes(activeGoal.kind);
  const autonomous = w.community.consent === "accepted" && w.settings.autonomy !== false &&
    w.runtime?.intelligenceAvailable === true && w.stage < 3;
  const missionActive = autonomous && unlocked && !blockingGoal &&
    (!launcherBuilt || (remaining > 0 && w.creatures.length > GROUND_RESERVE));
  const eligible = Math.min(remaining, Math.max(0, w.creatures.length - GROUND_RESERVE));
  return {
    unlocked,
    launcherBuilt,
    launcherInProgress,
    launches,
    residents,
    target: ORBIT_SETTLERS,
    remaining,
    groundReserve: GROUND_RESERVE,
    eligible,
    autonomous,
    missionActive,
    phase: !unlocked ? "locked" : launcherBuilt ? !remaining ? "complete" :
      w.creatures.length > GROUND_RESERVE ? "launch" : "waiting" :
      launcherInProgress ? "building" : "build",
  };
}
