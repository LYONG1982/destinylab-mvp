import { redirect } from "next/navigation";
export default async function Page({ searchParams }: { searchParams: Promise<{ activity?: string | string[] }> }) {
  const { activity } = await searchParams;
  const query = typeof activity === "string" && /^[a-z0-9][a-z0-9-]{0,47}$/.test(activity)
    ? `?activity=${encodeURIComponent(activity)}` : "";
  redirect(`/mobile/01-start${query}`);
}
