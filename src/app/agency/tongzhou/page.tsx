import {TongzhouAgency} from "@/features/tongzhou/TongzhouAgency";
import {TongzhouAgencyLive} from "@/features/tongzhou/TongzhouAgencyLive";
import {notFound} from "next/navigation";
export default function Page() { if(process.env.DESTINY_DATA_MODE === "server" && process.env.DESTINY_TONGZHOU_ENABLED !== "true")notFound(); return process.env.DESTINY_DATA_MODE === "server" ? <TongzhouAgencyLive/> : <TongzhouAgency/>; }
