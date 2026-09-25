// Native touch/trackpad scrolling, with page buttons for mouse and keyboard use.
// No per-frame work: only layout, selection and scroll changes update the tray.
export function createToolTray(tray, list, previous, next, signal) {
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let category, selection, frame, wheelEnd;
  const listen = (target, event, handler, options = {}) =>
    target.addEventListener(event, handler, { ...options, signal });
  const columns = () => Number(getComputedStyle(list).getPropertyValue("--tool-columns")) || 4;
  const limit = () => Math.max(0, list.scrollWidth - list.clientWidth);
  const update = () => {
    previous.disabled = list.scrollLeft <= 1;
    next.disabled = list.scrollLeft >= limit() - 1;
  };
  const layout = () => {
    tray.dataset.overflow = String(list.children.length > columns());
    update();
  };
  const schedule = () => { frame ??= requestAnimationFrame(() => { frame = null; layout(); }); };
  const finishWheel = () => {
    clearTimeout(wheelEnd);
    list.style.scrollSnapType = "";
  };
  const reveal = (button, smooth = false) => {
    if (!button) return;
    const box = list.getBoundingClientRect(), item = button.getBoundingClientRect();
    const delta = item.left < box.left + 2 ? item.left - box.left - 2
      : item.right > box.right - 2 ? item.right - box.right + 2 : 0;
    if (Math.abs(delta) > 1) list.scrollBy({ left: delta, behavior: smooth && !motion.matches ? "smooth" : "instant" });
  };
  const page = direction => {
    finishWheel();
    const buttons = [...list.children];
    const stride = buttons.length > 1 ? buttons[1].offsetLeft - buttons[0].offsetLeft : list.clientWidth;
    list.scrollBy({ left: direction * stride * columns(), behavior: motion.matches ? "instant" : "smooth" });
  };
  listen(previous, "click", () => page(-1));
  listen(next, "click", () => page(1));
  listen(list, "scroll", update, { passive: true });
  listen(list, "focusin", event => reveal(event.target.closest("[data-tool]")));
  listen(tray, "wheel", event => {
    if (event.ctrlKey || event.metaKey) return;
    // A mouse wheel moves through the tools; horizontal trackpad gestures remain native.
    event.stopPropagation();
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || !limit()) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientWidth : 1;
    // Keep small wheel deltas fluid, then settle onto a complete card.
    list.style.scrollSnapType = "none";
    list.scrollBy({ left: event.deltaY * unit, behavior: "instant" });
    clearTimeout(wheelEnd);
    wheelEnd = setTimeout(finishWheel, 140);
  }, { passive: false });
  listen(tray, "keydown", event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...list.children], index = buttons.indexOf(event.target.closest("[data-tool]"));
    if (event.key === "PageUp" || event.key === "PageDown" || (index < 0 && event.key.startsWith("Arrow"))) {
      page(["ArrowLeft", "PageUp"].includes(event.key) ? -1 : 1);
      return;
    }
    const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)));
    buttons[target]?.focus({ preventScroll: true });
  });
  const observer = new ResizeObserver(schedule);
  observer.observe(list);
  signal.addEventListener("abort", () => { observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(wheelEnd); }, { once: true });
  return {
    refresh(tab, tool, focusedTool) {
      const changedTab = tab !== category;
      layout();
      if (changedTab) { finishWheel(); list.scrollTo({ left: 0, behavior: "instant" }); }
      if (changedTab || tool !== selection) reveal([...list.children].find(b => b.dataset.tool === tool));
      const focused = [...list.children].find(b => b.dataset.tool === focusedTool);
      focused?.focus({ preventScroll: true });
      category = tab;
      selection = tool;
      update();
    },
  };
}
