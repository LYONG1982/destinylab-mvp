import type { Gender, Participant } from "@/domain/types";
export interface AvatarOption {
  id: string;
  gender: Gender;
  src: string;
  alt: string;
}
const options = (gender: Gender): AvatarOption[] =>
  Array.from({ length: 10 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    const id = `${gender}_${number}`;
    return {
      id,
      gender,
      src: `/assets/avatars/${gender}/${id}.png`,
      alt: `${gender === "male" ? "男生" : "女生"}虚拟头像 ${number}`,
    };
  });
export const maleAvatars = options("male");
export const femaleAvatars = options("female");
const catalogue = new Map(
  [...maleAvatars, ...femaleAvatars].map((avatar) => [avatar.id, avatar]),
);
export const getAvatarById = (id?: string | null) =>
  id ? catalogue.get(id) : undefined;
export const getAvatarsByGender = (gender: Gender | null) =>
  gender === "male" ? maleAvatars : gender === "female" ? femaleAvatars : [];
export function validAvatar(id: string | null | undefined, gender: Gender) {
  return getAvatarById(id)?.gender === gender;
}
export function defaultAvatarId(id: string, gender: Gender) {
  if (id === "p-shanfeng") return "male_03";
  if (id === "p-xiaoman") return "female_07";
  let hash = 0;
  for (const character of id)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return getAvatarsByGender(gender)[hash % 10].id;
}
/** Read compatibility only. Existing answers, epochs and relationships stay intact. */
export function withCompatibleAvatar(p: Participant): Participant {
  if (!Object.prototype.hasOwnProperty.call(p, "avatarId"))
    return {
      ...p,
      avatarId: p.profileComplete ? defaultAvatarId(p.id, p.gender) : null,
    };
  if (p.avatarId === null || validAvatar(p.avatarId, p.gender)) return p;
  return { ...p, avatarId: null };
}
