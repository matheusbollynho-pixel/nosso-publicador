// Testes com Graph API falsa: node --test renovar-token.test.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, before, after } from "node:test";
import { renovar } from "./renovar-token.mjs";

let srv, base, recebido, resposta;

before(async () => {
  srv = createServer((req, res) => {
    recebido = new URL(req.url, "http://x");
    res.writeHead(resposta.status).end(JSON.stringify(resposta.corpo));
  });
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

const cfg = () => ({ token: "VELHO", appId: "1", appSecret: "S", base });

test("troca o token pelo fb_exchange_token", async () => {
  resposta = { status: 200, corpo: { access_token: "NOVO", expires_in: 5183999 } };
  assert.equal(await renovar(cfg()), "NOVO");
  assert.equal(recebido.pathname, "/oauth/access_token");
  assert.equal(recebido.searchParams.get("grant_type"), "fb_exchange_token");
  assert.equal(recebido.searchParams.get("fb_exchange_token"), "VELHO");
  assert.equal(recebido.searchParams.get("client_id"), "1");
});

test("erro da API vira exceção com a mensagem", async () => {
  resposta = { status: 400, corpo: { error: { message: "token expirado" } } };
  await assert.rejects(renovar(cfg()), /token expirado/);
});

test("sem segredo nem chama a API", async () => {
  recebido = null;
  await assert.rejects(renovar({ ...cfg(), appSecret: "" }), /faltam/);
  assert.equal(recebido, null);
});
