import { ref, computed, onMounted, onUnmounted, type Ref } from "vue";

const THRESHOLD = 64; // px of hidden content at which fade reaches full opacity

/**
 * Detects horizontal overflow on a scroll container and returns reactive
 * fade opacity values (0–1) for left/right indicators. Opacity ramps up
 * proportionally to how much content is hidden, so the fade is subtle when
 * little is hidden and prominent when a lot is. Reacts to scroll + ResizeObserver.
 */
export function useScrollFade(elRef: Ref<HTMLElement | null>) {
  const fadeLeft = ref(0);
  const fadeRight = ref(0);
  const isScrollable = ref(false);

  function check() {
    const el = elRef.value;
    if (!el) return;
    const hiddenLeft = el.scrollLeft;
    const hiddenRight = Math.max(el.scrollWidth - el.clientWidth - el.scrollLeft - 1, 0);
    fadeLeft.value = Math.min(hiddenLeft / THRESHOLD, 1);
    fadeRight.value = Math.min(hiddenRight / THRESHOLD, 1);
    isScrollable.value = el.scrollWidth > el.clientWidth;
  }

  let ro: ResizeObserver | null = null;

  onMounted(() => {
    const el = elRef.value;
    if (!el) return;
    el.addEventListener("scroll", check, { passive: true });
    ro = new ResizeObserver(check);
    ro.observe(el);
    check();
  });

  onUnmounted(() => {
    elRef.value?.removeEventListener("scroll", check);
    ro?.disconnect();
  });

  const fadeStyle = computed(() => ({
    "--fade-left": fadeLeft.value,
    "--fade-right": fadeRight.value,
  }));

  return { fadeLeft, fadeRight, fadeStyle, isScrollable };
}
