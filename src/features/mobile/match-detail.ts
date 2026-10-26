import { QUESTIONS } from "@/data/questions";
import type { CommonAnswer } from "@/domain/types";

// Presentation only: these labels and prompts never influence recommendations.
const categories: Record<string, { label: string; icon: string }> = {
  q1: { label: "认识的方式", icon: "spark" },
  q2: { label: "相遇的地方", icon: "coffee" },
  q3: { label: "聊天兴趣", icon: "chat" },
  q4: { label: "关系的节奏", icon: "leaf" },
  q5: { label: "周末偏好", icon: "walk" },
  q6: { label: "相处感受", icon: "heart" },
  q7: { label: "社交方式", icon: "people" },
  q8: { label: "沟通方式", icon: "chat" },
  q9: { label: "关系期待", icon: "leaf" },
  q10: { label: "吸引偏好", icon: "spark" },
};

export function commonPointCategory(questionId: string) {
  return (
    categories[questionId] || {
      label: QUESTIONS.find((q) => q.id === questionId)?.short || "一个共同点",
      icon: "chat",
    }
  );
}

const icebreakerTemplates: Record<string, string> = {
  "q1:轻松聊聊": "今天在鼓楼，有没有什么让你觉得有意思的小发现？",
  "q1:一起逛逛": "如果一起逛逛鼓楼，你最想先走哪一段路？",
  "q1:认真认识": "最近有什么事，让你觉得日子过得特别充实？",
  "q2:热闹街区": "你平时喜欢逛哪条街？有没有想推荐的小店？",
  "q2:安静咖啡馆": "你喜欢什么样的咖啡馆？安静看书，还是坐着聊聊天？",
  "q2:户外步道": "附近有没有你喜欢的散步路线？下次想去哪儿走走？",
  "q2:特色小店": "最近有没有发现一家让你想再去的小店？",
  "q3:美食与探店": "最近有没有发现什么好吃的小店？",
  "q3:电影与音乐": "最近有没有看过什么不错的电影，或循环听的一首歌？",
  "q3:旅行与城市": "最近有没有特别想去的地方？是什么吸引了你？",
  "q3:最近的生活": "最近生活里，有没有一件让你开心的小事？",
  "q5:出去走走": "你周末也喜欢出去走走吗？\n最近有没有想去的地方？",
  "q5:在家充电": "在家休息的时候，你最喜欢用什么方式给自己充电？",
  "q5:约朋友聚聚": "和朋友聚在一起时，你们最喜欢做什么？",
  "q5:随心安排": "如果这个周末没有计划，你第一件想做的事是什么？",
  "q7:主动认识几个人": "你通常会用什么话题，和刚认识的人打开话匣子？",
  "q7:等别人来聊": "什么样的开场白，会让你觉得聊天很轻松？",
  "q7:先观察一下": "到了一个新地方，你通常最先注意到什么？",
  "q7:跟着感觉走": "有没有一次随性的相遇，让你一直记得？",
  "q8:主动找话题": "有没有一个话题，是你一聊起来就停不下来的？",
  "q8:认真听对方说": "最近听到过什么让你印象深刻的故事？",
  "q8:分享自己的故事": "如果分享一件最近的小事，你最想说哪一件？",
  "q8:用行动表达": "你觉得哪些小举动，最能让人感受到心意？",
};

const topicOrder = ["q5", "q3", "q2", "q7", "q8", "q1"];
export function icebreakerTopics(common: CommonAnswer[]) {
  return common
    .map((point, index) => ({ point, index }))
    .sort((a, b) => {
      const rank = (id: string) => {
        const position = topicOrder.indexOf(id);
        return position < 0 ? topicOrder.length : position;
      };
      return (
        rank(a.point.questionId) - rank(b.point.questionId) || a.index - b.index
      );
    })
    .map(({ point }) => ({
      ...point,
      text:
        icebreakerTemplates[`${point.questionId}:${point.answer}`] ||
        "这个答案你们刚好一样，也许可以从这里聊起。",
    }));
}
