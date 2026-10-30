// Renova o token de longa duração (dura 60 dias) e imprime o novo em stdout.
// O workflow manda a saída direto pro `gh secret set`, sem aparecer no log.
const res = await fetch(
  "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=" +
    encodeURIComponent(process.env.IG_TOKEN || ""),
);
const corpo = await res.json().catch(() => ({}));
if (!res.ok || !corpo.access_token) {
  console.error("não consegui renovar o token:", corpo.error?.message || `HTTP ${res.status}`);
  process.exit(1);
}
process.stdout.write(corpo.access_token);
