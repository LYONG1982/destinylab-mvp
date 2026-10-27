import type { ScreenSnapshot } from "../model";
/** Isolated development fixture. Never modifies browser business storage. */
export function previewFields(
  source: ScreenSnapshot,
  count: number,
  joins = 0,
  changes = 0,
): ScreenSnapshot {
  const length = count || 3;
  const labels = ["轻松聊聊", "一起逛逛", "认真认识", "随心探索"];
  const id = `preview-${count}`;
  const members =
    count === 0
      ? []
      : source.members.map((node, index) => ({
          ...node,
          optionKey: `${id}:${index % length}`,
        }));
  for (let n = Math.max(1, joins - 11); count > 0 && n <= joins; n++)
    members.push({
      key: `preview-join-${n}`,
      label: "演示来宾",
      displayMode: "PUBLIC",
      image: `/assets/avatars-v520/female/female_${String((n % 10) + 1).padStart(2, "0")}.webp`,
      optionKey: `${id}:${n % length}`,
      seed: 100000 + n,
    });
  if (changes && members[0])
    members[0] = { ...members[0], optionKey: `${id}:${changes % length}` };
  const subject = changes ? members[0] : joins ? members.at(-1) : undefined;
  const total = members.length;
  return {
    ...source,
    events: subject
      ? [
          {
            id: `preview-${joins}-${changes}`,
            type: changes ? "ACTIVE" : "JOIN",
            node: subject.key,
            timestamp: Date.now(),
            field: {
              questionKey: id,
              optionKey: subject.optionKey,
              optionLabel: labels[Number(subject.optionKey.split(":").at(-1))],
              label: subject.label,
              image: subject.image,
              kind: changes ? "move" : "join",
            },
          },
        ]
      : [],
    members,
    question: {
      id,
      title: "虚构关系场预览",
      total,
      options: labels.slice(0, length).map((label, index) => {
        const n = members.filter(
          (m) => m.optionKey === `${id}:${index}`,
        ).length;
        return {
          key: `${id}:${index}`,
          label,
          count: n,
          percentage: total ? Math.round((n / total) * 100) : 0,
        };
      }),
    },
  };
}
