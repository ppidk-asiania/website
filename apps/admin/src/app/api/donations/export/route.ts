import { connection } from "next/server";
import { getPrincipal } from "@/server/context";
import { donationActions } from "@/server/wiring";

export async function GET() {
  await connection();
  return donationActions().exportCsv(await getPrincipal());
}
