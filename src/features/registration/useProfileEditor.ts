"use client";
import { useEffect, useRef, useState } from "react";
import type {
  RegistrationRecord,
  RegistrationView,
} from "@/domain/registration";
import {
  REGISTRATION_AGENCY_CONSENT,
  validateRegistration,
} from "@/domain/registration";
import {
  mergeProfileDraft,
  PROFILE_FIELDS,
  profilePatch,
  type ProfileStep,
} from "@/domain/registration-profile";
import type { TongzhouField, TongzhouProfile } from "@/domain/tongzhou";
import { clientId } from "@/lib/client-id";
import { RegistrationApiError, registrationApi } from "./client";

type Draft = { fields: TongzhouProfile; agency: boolean };
type Conflict = TongzhouField | "agency";
type Pending = { path: string; input: unknown; id: string; upload?: File };
export function useProfileEditor(
  activity: string,
  initial: RegistrationRecord,
  onRecord: (r: RegistrationRecord) => void,
) {
  const [record, setRecord] = useState(initial);
  const [preview, setPreview] = useState<RegistrationRecord | null>(null);
  const [readError, setReadError] = useState("");
  function resetPreview() {
    setPreview(null);
    setReadError("");
  }
  // A preview always gets a fresh server snapshot. Never replay pending writes here.
  function loadPreview() {
    return enqueue(async () => {
      resetPreview();
      try {
        const fresh = await registrationApi<RegistrationView>(activity, "me");
        if (!fresh.record) throw Error("未找到已保存的档案，请返回报名凭证。");
        if (!mounted.current) return false;
        receive(fresh.record);
        setPreview(fresh.record);
        return true;
      } catch (e) {
        if (mounted.current)
          setReadError(
            e instanceof RegistrationApiError && e.status === 401
              ? "报名会话已失效，请返回报名入口。"
              : "暂时无法读取已保存的档案，请重试读取。",
          );
        return false;
      }
    });
  }
  const [draft, setDraft] = useState<Draft>({
    fields: initial.fields,
    agency: initial.agencyAllowed,
  });
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const base = useRef(initial),
    local = useRef(draft),
    queue = useRef(Promise.resolve()),
    pending = useRef<Pending | null>(null);
  const conflictRef = useRef<Conflict[]>([]),
    mounted = useRef(true),
    blocked = useRef(false);
  const authorized = useRef(true);
  const key = `dl-profile-draft:${activity}:${initial.id}`;
  const dirty =
    Object.keys(profilePatch(record.fields, draft.fields, "preview")).length >
      0 || draft.agency !== record.agencyAllowed;
  function cache() {
    try {
      if (!authorized.current) {
        sessionStorage.removeItem(key);
        return;
      }
      const changed =
        Object.keys(
          profilePatch(base.current.fields, local.current.fields, "preview"),
        ).length || local.current.agency !== base.current.agencyAllowed;
      if (changed)
        sessionStorage.setItem(
          key,
          JSON.stringify({
            base: base.current.fields,
            agencyBase: base.current.agencyAllowed,
            draft: local.current,
          }),
        );
      else sessionStorage.removeItem(key);
    } catch {
      /* Storage may be unavailable; the server remains authoritative. */
    }
  }
  function update(d: Draft) {
    local.current = d;
    setDraft(d);
    cache();
  }
  function receive(
    r: RegistrationRecord,
    sent?: { draft: Draft; keys: string[]; agency: boolean },
  ) {
    const merged = mergeProfileDraft(
      base.current.fields,
      local.current.fields,
      r.fields,
    );
    const fields = merged.fields;
    if (sent)
      for (const k of sent.keys as TongzhouField[])
        if (local.current.fields[k] === sent.draft.fields[k])
          fields[k] = r.fields[k];
    let agency =
      local.current.agency !== base.current.agencyAllowed
        ? local.current.agency
        : r.agencyAllowed;
    if (sent?.agency && local.current.agency === sent.draft.agency)
      agency = r.agencyAllowed;
    const overlap: Conflict[] = sent
      ? []
      : [
          ...new Set([
            ...merged.conflicts,
            ...conflictRef.current.filter((k) =>
              k === "agency"
                ? local.current.agency !== r.agencyAllowed
                : local.current.fields[k] !== r.fields[k],
            ),
          ]),
        ];
    if (
      !sent &&
      local.current.agency !== base.current.agencyAllowed &&
      r.agencyAllowed !== base.current.agencyAllowed &&
      local.current.agency !== r.agencyAllowed
    )
      overlap.push("agency");
    base.current = r;
    setRecord(r);
    onRecord(r);
    update({ fields, agency });
    conflictRef.current = overlap;
    setConflicts(overlap);
    return overlap;
  }
  useEffect(() => {
    mounted.current = true;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw);
        if (
          saved.base &&
          saved.draft?.fields &&
          typeof saved.draft.agency === "boolean"
        ) {
          const valid = Object.fromEntries(
            PROFILE_FIELDS.preview
              .filter((k) => typeof saved.draft.fields[k] === "string")
              .map((k) => [k, saved.draft.fields[k]]),
          );
          const restored = { ...initial.fields, ...valid };
          const merged = mergeProfileDraft(
            { ...initial.fields, ...saved.base },
            restored,
            initial.fields,
          );
          const overlap: Conflict[] = [...merged.conflicts];
          if (
            saved.agencyBase !== initial.agencyAllowed &&
            saved.draft.agency !== saved.agencyBase &&
            saved.draft.agency !== initial.agencyAllowed
          )
            overlap.push("agency");
          local.current = {
            fields: merged.fields,
            agency:
              saved.draft.agency !== saved.agencyBase
                ? saved.draft.agency
                : initial.agencyAllowed,
          };
          setDraft(local.current);
          conflictRef.current = overlap;
          setConflicts(overlap);
          setNotice(
            overlap.length
              ? "已恢复草稿，请核对冲突字段。"
              : "已恢复此浏览器尚未保存的草稿。",
          );
        }
      }
    } catch {
      try {
        sessionStorage.removeItem(key);
      } catch {}
    }
    setReady(true);
    return () => {
      mounted.current = false;
    };
    // This editor is keyed by the authenticated registration; restore exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty, busy]);
  async function request(path: string, input: unknown, upload?: File) {
    if (
      pending.current &&
      (pending.current.path !== path ||
        JSON.stringify(pending.current.input) !== JSON.stringify(input) ||
        pending.current.upload !== upload)
    ) {
      await registrationApi<RegistrationRecord>(
        activity,
        pending.current.path,
        pending.current.input,
        pending.current.upload,
        pending.current.id,
      );
      pending.current = null;
      const fresh = await registrationApi<RegistrationView>(activity, "me");
      if (fresh.record) receive(fresh.record);
      throw new Error("上一项操作已确认，请核对资料后再次保存当前修改。");
    }
    const op = pending.current || { path, input, id: clientId(), upload };
    pending.current = op;
    try {
      const r = await registrationApi<RegistrationRecord>(
        activity,
        path,
        input,
        upload,
        op.id,
      );
      pending.current = null;
      return r;
    } catch (e) {
      if (e instanceof RegistrationApiError && e.status < 500)
        pending.current = null;
      throw e;
    }
  }
  function enqueue(work: () => Promise<boolean>) {
    if (blocked.current) return Promise.resolve(false);
    blocked.current = true;
    setBusy(true);
    const result = queue.current.then(async () => {
      if (!mounted.current) return false;
      setError("");
      setNotice("");
      try {
        return await work();
      } catch (e) {
        if (e instanceof RegistrationApiError && e.status === 401) {
          authorized.current = false;
          try {
            sessionStorage.removeItem(key);
          } catch {}
          setError("报名会话已失效。请返回报名入口，勿用遇见码恢复身份。");
        } else
          setError(
            e instanceof TypeError
              ? "网络连接未完成，输入已保留，请重试保存。"
              : e instanceof Error
                ? e.message
                : "保存未完成，请重试。",
          );
        return false;
      }
    });
    queue.current = result.then(() => {});
    void result.finally(() => {
      blocked.current = false;
      if (mounted.current) setBusy(false);
    });
    return result;
  }
  async function saveNow(
    section: ProfileStep,
    next: ProfileStep,
    intent: "save" | "visit" | "confirm",
    retry = true,
  ): Promise<boolean> {
    if (conflictRef.current.length)
      throw Error("请先处理冲突字段，再保存档案。");
    const sent = { ...local.current, fields: { ...local.current.fields } };
    const fields =
      intent === "visit"
        ? {}
        : profilePatch(base.current.fields, sent.fields, section);
    const agency =
      intent !== "visit" &&
      ["album", "preview"].includes(section) &&
      sent.agency !== base.current.agencyAllowed;
    if (intent !== "visit")
      validateRegistration(
        { ...base.current.fields, ...fields },
        base.current.nickname,
      );
    const input = {
      section,
      next,
      intent,
      fields,
      version: base.current.version,
      ...(agency
        ? {
            agencyAllowed: sent.agency,
            agencyConsent: sent.agency ? REGISTRATION_AGENCY_CONSENT : "",
          }
        : {}),
    };
    try {
      const r = await request("profile", input);
      receive(r, { draft: sent, keys: Object.keys(fields), agency });
      setNotice(
        intent === "confirm"
          ? "档案已保存"
          : intent === "visit"
            ? ""
            : "本站已保存",
      );
      return true;
    } catch (e) {
      if (e instanceof RegistrationApiError && e.status === 409 && retry) {
        const fresh = await registrationApi<RegistrationView>(activity, "me");
        if (fresh.record) {
          const overlap = receive(fresh.record);
          if (overlap.length)
            throw Error("资料在其他页面发生变化，请核对下方冲突字段。");
          if (fresh.record.status !== "cancelled")
            return saveNow(section, next, intent, false);
        }
      }
      throw e;
    }
  }
  function save(
    section: ProfileStep,
    next = section,
    intent: "save" | "visit" | "confirm" = "save",
  ) {
    // The fourth station has no write responsibility, including indirect callers.
    if (section === "preview") return Promise.resolve(false);
    return enqueue(() => saveNow(section, next, intent));
  }
  function changeField(k: TongzhouField, value: string) {
    setError("");
    update({
      ...local.current,
      fields: { ...local.current.fields, [k]: value },
    });
  }
  function changeAgency(value: boolean) {
    setError("");
    update({ ...local.current, agency: value });
  }
  function resolve(choice: "draft" | "server") {
    if (choice === "server") {
      const d = {
        fields: { ...local.current.fields },
        agency: local.current.agency,
      };
      for (const k of conflictRef.current)
        if (k === "agency") d.agency = base.current.agencyAllowed;
        else d.fields[k] = base.current.fields[k];
      update(d);
    }
    conflictRef.current = [];
    setConflicts([]);
    setError("");
    setNotice("已保留你的选择，请保存档案。");
  }
  function photo(file: File | string) {
    return enqueue(async () => {
      if (conflictRef.current.length) throw Error("请先处理冲突字段。");
      if (typeof file !== "string" && file.size > 10 * 1024 * 1024)
        throw Error("每张照片须小于10MB。");
      try {
        const r =
          typeof file === "string"
            ? await request("delete-photo", {
                photo: file,
                version: base.current.version,
              })
            : await request(
                `upload?version=${base.current.version}`,
                undefined,
                file,
              );
        receive(r, { draft: local.current, keys: [], agency: false });
        setNotice(typeof file === "string" ? "照片已删除" : "照片已保存");
        return true;
      } catch (e) {
        if (e instanceof RegistrationApiError && e.status === 409) {
          const fresh = await registrationApi<RegistrationView>(activity, "me");
          if (fresh.record) receive(fresh.record);
        }
        throw e;
      }
    });
  }
  return {
    record,
    preview,
    readError,
    loadPreview,
    resetPreview,
    uncertain: !!pending.current,
    draft,
    busy,
    ready,
    error,
    notice,
    conflicts,
    dirty,
    blocked,
    changeField,
    changeAgency,
    save,
    photo,
    resolve,
    setNotice,
  };
}
