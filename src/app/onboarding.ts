/** The first run is in progress: signing in, then picking repositories. The shell waits for it. */
let inProgress = false;
export const onboarding = {
  get: () => inProgress,
  set: (v: boolean) => {
    inProgress = v;
  },
};
