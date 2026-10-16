"use client";
import { useState } from "react";
import { Avatar, Icon } from "@/components/ui";
import type { CommonAnswer, Participant } from "@/domain/types";
import { icebreakerTopics } from "./match-detail";

export function CandidateCard({
  participant,
  count,
}: {
  participant: Participant;
  count: number;
}) {
  return (
    <section
      className="match-candidate match-detail-reveal"
      aria-label="认识这位朋友"
    >
      <Avatar person={participant} size="lg" />
      <div className="match-candidate-copy">
        <h2>{participant.name}</h2>
        <p>
          {participant.gender === "male" ? "男" : "女"} · {participant.age} 岁
        </p>
        <div className="match-candidate-tags">
          {count > 0 ? (
            <>
              <span>
                <Icon name="leaf" size={13} />
                {count} 个共同点
              </span>
              <span>与你同频</span>
            </>
          ) : (
            <span>现场的朋友</span>
          )}
        </div>
      </div>
      <p className="match-avatar-note">头像由用户选择或上传，身份未核验</p>
    </section>
  );
}

export function IcebreakerCard({ common }: { common: CommonAnswer[] }) {
  const topics = icebreakerTopics(common);
  const [index, setIndex] = useState(0);
  const topic = topics[index % Math.max(1, topics.length)];
  return (
    <section className="match-icebreaker" aria-labelledby="icebreaker-title">
      <span className="match-icebreaker-icon">
        <Icon name="chat" size={24} />
      </span>
      <div className="match-icebreaker-copy">
        <div className="match-icebreaker-heading">
          <h2 id="icebreaker-title">不知道怎么开口？</h2>
          {topics.length > 1 && (
            <button
              type="button"
              className="match-topic-switch"
              onClick={() => setIndex((value) => (value + 1) % topics.length)}
            >
              换一个话题
            </button>
          )}
        </div>
        <div
          className="match-icebreaker-topic"
          aria-live="polite"
          aria-atomic="true"
        >
          {topic && (
            <p className="match-topic-source">从「{topic.answer}」聊起</p>
          )}
          <p className="match-topic-text">
            “{topic?.text || "今天来到鼓楼，有没有什么让你印象深刻的小发现？"}”
          </p>
        </div>
      </div>
    </section>
  );
}
