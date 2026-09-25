// The orbital home grows through real journeys, never automatic reproduction.
export const ORBIT_SETTLERS = 12;
export const orbitalReady = w => w.progress.cannon &&
  w.orbital.launches >= ORBIT_SETTLERS && w.orbital.population >= ORBIT_SETTLERS;
