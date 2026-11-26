import { isValidSlug } from "@website/domain/shared";
import { uploadEventProof } from "@/server/events";
import { getSignedInUser } from "@/server/session";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isValidSlug(slug)) return Response.json({ ok: false, error: "no_event" }, { status: 404 });
  const user = await getSignedInUser();
  return uploadEventProof()(user && { uid: user.uid }, slug, request);
}
