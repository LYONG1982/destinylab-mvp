import { validAvatar } from "@/config/avatars";
import { AGES, QUESTIONS } from "@/data/questions";
import type { LiveCommand } from "@/lib/api/live-types";
import { nicknameError } from "@/domain/selectors";

type Role = "participant" | "operator";
type RecordValue = Record<string, unknown>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const GENDERS = ["male", "female"] as const;
const NEXT_CHOICES = ["WALK", "MERCHANT", "END"] as const;
const PARTICIPANT_ACTIONS = ["pause", "resume", "leave", "hint"] as const;
const HELP_STATUSES = ["ACK", "RESOLVED"] as const;

function invalid(message: string): never {
  throw new Error(message);
}

function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid("命令必须是对象。");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    return invalid("命令对象原型无效。");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return invalid("命令不能包含符号字段。");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor))
      return invalid("命令字段必须是普通可枚举数据。");
  }
  return value as RecordValue;
}

function exactKeys(value: RecordValue, keys: readonly string[]) {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`命令包含不允许的字段：${key}。`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key))
      invalid(`命令缺少字段：${key}。`);
  }
}

function string(value: unknown, label: string, max = 120): string {
  if (typeof value !== "string") invalid(`${label}必须是文本。`);
  if (!value.trim()) invalid(`${label}不能为空。`);
  if (value.length > max) invalid(`${label}不能超过 ${max} 个字符。`);
  if (value !== value.trim()) invalid(`${label}不能包含首尾空格。`);
  return value;
}

function id(value: unknown, label: string): string {
  const result = string(value, label, 120);
  if (!ID_PATTERN.test(result)) invalid(`${label}格式无效。`);
  return result;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value))
    invalid(`${label}无效。`);
  return value as T[number];
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(`${label}必须是布尔值。`);
  return value;
}

function questionId(value: unknown): string {
  return oneOf(
    value,
    QUESTIONS.map((question) => question.id),
    "问题编号",
  );
}

function validateParticipant(value: RecordValue): LiveCommand {
  const type = string(value.type, "命令类型", 40);
  switch (type) {
    case "answer": {
      exactKeys(value, ["type", "questionId", "value"]);
      const qid = questionId(value.questionId);
      const question = QUESTIONS.find((item) => item.id === qid)!;
      const answer = oneOf(value.value, question.options, "答案");
      return { type, questionId: qid, value: answer };
    }
    case "profile": {
      exactKeys(value, ["type", "name", "gender", "avatarId", "age", "ready"]);
      const name = string(value.name, "昵称", 5);
      const error = nicknameError(name);
      if (error) invalid(error);
      const gender = oneOf(value.gender, GENDERS, "性别");
      const avatarId = id(value.avatarId, "头像编号");
      if (!validAvatar(avatarId, gender)) invalid("头像与所选性别不匹配。");
      return {
        type,
        name,
        gender,
        avatarId,
        age: oneOf(value.age, AGES, "年龄段"),
        ready: boolean(value.ready, "见面状态"),
      };
    }
    case "ready": {
      exactKeys(value, ["type", "value"]);
      return { type, value: boolean(value.value, "见面状态") };
    }
    case "invite": {
      exactKeys(value, ["type", "targetId"]);
      return { type, targetId: id(value.targetId, "参与者编号") };
    }
    case "accept":
    case "decline":
    case "cancel":
    case "depart":
    case "arrive":
    case "confirm":
    case "help":
    case "rediscover": {
      exactKeys(value, ["type", "invitationId"]);
      return { type, invitationId: id(value.invitationId, "邀请编号") };
    }
    case "next": {
      exactKeys(value, ["type", "invitationId", "choice"]);
      return {
        type,
        invitationId: id(value.invitationId, "邀请编号"),
        choice: oneOf(value.choice, NEXT_CHOICES, "下一站选择"),
      };
    }
    case "merchant-view": {
      exactKeys(value, ["type", "invitationId", "merchantId"]);
      return {
        type,
        invitationId: id(value.invitationId, "邀请编号"),
        merchantId: id(value.merchantId, "商户编号"),
      };
    }
    case "display-consent": {
      exactKeys(value, ["type", "invitationId", "allow"]);
      return {
        type,
        invitationId: id(value.invitationId, "邀请编号"),
        allow: boolean(value.allow, "播报授权"),
      };
    }
    default:
      return invalid(`参与者不能执行此命令：${type}。`);
  }
}

function validateOperator(value: RecordValue): LiveCommand {
  const type = string(value.type, "命令类型", 40);
  switch (type) {
    case "point-status": {
      exactKeys(value, ["type", "pointId", "enabled"]);
      return {
        type,
        pointId: id(value.pointId, "相遇点编号"),
        enabled: boolean(value.enabled, "相遇点开放状态"),
      };
    }
    case "pause": {
      exactKeys(value, ["type", "value"]);
      return { type, value: boolean(value.value, "现场暂停状态") };
    }
    case "participant": {
      exactKeys(value, ["type", "participantId", "action"]);
      return {
        type,
        participantId: id(value.participantId, "参与者编号"),
        action: oneOf(value.action, PARTICIPANT_ACTIONS, "参与者操作"),
      };
    }
    case "help-status": {
      exactKeys(value, ["type", "helpId", "status"]);
      return {
        type,
        helpId: id(value.helpId, "帮助编号"),
        status: oneOf(value.status, HELP_STATUSES, "帮助状态"),
      };
    }
    case "release": {
      exactKeys(value, ["type", "pointId"]);
      return { type, pointId: id(value.pointId, "相遇点编号") };
    }
    case "merchant": {
      exactKeys(value, ["type", "merchantId", "active"]);
      return {
        type,
        merchantId: id(value.merchantId, "商户编号"),
        active: boolean(value.active, "商户推荐状态"),
      };
    }
    case "point-add": {
      exactKeys(value, ["type", "name"]);
      const name = string(value.name, "相遇点名称");
      if (!/^Meet\d{2,3}$/.test(name))
        invalid("相遇点名称须符合 Meet 加 2 至 3 位数字的格式。");
      return { type, name };
    }
    case "cancel": {
      exactKeys(value, ["type", "invitationId"]);
      return { type, invitationId: id(value.invitationId, "邀请编号") };
    }
    case "display-question": {
      exactKeys(value, ["type", "questionId"]);
      const qid = questionId(value.questionId);
      if (qid !== "q1") invalid("当前仅允许展示 q1。");
      return { type, questionId: qid };
    }
    default:
      return invalid(`运营人员不能执行此命令：${type}。`);
  }
}

export function validateLiveCommand(value: unknown, role: Role): LiveCommand {
  if (role !== "participant" && role !== "operator")
    return invalid("当前身份不能提交命令。");
  const command = object(value);
  return role === "participant"
    ? validateParticipant(command)
    : validateOperator(command);
}
