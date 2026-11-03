import { afterEach, describe, expect, it } from 'vitest';
import { createUnloadGuard, type UnloadGuard } from './unloadGuard';

const leaveBlocked = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('createUnloadGuard', () => {
  const made: UnloadGuard[] = [];
  const guard = () => {
    const g = createUnloadGuard();
    made.push(g);
    return g;
  };

  afterEach(() => {
    for (const g of made.splice(0)) g.release();
  });

  it('asks before leaving while held, and not after it is released', () => {
    const g = guard();
    expect(leaveBlocked()).toBe(false);
    g.hold();
    expect(leaveBlocked()).toBe(true);
    g.release();
    expect(leaveBlocked()).toBe(false);
  });

  it('keeps asking while another guard is held (each has its own listener)', () => {
    const job = guard();
    const pipeline = guard();
    job.hold();
    pipeline.hold();
    job.release();
    expect(leaveBlocked()).toBe(true);
    pipeline.release();
    expect(leaveBlocked()).toBe(false);
  });

  it('is released by one release however often it was held, and a release when not held changes nothing', () => {
    const g = guard();
    g.release();
    g.hold();
    g.hold();
    g.release();
    expect(leaveBlocked()).toBe(false);
  });
});
