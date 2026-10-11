// The one place that reads the real clock. Services take a `Clock` so tests can pin "now"; the pure rules in
// `lib/services/rules` never call it - they receive `now` as a parameter.

export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** A clock frozen at one instant, for tests. */
export function fixedClock(instant: Date | string): Clock {
  const value = new Date(instant);
  return () => new Date(value.getTime());
}
