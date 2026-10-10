import { TongzhouAgency } from "@/features/tongzhou/TongzhouAgency";
import { notFound } from "next/navigation";
export default function Page() {
  if (process.env.DESTINY_DATA_MODE === "server") notFound();
  return <TongzhouAgency />;
}
