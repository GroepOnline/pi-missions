export {
  acquireMissionLock,
  withMissionLock,
  withLock,
  cleanupStaleLocks,
} from "./core/state.js";

export type LockOptions = {
  retries?: number;
  minTimeout?: number;
  maxTimeout?: number;
  stale?: number;
};
