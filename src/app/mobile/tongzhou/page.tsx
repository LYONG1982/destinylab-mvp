import { Suspense } from "react";
import { TongzhouMobile } from "@/features/tongzhou/TongzhouMobile";
import {notFound} from "next/navigation";
export default function Page() { if(process.env.DESTINY_DATA_MODE === "server" && process.env.DESTINY_TONGZHOU_ENABLED !== "true")notFound(); return <Suspense><TongzhouMobile /></Suspense>; }
