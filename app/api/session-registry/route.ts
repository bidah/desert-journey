import {
  isReactorModelName,
  ORBIS_MODEL_NAME,
  type ReactorModelName,
} from "@/lib/reactor-models";
import {
  registerReactorSession,
  unregisterReactorSession,
} from "@/lib/server/reactor-session-registry";

export const runtime = "nodejs";

const REACTOR_API_URL = "https://api.reactor.inc";

type RegistryRequest = {
  sessionId?: unknown;
  jwt?: unknown;
  /** The model the session was opened on; Orbis when omitted. */
  model?: unknown;
};

function unavailableInProduction() {
  return Response.json({ error: "Not found" }, { status: 404 });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return unavailableInProduction();
  }

  let body: RegistryRequest;
  try {
    body = (await request.json()) as RegistryRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, jwt } = body;
  let model: ReactorModelName = ORBIS_MODEL_NAME;
  if (body.model !== undefined) {
    if (!isReactorModelName(body.model)) {
      return Response.json({ error: "Unknown model" }, { status: 400 });
    }
    model = body.model;
  }
  if (
    typeof sessionId !== "string" ||
    !sessionId ||
    sessionId.length > 200 ||
    typeof jwt !== "string" ||
    !jwt ||
    jwt.length > 16_384
  ) {
    return Response.json(
      { error: "A valid sessionId and JWT are required" },
      { status: 400 },
    );
  }

  let response: Response;
  try {
    response = await fetch(
      `${REACTOR_API_URL}/sessions/${encodeURIComponent(sessionId)}`,
      {
        headers: { Authorization: `Bearer ${jwt}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return Response.json(
      { error: "Could not verify Reactor session" },
      { status: 502 },
    );
  }

  if (!response.ok) {
    return Response.json(
      { error: "Reactor session verification failed" },
      { status: response.status },
    );
  }

  const session = (await response.json()) as {
    model?: string | { name?: string };
    closed?: boolean;
    state?: string;
  };
  const sessionModel =
    typeof session.model === "string" ? session.model : session.model?.name;
  if (
    sessionModel !== model ||
    session.closed === true ||
    session.state?.toUpperCase() === "CLOSED"
  ) {
    return Response.json(
      { error: `Session is not an active ${model} session` },
      { status: 400 },
    );
  }

  await registerReactorSession({
    sessionId,
    model,
    registeredAt: new Date().toISOString(),
  });
  return new Response(null, { status: 204 });
}

export async function DELETE(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return unavailableInProduction();
  }

  let body: RegistryRequest;
  try {
    body = (await request.json()) as RegistryRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.sessionId !== "string" || !body.sessionId) {
    return Response.json(
      { error: "A sessionId is required" },
      { status: 400 },
    );
  }

  await unregisterReactorSession(body.sessionId);
  return new Response(null, { status: 204 });
}
