// Manda aviso no Telegram. Linha de comando: node avisar.mjs "mensagem"
// Nunca derruba quem chamou: devolve false se não conseguiu enviar.
import { fileURLToPath } from "node:url";

export async function enviarTelegram(texto, cfg = {}) {
  const token = cfg.token ?? process.env.TELEGRAM_BOT_TOKEN;
  const chat = cfg.chat ?? process.env.TELEGRAM_CHAT_ID;
  const base = cfg.base ?? process.env.TELEGRAM_API ?? "https://api.telegram.org";
  if (!token || !chat) {
    console.error("Telegram não configurado");
    return false;
  }
  try {
    const res = await fetch(`${base}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: texto.slice(0, 4000) }),
    });
    if (!res.ok) console.error(`Telegram respondeu HTTP ${res.status}`);
    return res.ok;
  } catch {
    console.error("Telegram fora do ar");
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!(await enviarTelegram(process.argv[2] || "Publicador: aviso sem texto"))) process.exitCode = 1;
}
