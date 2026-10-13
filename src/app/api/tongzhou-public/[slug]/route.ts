import {
  publishedProfile,
  publishedGalleryPhoto,
} from "@/server/agency-service";
import { enabled, fail } from "@/server/private-http";
import { HttpError } from "@/server/service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    enabled("TONGZHOU");
    const slug = (await params).slug;
    const { profile, photo } = await publishedProfile(slug);
    const headers = {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    };
    const selected = new URL(request.url).searchParams.get("image");
    if (selected)
      return new Response(
        new Uint8Array(await publishedGalleryPhoto(slug, selected)),
        { headers: { ...headers, "Content-Type": "image/webp" } },
      );
    if (new URL(request.url).searchParams.get("photo") === "1") {
      if (!profile.photo || !photo) throw new HttpError(404, "照片不可查看。");
      return new Response(new Uint8Array(photo), {
        headers: { ...headers, "Content-Type": "image/webp" },
      });
    }
    return Response.json(profile, { headers });
  } catch (e) {
    return fail(e);
  }
}
