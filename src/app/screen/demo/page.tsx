import { ScreenApp } from "@/features/screen/ScreenApp";
import { redirect } from "next/navigation";
export default function Page() {
  if (process.env.NODE_ENV !== "development" || process.env.DESTINY_DATA_MODE === "server") redirect("/screen");
  return <ScreenApp mock />;
}
