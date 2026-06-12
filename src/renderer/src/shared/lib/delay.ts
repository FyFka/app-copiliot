export function debounce<This, Args extends unknown[]>(fn: (this: This, ...args: Args) => void, ms: number) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function (this: This, ...args: Args): void {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      fn.apply(this, args);
    }, ms);
  };
}
