import { sessionRoutes } from "@/server/session";

export function DELETE(request: Request) {
  return sessionRoutes().DELETE(request);
}
