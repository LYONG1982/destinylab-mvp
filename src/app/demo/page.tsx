import { DemoHub } from "@/features/DemoHub";
import { redirect } from "next/navigation";
export default function Page() {
  if (process.env.DESTINY_DATA_MODE === "server") redirect("/mobile/01-start");
  return <DemoHub />;
}
