import { ownStudentProof } from "@/server/profile-wiring";
import { getSignedInUser } from "@/server/session";

const owner = async () => {
  const user = await getSignedInUser();
  return user && { uid: user.uid };
};

export async function GET(request: Request) {
  return ownStudentProof().view(await owner(), new URL(request.url).searchParams.get("file"));
}

export async function POST(request: Request) {
  return ownStudentProof().upload(await owner(), request);
}
