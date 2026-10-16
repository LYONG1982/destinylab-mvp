import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publishedProfile } from "@/server/agency-service";
import { HttpError } from "@/server/service";
import { enabled } from "@/server/private-http";
import { PublicProfileCard } from "@/features/tongzhou/PublicProfileCard";
export const dynamic = "force-dynamic";
const readProfile = cache(async (slug: string) => {
  try {
    enabled("TONGZHOU");
    return await publishedProfile(slug);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }
});
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { profile } = await readProfile((await params).slug);
  return {
    title: profile.title
      ? `${profile.title} · 同舟婚恋`
      : "同舟婚恋 · 个人介绍",
    description: "同舟婚恋 · 个人专属介绍",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}
export default async function Page({ params }: Props) {
  const { slug } = await params;
  const { profile } = await readProfile(slug);
  return (
    <main>
      <PublicProfileCard
        profile={profile}
        photoUrls={profile.photos?.map(
          (id) => `/api/tongzhou-public/${slug}?image=${id}`,
        )}
        photoUrl={profile.photo ? `/api/tongzhou-public/${slug}?photo=1` : null}
      />
    </main>
  );
}
