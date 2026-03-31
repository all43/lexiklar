import { ref, onMounted, onUnmounted, type Ref } from "vue";

/**
 * Detects horizontal overflow on a scroll container and returns reactive flags
 * for left/right fade indicators. Reacts to both scroll events and ResizeObserver.
 */
export function useScrollFade(elRef: Ref<HTMLElement | null>) {
  const canScrollLeft = ref(false);
  const canScrollRight = ref(false);

  function check() {
    const el = elRef.value;
    if (!el) return;
    canScrollLeft.value = el.scrollLeft > 0;
    canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
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

  return { canScrollLeft, canScrollRight };
}
