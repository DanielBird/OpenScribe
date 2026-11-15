import { afterEach, describe, expect, it, vi } from 'vitest';

const setCloseGuard = vi.fn<(active: boolean) => void>();
vi.mock('../desktop/closeGuard', () => ({ setCloseGuard: (a: boolean) => setCloseGuard(a) }));
const { anyGuardHeld, createUnloadGuard } = await import('./unloadGuard');
type UnloadGuard = ReturnType<typeof createUnloadGuard>;

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
    setCloseGuard.mockReset();
    vi.unstubAllGlobals();
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

  it('in the desktop app, asks before closing while any guard is held, saying so only on a change', () => {
    vi.stubGlobal('__DESKTOP__', true);
    const job = guard();
    const translation = guard();
    job.hold();
    translation.hold();
    job.hold();
    expect(setCloseGuard.mock.calls).toEqual([[true]]);
    job.release();
    expect(anyGuardHeld()).toBe(true);
    translation.release();
    expect(setCloseGuard.mock.calls).toEqual([[true], [false]]);
    expect(anyGuardHeld()).toBe(false);
  });

  it('tells nothing to Rust in the web build', () => {
    const g = guard();
    g.hold();
    g.release();
    expect(setCloseGuard).not.toHaveBeenCalled();
  });
});
