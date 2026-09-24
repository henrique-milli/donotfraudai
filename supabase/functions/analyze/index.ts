import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const visionUrl = Deno.env.get("VISION_URL") ?? "http://host.docker.internal:8001";
const riskUrl = Deno.env.get("RISK_URL") ?? "http://host.docker.internal:8002";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors() });
  }

  const body = await req.json();
  const vision = await fetch(`${visionUrl}/v1/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const analysis = await vision.json();

  const risk = await fetch(`${riskUrl}/v1/score`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: body.session_id,
      purpose: body.purpose ?? "onboarding",
      ...analysis,
    }),
  });
  const scored = await risk.json();

  return Response.json(
    { analysis, score: scored },
    { headers: cors() },
  );
});

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
  };
}
