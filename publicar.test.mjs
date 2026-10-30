// Testes com API falsa: node --test publicar.test.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, before, after, beforeEach } from "node:test";
import { checarLegenda } from "./checar-legenda.mjs";
import { rodar, horaEfetiva } from "./publicar.mjs";

const AGORA = Date.parse("2026-11-02T22:00:00Z");
let srv, base, chamadas, estado;

before(async () => {
  srv = createServer((req, res) => {
    let corpo = "";
    req.on("data", (d) => (corpo += d));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const p = corpo ? JSON.parse(corpo) : {};
      chamadas.push({ metodo: req.method, rota: url.pathname, p });
      const json = (o, s = 200) => {
        res.writeHead(s, { "Content-Type": "application/json" });
        res.end(JSON.stringify(o));
      };
      if (url.pathname.startsWith("/midia/")) {
        const tipo = url.pathname.endsWith(".mp4") ? "video/mp4" : url.pathname.endsWith(".png") ? "image/png" : "image/jpeg";
        res.writeHead(url.pathname.includes("sumiu") ? 404 : 200, { "Content-Type": tipo });
        return res.end();
      }
      if (url.pathname === "/9/media" && req.method === "GET") return json({ data: estado.noAr });
      if (url.pathname === "/9/media") return json({ id: `c${++estado.n}` });
      if (url.pathname === "/9/content_publishing_limit") return json({ data: [{ quota_usage: estado.usados, config: { quota_total: 100 } }] });
      if (url.pathname === "/9/media_publish") {
        estado.publicacoes++;
        if (estado.quebraDepoisDePublicar) {
          estado.noAr.push({ id: "m1", caption: estado.legenda, permalink: "http://ig/p/m1" });
          return json({}, 500);
        }
        if (estado.publicaFalha) return json({}, 500);
        return json({ id: "m1" });
      }
      if (url.pathname === "/m1") return json({ permalink: "http://ig/p/m1" });
      if (url.pathname.startsWith("/c")) return json({ status_code: estado.statusContainer });
      json({ error: { message: "rota?" } }, 404);
    });
  });
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());
beforeEach(() => {
  chamadas = [];
  estado = { n: 0, noAr: [], usados: 0, publicacoes: 0, statusContainer: "FINISHED", legenda: LEGENDA };
});

const LEGENDA = "Vinte mil por mês no app custam R$ 5.400 de taxa.\n\nComenta CONTA que eu te mostro.\n\n#delivery";
const cfg = () => ({
  apiBase: base, token: "t", userId: "9", dryRun: false, variacaoMaxMin: 40, atrasoMaxH: 6, intervaloMinH: 12,
  esperaStatusMs: 1, tentativasStatus: 3, esperaRetryMs: 1,
});
const item = (id, x = {}) => ({
  id, tipo: "reel", midia: [`${base}/midia/a.mp4`], capa: `${base}/midia/c.jpg`, legenda: LEGENDA,
  quando: new Date(AGORA - 3600_000).toISOString(), aprovado: true, status: "pendente", ...x,
});
const posts = (rota = "/9/media_publish") => chamadas.filter((c) => c.rota === rota);

test("publica reel aprovado com capa e share_to_feed", async () => {
  const f = [item("r1")];
  const r = await rodar(f, AGORA, cfg());
  assert.equal(r.publicado.id, "r1");
  assert.equal(f[0].status, "publicado");
  assert.equal(f[0].link, "http://ig/p/m1");
  const c = chamadas.find((x) => x.rota === "/9/media" && x.metodo === "POST").p;
  assert.deepEqual([c.media_type, c.share_to_feed, c.cover_url], ["REELS", true, `${base}/midia/c.jpg`]);
});

test("carrossel cria filhos e depois o pai com a legenda", async () => {
  const f = [item("c", { tipo: "carrossel", capa: undefined, midia: [`${base}/midia/1.jpg`, `${base}/midia/2.jpg`] })];
  await rodar(f, AGORA, cfg());
  const cs = chamadas.filter((x) => x.rota === "/9/media" && x.metodo === "POST").map((x) => x.p);
  assert.equal(cs.length, 3);
  assert.ok(cs[0].is_carousel_item && !cs[0].caption);
  assert.deepEqual([cs[2].media_type, cs[2].children, cs[2].caption], ["CAROUSEL", "c1,c2", LEGENDA]);
  assert.equal(f[0].status, "publicado");
});

test("sem aprovação não sai", async () => {
  const f = [item("r1", { aprovado: false })];
  await rodar(f, AGORA, cfg());
  assert.equal(f[0].status, "pendente");
  assert.equal(chamadas.length, 0);
});

test("acúmulo não vira rajada: 5 vencidos, os velhos saem da fila e só 1 publica", async () => {
  const f = [1, 2, 3, 4].map((n) => item(`v${n}`, { quando: new Date(AGORA - (20 + n) * 3600_000).toISOString() }));
  f.push(item("novo", { legenda: LEGENDA }));
  const r = await rodar(f, AGORA, cfg());
  assert.equal(posts().length, 1);
  assert.equal(r.publicado.id, "novo");
  assert.deepEqual(f.slice(0, 4).map((i) => i.status), ["atrasado", "atrasado", "atrasado", "atrasado"]);
  assert.equal(r.avisos.length, 4);
});

test("dois no horário: só 1 por execução, e o segundo respeita o intervalo", async () => {
  const f = [item("a"), item("b", { legenda: LEGENDA + " #b" })];
  await rodar(f, AGORA, cfg());
  assert.equal(posts().length, 1);
  await rodar(f, AGORA + 3600_000, cfg());
  assert.equal(posts().length, 1);
  await rodar(f, AGORA + 13 * 3600_000, cfg());
  assert.equal(f.filter((i) => i.status === "atrasado").length + posts().length, 2);
});

test("legenda ruim bloqueia antes de tocar na API", async () => {
  const f = [item("r1", { legenda: "Oi gente, descubra como vender mais — agora" })];
  const r = await rodar(f, AGORA, cfg());
  assert.equal(f[0].status, "bloqueado");
  assert.equal(r.avisos.length, 1);
  assert.equal(chamadas.length, 0);
});

test("não publica de novo o que já está no ar", async () => {
  estado.noAr.push({ id: "m9", caption: LEGENDA, permalink: "http://ig/p/m9" });
  const f = [item("r1")];
  await rodar(f, AGORA, cfg());
  assert.equal(posts().length, 0);
  assert.equal(f[0].link, "http://ig/p/m9");
});

test("erro na resposta mas post saiu: marca publicado e não repete", async () => {
  estado.quebraDepoisDePublicar = true;
  const f = [item("r1")];
  await rodar(f, AGORA, cfg());
  assert.equal(posts().length, 1);
  assert.equal(f[0].status, "publicado");
});

test("publicação incerta vai pra revisão e nunca tenta de novo", async () => {
  estado.publicaFalha = true;
  const f = [item("r1")];
  const r = await rodar(f, AGORA, cfg());
  assert.equal(f[0].status, "revisar");
  assert.equal(posts().length, 1);
  await rodar(f, AGORA + 13 * 3600_000, cfg());
  assert.equal(posts().length, 1);
  assert.equal(r.avisos.length, 1);
});

test("PNG e mídia fora do ar falham sem publicar", async () => {
  const png = [item("p", { tipo: "imagem", capa: undefined, midia: [`${base}/midia/a.png`] })];
  await rodar(png, AGORA, cfg());
  assert.equal(png[0].status, "falhou");
  const sumiu = [item("s", { midia: [`${base}/midia/sumiu.mp4`] })];
  await rodar(sumiu, AGORA, cfg());
  assert.equal(sumiu[0].status, "falhou");
  assert.equal(posts().length, 0);
});

test("container com ERROR não publica", async () => {
  estado.statusContainer = "ERROR";
  const f = [item("r1")];
  await rodar(f, AGORA, cfg());
  assert.equal(f[0].status, "falhou");
  assert.equal(posts().length, 0);
});

test("limite da API esgotado não publica", async () => {
  estado.usados = 100;
  const f = [item("r1")];
  await rodar(f, AGORA, cfg());
  assert.equal(f[0].status, "falhou");
  assert.equal(posts().length, 0);
});

test("horário varia de forma estável, até 40 min", () => {
  const c = cfg();
  const i = item("r1");
  const d = horaEfetiva(i, c) - Date.parse(i.quando);
  assert.ok(d >= 0 && d <= 40 * 60_000);
  assert.equal(horaEfetiva(i, c), horaEfetiva(i, c));
});

test("checarLegenda aceita texto bom e pega os problemas", () => {
  assert.deepEqual(checarLegenda(LEGENDA), []);
  assert.ok(checarLegenda("#a texto").length);
  assert.ok(checarLegenda("Veja em nosso.food").some((e) => e.includes("link")));
  assert.ok(checarLegenda("Texto #a #b #c #d #e #f").some((e) => e.includes("hashtags")));
  assert.ok(checarLegenda("Texto​ oculto").some((e) => e.includes("invisível")));
  assert.ok(checarLegenda("Vendeu {{valor}}").length);
});
