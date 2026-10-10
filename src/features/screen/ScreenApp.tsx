"use client";
import { useState } from "react";
import { useWorldData, mockWorld } from "./world/source";
import { WorldStage } from "./world/WorldStage";
import type { PairCommand, WorldMode } from "./world/types";
import styles from "./world/world.module.css";
import { isLive } from "@/lib/api/live-client";

export type ScreenState = "question" | "presence" | "mutual" | "real-meet";
const modes: Record<ScreenState, WorldMode> = {
  question: "CHOICE",
  presence: "LIVE",
  mutual: "CHOICE",
  "real-meet": "MEET",
};

export function ScreenApp({
  fixed,
  mock: requestMock = false,
}: {
  fixed?: ScreenState;
  mock?: boolean;
}) {
  const mock = requestMock && process.env.NODE_ENV === "development";
  const data = useWorldData(mock);
  const [pairControl, setPairControl] = useState<{
    action: PairCommand;
    revision: number;
  }>();
  const pairAction = (action: PairCommand) => {
    choose("MEET", true);
    setPairControl((old) => ({ action, revision: (old?.revision ?? 0) + 1 }));
  };
  const [control, setControl] = useState({
    mode: fixed ? modes[fixed] : ("CHOICE" as WorldMode),
    fixed: Boolean(fixed),
    revision: 0,
  });
  const choose = (mode: WorldMode, fixed: boolean) =>
    setControl((old) => ({ mode, fixed, revision: old.revision + 1 }));
  return (
    <main className={styles.viewport}>
      {data === "unavailable" ? (
        <div className={styles.loading} role="status">
          {typeof document !== "undefined" && document.documentElement.dataset.dataMode === "server"
            ? "现场数据暂不可用，正在重新连接。" : "现场数据暂不可用，请在演示入口恢复本地数据。"}
        </div>
      ) : data ? (
        <WorldStage
          key={data.epoch}
          data={data}
          control={control}
          previewIntersection={fixed === "mutual" && !isLive()}
          pairControl={pairControl}
        />
      ) : (
        <div className={styles.loading} role="status">
          世界正在醒来
        </div>
      )}
      {mock && <span className={styles.demoLabel}>虚构演示</span>}
      {mock && process.env.NODE_ENV === "development" && (
        <details className={styles.debug} data-testid="world-debug">
          <summary>虚构世界 · 演示控制</summary>
          <p>独立模拟数据，不改变手机或后台状态</p>
          <div>
            {(["male", "female"] as const).flatMap((gender) =>
              (["CHAT", "WALK", "SERIOUS"] as const).map((field, index) => (
                <button
                  key={`${gender}-${field}`}
                  onClick={() => mockWorld.join(gender, `q1:${index}`)}
                >
                  ADD {gender.toUpperCase()} TO {field}
                </button>
              )),
            )}
            <button onClick={() => mockWorld.burst(5)}>BURST ADD 5</button>
            <button onClick={() => mockWorld.burst(20)}>BURST ADD 20</button>
            <button onClick={() => mockWorld.join()}>加入</button>
            <button onClick={() => mockWorld.answer()}>完成问题</button>
            <button onClick={() => mockWorld.field()}>切换选择</button>
            <button onClick={() => mockWorld.open()}>开放认识</button>
            <button onClick={() => mockWorld.close()}>取消开放</button>
            <button onClick={() => mockWorld.mutual()}>双向确认</button>
            <button onClick={() => mockWorld.meet()}>确认见面</button>
            <button onClick={() => mockWorld.stress()}>143人在场</button>
            <button onClick={() => mockWorld.empty()}>清空世界</button>
            <button onClick={() => mockWorld.reset()}>重置演示</button>
            {(["CHOICE", "LIVE", "MEET"] as const).map((mode) => (
              <button key={mode} onClick={() => choose(mode, true)}>
                {mode}
              </button>
            ))}
            <button onClick={() => choose("CHOICE", false)}>正常轮播</button>
            {[0, 1, 2, 3, 10].map((count) => (
              <button key={count} onClick={() => mockWorld.pairCount(count)}>
                {count} PAIRS
              </button>
            ))}
            <button onClick={() => mockWorld.revokePair()}>REVOKE ONE</button>
            <button onClick={() => mockWorld.duplicatePair()}>
              DUPLICATE EVENT
            </button>
            <button onClick={() => mockWorld.connectPair()}>
              NEW CONNECTION
            </button>
            <button onClick={() => mockWorld.upgradePair()}>
              CONFIRM CONNECTION MEET
            </button>
            <button onClick={() => mockWorld.conflictPair()}>
              SHARED PARTICIPANT
            </button>
            <button onClick={() => mockWorld.failedAvatar()}>
              AVATAR FAILURE
            </button>
            <button onClick={() => mockWorld.network(false)}>
              OFFLINE UNKNOWN GRANTS
            </button>
            <button onClick={() => mockWorld.network(false, true)}>
              OFFLINE VERIFIED GRANTS
            </button>
            <button onClick={() => mockWorld.network(true)}>RECONNECT</button>
            <button onClick={() => mockWorld.unknownStatistics()}>
              UNKNOWN STATISTICS
            </button>
            <button onClick={() => pairAction("next")}>NEXT PAIR</button>
            <button onClick={() => pairAction("previous")}>
              PREVIOUS PAIR
            </button>
            <button onClick={() => mockWorld.meet()}>TRIGGER NEW MEET</button>
            <button onClick={() => pairAction("collision")}>
              TRIGGER COLLISION
            </button>
            <button onClick={() => pairAction("trail")}>TOGGLE TRAIL</button>
            <button onClick={() => pairAction("spark")}>TOGGLE SPARK</button>
            <button onClick={() => mockWorld.meet(20)}>BURST PAIRS</button>
            <button onClick={() => mockWorld.revokePairs()}>
              REVOKE PAIRS
            </button>
            <button onClick={() => mockWorld.onePair()}>ONE PAIR</button>
          </div>
        </details>
      )}
    </main>
  );
}
