import { useState, useSyncExternalStore } from "react";
import Taro, { useLoad, useDidShow, useDidHide, useUnload } from "@tarojs/taro";
import { View, Text, Button, Input, Picker, Switch } from "@tarojs/components";
import { QUESTIONS, AGES } from "@/data/questions";
import {
  currentInvite,
  counterpart,
  recommendations,
  commonAnswers,
  complete,
} from "@/domain/selectors";
import type { Participant, DemoState } from "@/domain/types";
import { client, API_ORIGIN } from "../../lib/client";
import { Avatar } from "../../components/Avatar";
import { AvatarEditor } from "../../components/AvatarEditor";
import { MemberWallConsent } from "../../components/MemberWallConsent";
import { ServiceForm } from "../../components/ServiceForm";
import "./index.scss";

function Profile({
  me,
  busy,
  done,
}: {
  me: Participant;
  busy: boolean;
  done: () => void;
}) {
  const [name, setName] = useState(me.name),
    [gender, setGender] = useState(me.gender),
    [age, setAge] = useState(me.age || AGES[0]),
    [ready, setReady] = useState(me.ready);
  async function save() {
    try {
      await client.send({
        type: "profile",
        name,
        gender,
        age,
        ready,
        avatarId:
          gender === me.gender ? me.avatarId || `${gender}_01` : `${gender}_01`,
      });
      done();
    } catch {}
  }
  return (
    <View className="card">
      <Text className="title">让彼此更容易认识</Text>
      <Text className="label">活动昵称</Text>
      <Input
        className="input"
        value={name}
        maxlength={5}
        placeholder="1–5 个汉字"
        disabled={busy}
        onInput={(e) => setName(e.detail.value)}
      />
      <Text className="label">性别</Text>
      <View className="row">
        {(["male", "female"] as const).map((g) => (
          <Button
            key={g}
            className={gender === g ? "choice selected" : "choice"}
            disabled={busy}
            onClick={() => setGender(g)}
          >
            {g === "male" ? "男生" : "女生"}
          </Button>
        ))}
      </View>
      <Text className="label">年龄段</Text>
      <Picker
        range={[...AGES]}
        value={Math.max(0, AGES.indexOf(age as (typeof AGES)[number]))}
        onChange={(e) => setAge(AGES[Number(e.detail.value)])}
      >
        <View className="input">{age}</View>
      </Picker>
      <View className="permission">
        <Switch
          checked={ready}
          disabled={busy}
          onChange={(e) => setReady(e.detail.value)}
        />
        <Text>愿意接收相遇邀请</Text>
      </View>
      <Button
        className="primary"
        disabled={busy || !name.trim()}
        onClick={save}
      >
        保存，继续探索
      </Button>
    </View>
  );
}
function InviteFlow({
  state,
  me,
  busy,
}: {
  state: DemoState;
  me: Participant;
  busy: boolean;
}) {
  const invite = currentInvite(state, me)!;
  const partner = state.participants.find(
      (p) => p.id === counterpart(invite, me.id),
    ),
    point = state.points.find((p) => p.id === invite.pointId);
  const send = (type: string, more = {}) => {
    void client
      .send({ type, invitationId: invite.id, ...more })
      .catch(() => {});
  };
  const terminal = ["DECLINED", "CANCELLED", "EXPIRED", "MEET_FAILED"].includes(
    invite.status,
  );
  const bothArrived =
    !!invite.arrivals[invite.from] && !!invite.arrivals[invite.to];
  const permit = !!invite.acceptedAt && (!terminal || !!invite.realMeetAt);
  const allowed = state.displayGrants?.[invite.id]?.[me.id] === true;
  return (
    <View className="card">
      <Text className="eyebrow">一次真实的相遇</Text>
      {partner && (
        <View className="person">
          <Avatar participant={partner} />
          <Text className="title">{partner.name}</Text>
        </View>
      )}
      {invite.common.map((c) => (
        <Text key={c.questionId} className="tag">
          {QUESTIONS.find((q) => q.id === c.questionId)?.short} · {c.answer}
        </Text>
      ))}
      {invite.status === "SENT" && (
        <>
          <Text className="title">
            {invite.to === me.id ? "有人想认识你" : "邀请已送出"}
          </Text>
          <Text className="muted">等待对方回应，邀请状态以活动服务为准。</Text>
          {invite.to === me.id ? (
            <View>
              <Button
                className="primary"
                disabled={busy}
                onClick={() => send("accept")}
              >
                愿意认识
              </Button>
              <Button disabled={busy} onClick={() => send("decline")}>
                暂时不了
              </Button>
            </View>
          ) : (
            <Button disabled={busy} onClick={() => send("cancel")}>
              撤回邀请
            </Button>
          )}
        </>
      )}
      {["ACCEPTED", "MEET_ASSIGNED", "ARRIVING"].includes(invite.status) && (
        <>
          <Text className="title">
            {point ? `在 ${point.name} 相遇` : "你们都愿意认识彼此"}
          </Text>
          <Text className="muted">
            {point
              ? point.location || "请前往现场对应编号的相遇点。"
              : "工作人员正在安排相遇点，请稍候。"}
          </Text>
          {point && <Text className="meeting-code">相认码 {invite.code}</Text>}
          {point && !invite.departures[me.id] && (
            <Button
              className="primary"
              disabled={busy}
              onClick={() => send("depart")}
            >
              我出发了
            </Button>
          )}
          {invite.departures[me.id] && !invite.arrivals[me.id] && (
            <Button
              className="primary"
              disabled={busy}
              onClick={() => send("arrive")}
            >
              我已到达相遇点
            </Button>
          )}
          {invite.arrivals[me.id] && (
            <Text className="notice">
              {bothArrived
                ? "双方已到达，请见到对方后分别确认。"
                : "你已到达，等待对方到达。"}
            </Text>
          )}
          {bothArrived && !invite.confirmations[me.id] && (
            <Button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (
                  (
                    await Taro.showModal({
                      title: "已经见到对方了吗？",
                      content:
                        "请实际见到对方后确认；双方都确认才计为一次相遇。",
                      confirmText: "已见到",
                    })
                  ).confirm
                )
                  send("confirm");
              }}
            >
              确认已经见到对方
            </Button>
          )}
          {invite.confirmations[me.id] && (
            <Text className="notice">你已确认，等待对方独立确认。</Text>
          )}
          <Button disabled={busy} onClick={() => send("help")}>
            需要工作人员帮助
          </Button>
          {["ACCEPTED", "MEET_ASSIGNED", "ARRIVING"].includes(
            invite.status,
          ) && (
            <Button
              className="text-button"
              disabled={busy}
              onClick={async () => {
                if (
                  (
                    await Taro.showModal({
                      title: "结束这次邀请？",
                      content: "对方会看到邀请已取消。",
                    })
                  ).confirm
                )
                  send("cancel");
              }}
            >
              取消本次相遇
            </Button>
          )}
        </>
      )}
      {state.helps
        .filter(
          (h) => h.invitationId === invite.id && h.participantId === me.id,
        )
        .map((h) => (
          <Text key={h.id} className="notice">
            {h.reply ||
              (h.status === "NEW"
                ? "求助已发送，等待工作人员回应。"
                : "工作人员正在处理。")}
          </Text>
        ))}
      {invite.status === "CONFIRMED" && (
        <>
          <Text className="title">很高兴，你们遇见了</Text>
          <Text className="muted">
            接下来，你想怎样继续？每个人都可以独立选择。
          </Text>
          {(
            [
              { id: "WALK", text: "一起走走" },
              { id: "MERCHANT", text: "看看附近的店" },
              { id: "END", text: "到这里也很好" },
            ] as const
          ).map((c) => (
            <Button
              key={c.id}
              className={invite.choices[me.id] === c.id ? "selected" : ""}
              disabled={
                busy ||
                (c.id === "MERCHANT" &&
                  !state.merchants.some((m) => m.id === "cloud" && m.active))
              }
              onClick={() => send("next", { choice: c.id })}
            >
              {c.text}
            </Button>
          ))}
          {invite.choices[me.id] === "MERCHANT" &&
            state.merchants
              .filter((m) => m.active)
              .map((m) => (
                <Text className="tag" key={m.id}>
                  {m.name} · {m.category} · 约 {m.minutes} 分钟
                </Text>
              ))}
          <Button
            className="text-button"
            disabled={busy}
            onClick={() => send("rediscover")}
          >
            继续发现其他同频的人
          </Button>
        </>
      )}
      {terminal && (
        <>
          <Text className="title">这次邀请已结束</Text>
          <Button
            className="primary"
            disabled={busy}
            onClick={() => send("rediscover")}
          >
            继续发现
          </Button>
        </>
      )}
      {permit && (
        <View className="permission-block">
          <Text className="subtitle">让这次相遇被看见</Text>
          <Text className="muted">
            双方都同意后，大屏才会公开展示你们的活动昵称、头像与相遇连线。你可随时撤回。
          </Text>
          <Button
            disabled={busy}
            onClick={() => send("display-consent", { allow: !allowed })}
          >
            {allowed ? "撤回本次公开展示" : "允许本次公开展示"}
          </Button>
        </View>
      )}
    </View>
  );
}
export default function Index() {
  const current = useSyncExternalStore(
    client.subscribe,
    client.state,
    client.state,
  );
  const [overlay, setOverlay] = useState("flow"),
    [back, setBack] = useState("flow"),
    [target, setTarget] = useState("");
  const [questionIndex, setQuestionIndex] = useState<number | null>(null);
  useLoad((options) => {
    void client.enter(options || {}).then(() => {
      if (!client.state().snapshot)
        void Taro.redirectTo({
          url: `/pages/encounter/index?activity=${encodeURIComponent(client.activity())}`,
        });
    });
  });
  useDidShow(() => client.show());
  useDidHide(() => client.hide());
  useUnload(() => client.hide());
  const snapshot = current.snapshot,
    state = snapshot?.state,
    me = state?.participants.find((p) => p.id === snapshot?.actor);
  const busy = current.busy || current.pending;
  function openService() {
    if (busy) return;
    setBack(overlay);
    setOverlay("service");
  }
  async function answer(index: number, value: string) {
    try {
      await client.send({
        type: "answer",
        questionId: QUESTIONS[index].id,
        value,
      });
      setQuestionIndex(null);
      setOverlay(index === 0 && !me?.profileComplete ? "result" : "flow");
    } catch {}
  }
  let content;
  if (!me || !state)
    content = (
      <View className="card welcome">
        <Text className="eyebrow">缘分实验室 · V1.0</Text>
        <Text className="hero-title">从一个共同话题，\n开始认识。</Text>
        <Text className="muted">
          扫码进入活动，发现同频的人。你的答案和选择会同步到现场；手机号等服务资料不会在大屏公开。
        </Text>
        <Button
          className="primary"
          disabled={current.busy || !API_ORIGIN}
          onClick={() =>
            Taro.redirectTo({
              url: `/pages/encounter/index?activity=${encodeURIComponent(client.activity())}`,
            })
          }
        >
          返回现场入口
        </Button>
        {!API_ORIGIN && (
          <Text className="notice">当前为本地开发包，尚未配置服务地址。</Text>
        )}
      </View>
    );
  else if (overlay === "service")
    content = (
      <ServiceForm
        key={state.tongzhouSubmissions[0]?.version || 0}
        record={state.tongzhouSubmissions[0]}
        busy={busy}
        onBack={() => setOverlay(back)}
      />
    );
  else if (overlay === "wall")
    content = <MemberWallConsent onBack={() => setOverlay("flow")} />;
  else if (!me.present || state.fieldOpen === false)
    content = (
      <View className="card">
        <Text>{state.fieldOpen === false ? "现场暂未开放。" : "你已离场"}</Text>
        {state.fieldOpen !== false && !me.present && (
          <>
            <Text className="muted">
              点击继续参与，保留你的资料与答题进度。
            </Text>
            <Button
              className="primary"
              disabled={current.busy}
              onClick={async () => {
                try {
                  await client.resumePresence();
                  setQuestionIndex(null);
                  setOverlay("flow");
                } catch {}
              }}
            >
              {current.busy ? "正在进入…" : "继续参与"}
            </Button>
          </>
        )}
        <Button onClick={() => setOverlay("service")}>同舟专业服务</Button>
      </View>
    );
  else if (overlay === "avatar")
    content = (
      <AvatarEditor participant={me} onBack={() => setOverlay("flow")} />
    );
  else if (overlay === "result")
    content = (
      <View className="card">
        <Text className="title">原来，你也想{me.answers.q1}</Text>
        <Text className="muted">接下来，让大家认识一下你。</Text>
        <Button className="primary" onClick={() => setOverlay("flow")}>
          完善活动资料
        </Button>
      </View>
    );
  else if ((!me.profileComplete && me.answers.q1) || overlay === "profile")
    content = (
      <Profile
        key={me.id}
        me={me}
        busy={busy}
        done={() => setOverlay("flow")}
      />
    );
  else if (currentInvite(state, me) && overlay !== "questions")
    content = <InviteFlow state={state} me={me} busy={busy} />;
  else if (!complete(me) || overlay === "questions") {
    const next = QUESTIONS.findIndex((q) => !me.answers[q.id]);
    const index = questionIndex ?? (next < 0 ? 0 : next);
    const question = QUESTIONS[index];
    content = (
      <View className="card">
        <Text className="eyebrow">
          认识彼此 · {index + 1} / {QUESTIONS.length}
        </Text>
        <Text className="title">{question.title}</Text>
        {question.options.map((option) => (
          <Button
            key={option}
            disabled={busy}
            className={`answer ${me.answers[question.id] === option ? "selected" : ""}`}
            onClick={() => answer(index, option)}
          >
            {option}
          </Button>
        ))}
        {index > 0 && (
          <Button
            className="text-button"
            disabled={busy}
            onClick={() => setQuestionIndex(index - 1)}
          >
            上一题
          </Button>
        )}
        {overlay === "questions" && (
          <Button
            disabled={busy}
            onClick={() => {
              setQuestionIndex(null);
              setOverlay("flow");
            }}
          >
            返回当前旅程
          </Button>
        )}
        {current.features.tongzhou && (
          <Button
            className="service-link"
            disabled={busy}
            onClick={openService}
          >
            申请同舟专业婚恋服务
          </Button>
        )}
      </View>
    );
  } else {
    const candidates = recommendations(state, me.id);
    const other = state.participants.find(
      (p) => p.id === target && state.live?.recommendationIds.includes(p.id),
    );
    content =
      overlay === "detail" && other ? (
        <View className="card">
          <Avatar participant={other} />
          <Text className="title">
            {other.name} · {other.age}
          </Text>
          <Text className="muted">从你们共同的选择开始聊聊。</Text>
          {commonAnswers(me, other).map((c) => (
            <Text key={c.questionId} className="tag">
              {QUESTIONS.find((q) => q.id === c.questionId)?.title}：{c.answer}
            </Text>
          ))}
          <Button
            className="primary"
            disabled={busy || !me.ready || state.activityPaused}
            onClick={() => {
              void client
                .send({ type: "invite", targetId: other.id })
                .then(() => setOverlay("flow"))
                .catch(() => {});
            }}
          >
            发出相遇邀请
          </Button>
          <Button disabled={busy} onClick={() => setOverlay("flow")}>
            返回发现
          </Button>
        </View>
      ) : (
        <View className="card">
          <Text className="title">发现同频的人</Text>
          <View className="permission">
            <Switch
              checked={me.ready}
              disabled={busy}
              onChange={(e) => {
                void client
                  .send({ type: "ready", value: e.detail.value })
                  .catch(() => {});
              }}
            />
            <Text>愿意接收相遇邀请</Text>
          </View>
          {candidates.length ? (
            candidates.map(({ participant: p, common }) => (
              <View
                className="candidate"
                key={p.id}
                onClick={() => {
                  if (!busy) {
                    setTarget(p.id);
                    setOverlay("detail");
                  }
                }}
              >
                <Avatar participant={p} />
                <View>
                  <Text className="subtitle">
                    {p.name} · {p.age}
                  </Text>
                  <Text className="muted">
                    {common.length} 个共同选择，点开认识一下
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text className="muted">
              同频的人还在路上。保持接收邀请，新的选择会在这里出现。
            </Text>
          )}
          <Button
            disabled={busy}
            onClick={() => {
              setQuestionIndex(0);
              setOverlay("questions");
            }}
          >
            查看或修改我的答案
          </Button>
          {current.features.tongzhou && (
            <Button
              className="service-link"
              disabled={busy}
              onClick={openService}
            >
              申请同舟专业婚恋服务
            </Button>
          )}
        </View>
      );
  }
  return (
    <View className="page">
      <View className="brand">
        <Text>遇见</Text>
        <Text className="brand-small">缘分实验室</Text>
      </View>
      {me && (
        <View className="self">
          <Avatar participant={me} />
          <View>
            <Text>{me.name || "正在认识你"}</Text>
            <Text className="hint">
              {current.online ? "活动数据已同步" : "连接中断，正在重试"}
            </Text>
          </View>
          {current.features.avatars && (
            <Button
              className="text-button"
              disabled={busy}
              onClick={() => setOverlay("avatar")}
            >
              更换头像
            </Button>
          )}
        </View>
      )}
      {state?.activityPaused && (
        <Text className="notice">活动暂时暂停，请等待工作人员安排。</Text>
      )}
      {current.error && (
        <View className="error">
          <Text>{current.error}</Text>
          <Button
            disabled={current.busy}
            onClick={() => {
              void client.retry().catch(() => {});
            }}
          >
            {current.pending ? "重试上次提交" : "重新连接"}
          </Button>
        </View>
      )}
      {content}
      {me?.profileComplete &&
        overlay === "flow" &&
        current.features.memberWall && (
          <Button
            className="text-button"
            disabled={busy}
            onClick={() => setOverlay("wall")}
          >
            我的遇见卡牌
          </Button>
        )}
      {me && state && overlay === "flow" && (
        <View className="footer">
          {current.features.tongzhou && currentInvite(state, me) && (
            <Button
              className="service-link"
              disabled={busy}
              onClick={openService}
            >
              申请同舟专业婚恋服务
            </Button>
          )}
          {state.live?.displayPermissions?.map((p) => (
            <View key={p.invitationId}>
              <Text>与 {p.otherName} 的公开展示</Text>
              <Button
                disabled={busy}
                onClick={() => {
                  void client
                    .send({
                      type: "display-consent",
                      invitationId: p.invitationId,
                      allow: false,
                    })
                    .catch(() => {});
                }}
              >
                撤回公开展示
              </Button>
            </View>
          ))}
          <Button
            className="text-button"
            disabled={busy}
            onClick={() => client.logout()}
          >
            退出本次登录
          </Button>
        </View>
      )}
    </View>
  );
}
