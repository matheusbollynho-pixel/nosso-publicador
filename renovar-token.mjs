// Renova o token de usuário do Facebook (dura 60 dias) e imprime o novo em stdout.
// O workflow manda a saída direto pro `gh secret set`, sem aparecer no log.
// O token vem do Facebook (Graph API Explorer), então o refresh do graph.instagram.com não serve.
export async function renovar({
  token = process.env.IG_TOKEN,
  appId = process.env.META_APP_ID,
  appSecret = process.env.META_APP_SECRET,
  base = process.env.META_GRAPH_BASE || "https://graph.facebook.com/v26.0",
} = {}) {
  if (!token || !appId || !appSecret) throw new Error("faltam IG_TOKEN, META_APP_ID ou META_APP_SECRET");
  const url = new URL(base + "/oauth/access_token");
  url.search = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: token,
  });
  const res = await fetch(url);
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok || !corpo.access_token) {
    throw new Error("não consegui renovar o token: " + (corpo.error?.message || `HTTP ${res.status}`));
  }
  return corpo.access_token;
}

if (process.argv[1]?.endsWith("renovar-token.mjs")) {
  try {
    process.stdout.write(await renovar());
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
