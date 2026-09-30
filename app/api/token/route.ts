import {
  isReactorModelName,
  ORBIS_MODEL_NAME,
  type ReactorModelName,
} from "@/lib/reactor-models";

const REACTOR_API_URL = "https://api.reactor.inc";

/** Mints a session JWT scoped to one allowlisted model (Orbis by default). */
export async function POST(request: Request) {
  const apiKey = process.env.REACTOR_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "REACTOR_API_KEY is not configured" },
      { status: 500 },
    );
  }

  let model: ReactorModelName = ORBIS_MODEL_NAME;
  const body = (await request.json().catch(() => null)) as {
    model?: unknown;
  } | null;
  if (body?.model !== undefined) {
    if (!isReactorModelName(body.model)) {
      return Response.json({ error: "Unknown model" }, { status: 400 });
    }
    model = body.model;
  }

  const response = await fetch(`${REACTOR_API_URL}/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Reactor-API-Key": apiKey,
    },
    body: JSON.stringify({
      expires_after: 3600,
      authorization_details: [
        {
          type: "session",
          resources: { models: { match: [model] } },
          constraints: { max_sessions: 1, max_session_duration_seconds: 300 },
        },
      ],
    }),
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    return Response.json(
      { error: `Reactor token request failed (${response.status}): ${text}` },
      { status: response.status },
    );
  }

  const result = JSON.parse(text) as { jwt?: string };
  if (!result.jwt) {
    return Response.json({ error: "Reactor returned no JWT" }, { status: 502 });
  }

  return Response.json(
    { jwt: result.jwt },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
