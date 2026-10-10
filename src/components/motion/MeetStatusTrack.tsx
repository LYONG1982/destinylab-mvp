import type { Invitation, Participant } from "@/domain/types";
export function MeetStatusTrack({
  people,
  invitation,
  pointName,
}: {
  people: Participant[];
  invitation: Invitation;
  pointName: string;
}) {
  return (
    <div className="meet-status-tracks" aria-label="双方确认的出发与到达状态">
      {people.map((p) => {
        const status = invitation.arrivals[p.id]
          ? "arrived"
          : invitation.departures[p.id]
            ? "departed"
            : "waiting";
        const label =
          status === "arrived"
            ? "已确认到达"
            : status === "departed"
              ? "已确认出发"
              : "尚未确认出发";
        return (
          <div key={p.id} className="meet-status-track" data-status={status}>
            <span>
              {p.name}
              <small>{label}</small>
            </span>
            <svg viewBox="0 0 100 16" aria-hidden="true">
              <path d="M5 8H95" />
              <circle
                cx={status === "arrived" ? 95 : status === "departed" ? 50 : 5}
                cy="8"
                r="4"
              />
            </svg>
            <span>{pointName}</span>
          </div>
        );
      })}
      <p className="fine">仅表示已确认的状态，不代表实时位置。</p>
    </div>
  );
}
