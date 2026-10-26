"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, Brand, Empty, Loading, Notice } from "@/components/ui";
import {
  approximateAge,
  authorizedTongzhouSubmissions,
  maskedPhone,
} from "@/domain/tongzhou";
import type { DemoState } from "@/domain/types";
import { useDemo } from "@/lib/demo/hooks";
import { submissionTime, TongzhouDetails } from "./TongzhouDetails";

export function TongzhouAgency() {
  const { state, problem } = useDemo();
  if (!state) return <Loading />;
  return (
    <main className="tongzhou-agency">
      <header>
        <Brand />
        <Badge tone="wine">同舟婚恋 · 本地资料视角</Badge>
        <Link href="/demo">返回演示入口</Link>
      </header>
      <div className="tongzhou-agency-intro">
        <div className="eyebrow">TONGZHOU · APPLICATIONS</div>
        <h1>自愿填报资料</h1>
        <p>了解需求、人工匹配、推荐沟通与约见跟进均由同舟在线下完成。</p>
      </div>
      <Notice>
        仅供本地虚构资料验证，角色视角不代表正式账号认证。仅展示用户已提交且授权有效的资料。
      </Notice>
      {problem ? (
        <Notice tone="error">{problem}</Notice>
      ) : (
        <AgencyRecords key={state.epoch} state={state} />
      )}
    </main>
  );
}
function AgencyRecords({ state }: { state: DemoState }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{
    participantId: string;
    submittedAt: number;
  } | null>(null);
  const records = authorizedTongzhouSubmissions(state, "tongzhou");
  const current = records.find(
    (record) =>
      record.participantId === selected?.participantId &&
      record.submittedAt === selected.submittedAt,
  );
  const filtered = records.filter((record) =>
    [record.fields!.realName, record.fields!.city].some((value) =>
      value.includes(query.trim()),
    ),
  );
  return (
    <>
      <div className="tongzhou-filter">
        <label htmlFor="tongzhou-search">查找资料</label>
        <input
          id="tongzhou-search"
          placeholder="按姓名或城市搜索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span>
          {filtered.length} / {records.length} 份有效填报
        </span>
      </div>
      <div className="tongzhou-workspace">
        <section className="tongzhou-list" aria-label="有效填报名单">
          {filtered.length ? (
            filtered.map((record) => {
              const fields = record.fields!;
              return (
                <button
                  className={`tongzhou-record ${current?.participantId === record.participantId ? "is-current" : ""}`}
                  key={record.participantId}
                  onClick={() =>
                    setSelected({
                      participantId: record.participantId,
                      submittedAt: record.submittedAt,
                    })
                  }
                  aria-pressed={current?.participantId === record.participantId}
                >
                  <div>
                    <strong>{fields.realName}</strong>
                    <small>
                      {fields.gender} · {fields.city}
                    </small>
                  </div>
                  <p>
                    {fields.birthYear} 年 · {approximateAge(fields.birthYear)}
                  </p>
                  <p>{maskedPhone(fields.phone)}</p>
                  <small>更新于 {submissionTime(record.updatedAt)}</small>
                </button>
              );
            })
          ) : (
            <Empty title={query ? "没有符合条件的资料" : "暂时没有有效填报"}>
              {query
                ? "试试其他姓名或城市。"
                : "用户自愿填写并授权提交后，资料会显示在这里。"}
            </Empty>
          )}
        </section>
        <section
          className="tongzhou-card tongzhou-agency-detail"
          aria-label="填报详情"
          aria-live="polite"
        >
          {current ? (
            <>
              <div className="tongzhou-section-head">
                <h2>{current.fields!.realName}的填报</h2>
                <button className="back-link" onClick={() => setSelected(null)}>
                  关闭详情
                </button>
              </div>
              <p className="fine">本人填写 · 信息及手机号未核验</p>
              <TongzhouDetails submission={current} />
              <div className="tongzhou-audit">
                <p>提交时间：{submissionTime(current.submittedAt)}</p>
                <p>最近更新：{submissionTime(current.updatedAt)}</p>
                <p>授权时间：{submissionTime(current.consent!.at)}</p>
                <p>授权版本：{current.consent!.version}</p>
                <p>用途：同舟婚恋线下联系、了解需求及人工服务</p>
              </div>
            </>
          ) : (
            <Empty
              title={selected ? "当前资料已不可查看" : "选择一份填报查看详情"}
            >
              {selected
                ? "授权已撤回、资料已删除或已重新提交，请从有效名单重新选择。"
                : "只有当前授权有效的资料可以查看。"}
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}
