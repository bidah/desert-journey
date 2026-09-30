// Serves the Next.js route handlers in app/api on Cloudflare Pages, where the
// site itself is a static export (see next.config.ts and scripts/build-pages.sh).

import * as sessionCleanup from "../../app/api/session-cleanup/route";
import * as token from "../../app/api/token/route";

type Handler = (request: Request) => Response | Promise<Response>;

const routes: Record<string, Record<string, unknown>> = {
  "session-cleanup": sessionCleanup,
  token,
};

export const onRequest = async ({
  request,
  params,
}: {
  request: Request;
  params: { path?: string[] };
}) => {
  const route = routes[(params.path ?? []).join("/")];
  if (!route) return Response.json({ error: "Not found" }, { status: 404 });
  const handler = route[request.method.toUpperCase()] as Handler | undefined;
  if (!handler) {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  return handler(request);
};
