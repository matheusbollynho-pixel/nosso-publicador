// Publica no máximo 1 post aprovado da fila.json pela API oficial do Instagram.
// Uso: IG_TOKEN=... IG_USER_ID=... node publicar.mjs   (DRY_RUN=1 só simula)
// Sai com código 1 quando algo precisa de atenção (o GitHub avisa por e-mail).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { enviarTelegram } from "./avisar.mjs";
import { checarLegenda } from "./checar-legenda.mjs";

const HORA = 3600_000;
export const PADRAO = {
  apiBase: process.env.IG_API_BASE || `https://graph.instagram.com/${process.env.IG_API_VERSION || "v26.0"}`,
  token: process.env.IG_TOKEN,
  userId: process.env.IG_USER_ID,
  dryRun: process.env.DRY_RUN === "1",
  variacaoMaxMin: 40, // horário varia um pouco por post
  atrasoMaxH: 6, // passou disso, não sai sozinho: nunca descarregar acúmulo
  intervaloMinH: 12, // nunca 2 posts em menos que isso
  esperaStatusMs: 60_000,
  tentativasStatus: 5,
  esperaRetryMs: 5_000,
};

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Atraso fixo por post, pra rodar de novo não mudar o horário sorteado.
export function horaEfetiva(item, cfg) {
  const h = createHash("sha256").update(item.id).digest().readUInt16BE(0);
  return new Date(item.quando).getTime() + (h % (cfg.variacaoMaxMin + 1)) * 60_000;
}

function cliente(cfg) {
  async function chamar(metodo, caminho, params = {}) {
    const url = new URL(cfg.apiBase + caminho);
    const init = { method: metodo, headers: { Authorization: `Bearer ${cfg.token}` } };
    if (metodo === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    else {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(params);
    }
    const res = await fetch(url, init);
    const corpo = await res.json().catch(() => ({}));
    if (!res.ok || corpo.error) {
      const e = new Error(corpo.error?.message || `HTTP ${res.status} em ${caminho}`);
      e.temporario = res.status >= 500 || res.status === 429 || corpo.error?.is_transient === true;
      throw e;
    }
    return corpo;
  }
  // Só para operações seguras de repetir. media_publish NUNCA passa por aqui.
  async function comRetry(metodo, caminho, params) {
    for (let i = 1; ; i++) {
      try {
        return await chamar(metodo, caminho, params);
      } catch (e) {
        const rede = !("temporario" in e);
        if (i >= 3 || !(e.temporario || rede)) throw e;
        await dormir(cfg.esperaRetryMs * i);
      }
    }
  }
  return { chamar, comRetry };
}

async function checarUrl(url, tipos) {
  const res = await fetch(url, { method: "HEAD" });
  const tipo = (res.headers.get("content-type") || "").split(";")[0];
  if (!res.ok) throw new Error(`mídia inacessível (HTTP ${res.status}): ${url}`);
  if (!tipos.includes(tipo)) throw new Error(`mídia com tipo ${tipo || "?"}, esperado ${tipos.join("/")}: ${url}`);
}

async function checarMidia(item) {
  const jpeg = ["image/jpeg"];
  if (item.tipo === "reel") {
    if (item.midia.length !== 1) throw new Error("reel precisa de exatamente 1 vídeo");
    await checarUrl(item.midia[0], ["video/mp4", "video/quicktime"]);
    if (item.capa) await checarUrl(item.capa, jpeg);
  } else if (item.tipo === "carrossel") {
    if (item.midia.length < 2 || item.midia.length > 20) throw new Error("carrossel precisa de 2 a 20 imagens");
    for (const u of item.midia) await checarUrl(u, jpeg);
  } else if (item.tipo === "imagem") {
    if (item.midia.length !== 1) throw new Error("imagem precisa de exatamente 1 arquivo");
    await checarUrl(item.midia[0], jpeg);
  } else throw new Error(`tipo desconhecido: ${item.tipo}`);
}

async function esperarPronto(api, cfg, id) {
  for (let i = 0; i < cfg.tentativasStatus; i++) {
    const { status_code: s } = await api.comRetry("GET", `/${id}`, { fields: "status_code" });
    if (s === "FINISHED") return;
    if (s === "ERROR" || s === "EXPIRED") throw new Error(`container ${id} ficou ${s}`);
    await dormir(cfg.esperaStatusMs);
  }
  throw new Error(`container ${id} não ficou pronto a tempo`);
}

async function criarContainer(api, cfg, item) {
  const media = `/${cfg.userId}/media`;
  if (item.tipo === "imagem")
    return (await api.comRetry("POST", media, { image_url: item.midia[0], caption: item.legenda })).id;
  if (item.tipo === "reel") {
    const p = { media_type: "REELS", video_url: item.midia[0], caption: item.legenda, share_to_feed: true };
    if (item.capa) p.cover_url = item.capa;
    return (await api.comRetry("POST", media, p)).id;
  }
  const filhos = [];
  for (const u of item.midia) {
    const { id } = await api.comRetry("POST", media, { image_url: u, is_carousel_item: true });
    filhos.push(id);
  }
  for (const id of filhos) await esperarPronto(api, cfg, id);
  return (await api.comRetry("POST", media, { media_type: "CAROUSEL", children: filhos.join(","), caption: item.legenda })).id;
}

// Procura o post no Instagram pela legenda, pra nunca publicar duas vezes.
async function acharPublicado(api, cfg, legenda) {
  const { data = [] } = await api.comRetry("GET", `/${cfg.userId}/media`, { fields: "id,caption,permalink", limit: 25 });
  return data.find((m) => (m.caption || "").trim() === legenda.trim());
}

// Devolve { avisos, publicado }. Altera os itens da fila no lugar.
export async function rodar(fila, agora, cfg) {
  const avisos = [];
  const api = cliente(cfg);
  const pendentes = fila
    .filter((i) => i.status === "pendente" && i.aprovado === true)
    .sort((a, b) => horaEfetiva(a, cfg) - horaEfetiva(b, cfg));

  // Vencidos demais saem da fila. Um cron parado não pode gerar rajada de posts.
  for (const i of pendentes) {
    if (agora - horaEfetiva(i, cfg) > cfg.atrasoMaxH * HORA) {
      i.status = "atrasado";
      avisos.push(`${i.id}: passou do horário em mais de ${cfg.atrasoMaxH}h, reagende`);
    }
  }
  const item = pendentes.find((i) => i.status === "pendente" && horaEfetiva(i, cfg) <= agora);
  if (!item) return { avisos, publicado: null };

  const ultimo = Math.max(0, ...fila.filter((i) => i.publicadoEm).map((i) => new Date(i.publicadoEm).getTime()));
  if (agora - ultimo < cfg.intervaloMinH * HORA) return { avisos, publicado: null };

  const erros = checarLegenda(item.legenda);
  if (erros.length) {
    item.status = "bloqueado";
    item.erro = erros.join("; ");
    avisos.push(`${item.id}: legenda bloqueada: ${item.erro}`);
    return { avisos, publicado: null };
  }

  try {
    await checarMidia(item);
    if (cfg.dryRun) {
      console.log(`[simulação] publicaria ${item.id}`);
      return { avisos, publicado: null };
    }
    const repetido = await acharPublicado(api, cfg, item.legenda);
    if (repetido) {
      item.status = "publicado";
      item.publicadoEm = new Date(agora).toISOString();
      item.link = repetido.permalink;
      avisos.push(`${item.id}: já estava no ar, não publiquei de novo`);
      return { avisos, publicado: null };
    }
    const limite = await api.comRetry("GET", `/${cfg.userId}/content_publishing_limit`, { fields: "quota_usage,config" });
    const q = limite.data?.[0];
    if (q?.config?.quota_total && q.quota_usage >= q.config.quota_total) throw new Error("limite diário da API atingido");

    const container = await criarContainer(api, cfg, item);
    await esperarPronto(api, cfg, container);
    item.status = "publicando";
    let midiaId;
    try {
      ({ id: midiaId } = await api.chamar("POST", `/${cfg.userId}/media_publish`, { creation_id: container }));
    } catch (e) {
      // A resposta falhou, mas o post pode ter saído. Confere e não repete.
      const achado = await acharPublicado(api, cfg, item.legenda).catch(() => null);
      if (!achado) {
        item.status = "revisar";
        item.erro = e.message;
        avisos.push(`${item.id}: publicação incerta (${e.message}), confira o perfil antes de liberar de novo`);
        return { avisos, publicado: null };
      }
      midiaId = achado.id;
    }
    item.status = "publicado";
    item.publicadoEm = new Date(agora).toISOString();
    item.midiaId = midiaId;
    item.link = (await api.comRetry("GET", `/${midiaId}`, { fields: "permalink" }).catch(() => ({}))).permalink;
    return { avisos, publicado: item };
  } catch (e) {
    item.status = "falhou";
    item.erro = e.message;
    avisos.push(`${item.id}: falhou: ${e.message}`);
    return { avisos, publicado: null };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arquivo = new URL("./fila.json", import.meta.url);
  const fila = JSON.parse(readFileSync(arquivo, "utf8"));
  if (!PADRAO.dryRun && (!PADRAO.token || !PADRAO.userId)) {
    console.error("faltam IG_TOKEN e IG_USER_ID");
    process.exit(1);
  }
  const { avisos, publicado } = await rodar(fila, Date.now(), PADRAO);
  writeFileSync(arquivo, JSON.stringify(fila, null, 2) + "\n");
  if (publicado) console.log(`publicado: ${publicado.id} ${publicado.link || ""}`);
  for (const a of avisos) console.error(a);
  if (avisos.length) {
    process.exitCode = 1;
    const texto = `⚠️ Instagram @nosso.food\n\n${avisos.join("\n\n")}\n\nAbra fila.json para corrigir ou reagendar.`;
    // O arquivo evita aviso repetido do passo de falha do workflow.
    if (await enviarTelegram(texto)) writeFileSync(new URL("./.avisado", import.meta.url), "1");
  }
}
