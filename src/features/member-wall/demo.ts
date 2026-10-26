import { memberCard } from "@/domain/member-wall";
import { AGES, QUESTIONS } from "@/data/questions";
import type { Participant } from "@/domain/types";
const names = ["林间", "听风", "晴禾", "远山", "知夏", "星野", "安宁", "南川", "云舒", "言初", "见山", "鹿鸣", "晚晴", "清和", "沐光", "书白", "如一", "时雨", "禾木", "山月", "清欢", "星河", "小满", "予安", "朝露", "行舟", "北辰", "拾光"];
export function demoMembers(count: number) {
  return Array.from({ length: Math.min(200, Math.max(0, count)) }, (_, i) => memberCard({
    id: `demo-${i}`, age: AGES[i % AGES.length], name: names[i % names.length], gender: i % 2 ? "male" : "female",
    avatarId: `${i % 2 ? "male" : "female"}_${String(Math.floor(i / 2) % 10 + 1).padStart(2, "0")}`,
    answers: Object.fromEntries(QUESTIONS.map((q, n) => [q.id, q.options[(i + n) % q.options.length]])),
  } as Participant, `demo-${i}`, `MW-${i.toString(16).toUpperCase().padStart(8, "0")}`,
  names[i % names.length] + (i < 28 ? "" : String(Math.floor(i / 28)))));
}
