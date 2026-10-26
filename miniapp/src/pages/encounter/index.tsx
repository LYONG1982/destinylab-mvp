import { useState, useSyncExternalStore } from "react";
import Taro, { useLoad, useShareAppMessage } from "@tarojs/taro";
import { View, Text, Button, Switch } from "@tarojs/components";
import { client, API_ORIGIN } from "../../lib/client";
import "../../components/registration.scss";
export default function Encounter() {
  const auth = useSyncExternalStore(
    client.subscribe,
    client.state,
    client.state,
  );
  const [consent, setConsent] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useLoad((options) => {
    void client.enter(options || {}, false, "encounter");
  });
  useShareAppMessage(() => ({
    title: "遇见 · 现场互动",
    path: `/pages/encounter/index?activity=${client.activity()}`,
  }));
  return (
    <View className="reg-page">
      <View className="reg-card">
        <Text className="reg-card-title">
          {auth.removedEntry ? "上次参与已结束" : "欢迎来到遇见现场"}
        </Text>
        <Text className="reg-copy">
          {auth.removedEntry
            ? "原参与记录已归档。重新参与需填写本场资料并重新答题。"
            : "回答几个轻问题，发现同频的人。无需提前报名。"}
        </Text>
        {!auth.authenticated && (
          <View className="reg-consent">
            <Switch
              checked={consent}
              color="#81283e"
              onChange={(e) => setConsent(e.detail.value)}
            />
            <Text>我已阅读并同意隐私说明</Text>
          </View>
        )}
        <Button
          className="reg-link"
          onClick={() => Taro.navigateTo({ url: "/pages/privacy/index" })}
        >
          查看隐私说明
        </Button>
        {(error || auth.error) && (
          <Text className="reg-copy">{error || auth.error}</Text>
        )}
        <Button
          className="reg-primary"
          disabled={busy || !API_ORIGIN || (!auth.authenticated && !consent)}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              if (!auth.authenticated) await client.login();
              if (client.state().authenticated) await client.startInteraction();
            } catch (e) {
              setError(e instanceof Error ? e.message : "进入失败，请重试。");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "正在进入…" : auth.removedEntry ? "重新参与" : "进入现场互动"}
        </Button>
        <Button
          className="reg-link"
          onClick={() =>
            Taro.navigateTo({
              url: `/pages/registration/index?activity=${client.activity()}`,
            })
          }
        >
          报名与我的邀请函
        </Button>
      </View>
    </View>
  );
}
