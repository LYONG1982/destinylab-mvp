import {
  approximateAge,
  TONGZHOU_FIELDS,
  type TongzhouSubmission,
} from "@/domain/tongzhou";

export function TongzhouDetails({
  submission,
}: {
  submission: TongzhouSubmission;
}) {
  if (!submission.fields) return null;
  const fields = submission.fields;
  return (
    <dl className="tongzhou-details">
      {TONGZHOU_FIELDS.map(({ key, label }) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>
            {fields[key] || "未填写"}
            {key === "birthYear" && fields[key] && (
              <small> · {approximateAge(fields[key])}</small>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export const submissionTime = (at: number) =>
  new Date(at).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
