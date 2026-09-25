// Release heavyweight model workers when a tab is left behind. Returning uses
// cached files only, and never changes the player's model/download preferences.
export function backgroundBudget({ release, resume, delay = 30000,
  schedule = setTimeout, cancel = clearTimeout }) {
  let timer = null, released = false;
  const suspend = () => {
    if (timer !== null) cancel(timer);
    timer = null;
    if (!released) { released = true; release(); }
  };
  return {
    suspend,
    hidden(value) {
      if (value) {
        if (timer !== null || released) return;
        timer = schedule(() => { timer = null; suspend(); }, delay);
      } else {
        if (timer !== null) cancel(timer);
        timer = null;
        if (released) { released = false; resume(); }
      }
    },
    dispose() { if (timer !== null) cancel(timer); timer = null; },
  };
}
