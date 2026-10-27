import "server-only";
import { database } from "./db";
import { logServerError } from "./logging";

type Subscriber = (revision: number | null, error?: unknown) => void;
type ActivityPoller = {
  subscribers: Set<Subscriber>;
  revision: number | null;
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
  failures: number;
};
type PollerOptions = {
  readRevision: (activity: string) => Promise<number | null>;
  intervalMs?: number;
  maxErrorDelayMs?: number;
  onError?: (activity: string, error: unknown) => void;
};

export function createLiveVersionPoller({
  readRevision,
  intervalMs = 750,
  maxErrorDelayMs = 30000,
  onError,
}: PollerOptions) {
  const activities = new Map<string, ActivityPoller>();

  function stop(activity: string, poller: ActivityPoller) {
    if (poller.subscribers.size || activities.get(activity) !== poller) return;
    clearTimeout(poller.timer);
    activities.delete(activity);
  }

  function notify(
    activity: string,
    poller: ActivityPoller,
    revision: number | null,
    error?: unknown,
  ) {
    for (const subscriber of [...poller.subscribers]) {
      try {
        subscriber(revision, error);
      } catch (subscriberError) {
        onError?.(activity, subscriberError);
      }
    }
  }

  function schedule(activity: string, poller: ActivityPoller, delay: number) {
    if (activities.get(activity) !== poller || !poller.subscribers.size) return;
    poller.timer = setTimeout(() => void poll(activity, poller), delay);
  }

  async function poll(activity: string, poller: ActivityPoller) {
    if (poller.running || !poller.subscribers.size) return;
    poller.running = true;
    let delay = intervalMs;
    try {
      const revision = await readRevision(activity);
      if (activities.get(activity) !== poller) return;
      if (revision === null) {
        notify(activity, poller, null, new Error("活动不存在。"));
        poller.subscribers.clear();
        stop(activity, poller);
        return;
      }
      poller.failures = 0;
      if (revision !== poller.revision) {
        poller.revision = revision;
        notify(activity, poller, revision);
      }
    } catch (error) {
      if (activities.get(activity) !== poller) return;
      poller.failures++;
      delay = Math.min(intervalMs * 2 ** poller.failures, maxErrorDelayMs);
      onError?.(activity, error);
    } finally {
      poller.running = false;
      schedule(activity, poller, delay);
    }
  }

  function subscribe(activity: string, subscriber: Subscriber) {
    let poller = activities.get(activity);
    if (!poller) {
      poller = {
        subscribers: new Set(),
        revision: null,
        running: false,
        failures: 0,
      };
      activities.set(activity, poller);
    }
    const activePoller = poller;
    activePoller.subscribers.add(subscriber);
    if (activePoller.revision !== null) {
      const revision = activePoller.revision;
      queueMicrotask(() => {
        if (
          activities.get(activity) === activePoller &&
          activePoller.subscribers.has(subscriber)
        ) {
          try {
            subscriber(revision);
          } catch (error) {
            onError?.(activity, error);
          }
        }
      });
    }
    if (!activePoller.timer && !activePoller.running)
      void poll(activity, activePoller);
    return () => {
      activePoller.subscribers.delete(subscriber);
      stop(activity, activePoller);
    };
  }

  return {
    subscribe,
    activeActivityCount: () => activities.size,
  };
}

const liveVersions = createLiveVersionPoller({
  async readRevision(activity) {
    const result = await database().query(
      "SELECT revision FROM dl_activities WHERE id=$1",
      [activity],
    );
    return result.rows[0] ? Number(result.rows[0].revision) : null;
  },
  onError(activity, error) {
    logServerError("api.live.sse_poll_failed", error, {
      route: "/api/live/events",
      method: "GET",
      stage: "revision_poll",
      ...(activity ? { activity } : {}),
    });
  },
});

export function subscribeLiveVersion(activity: string, subscriber: Subscriber) {
  return liveVersions.subscribe(activity, subscriber);
}
