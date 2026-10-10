import { TongzhouMobile } from "@/features/tongzhou/TongzhouMobile";
import { notFound } from "next/navigation";
export default function Page() {
  if (process.env.DESTINY_DATA_MODE === "server") notFound();
  return <TongzhouMobile />;
}
