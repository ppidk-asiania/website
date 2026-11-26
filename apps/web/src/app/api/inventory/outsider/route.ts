import { loanRequests } from "@/server/inventory";

export async function POST(request: Request) {
  return loanRequests().outsider(request);
}
