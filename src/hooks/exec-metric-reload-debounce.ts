export type ReloadDebouncer = {
  trigger: () => void;
  cancel: () => void;
};

export function createReloadDebouncer(
  reload: () => void | Promise<void>,
  delayMs: number,
): ReloadDebouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    trigger() {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        void reload();
      }, delayMs);
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
