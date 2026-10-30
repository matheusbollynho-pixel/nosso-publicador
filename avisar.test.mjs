// Testes com Telegram falso: node --test avisar.test.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, before, after } from "node:test";
import { enviarTelegram } from "./avisar.mjs";

let srv, base, recebido, status;

before(async () => {
  srv = createServer((req, res) => {
    let corpo = "";
    req.on("data", (d) => (corpo += d));
    req.on("end", () => {
      recebido = { rota: req.url, corpo: JSON.parse(corpo) };
      res.writeHead(status).end("{}");
    });
  });
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

test("envia para o chat certo", async () => {
  status = 200;
  assert.equal(await enviarTelegram("oi", { token: "T", chat: "42", base }), true);
  assert.equal(recebido.rota, "/botT/sendMessage");
  assert.deepEqual(recebido.corpo, { chat_id: "42", text: "oi" });
});

test("corta mensagem grande", async () => {
  status = 200;
  await enviarTelegram("x".repeat(5000), { token: "T", chat: "42", base });
  assert.equal(recebido.corpo.text.length, 4000);
});

test("falha do Telegram devolve false sem lançar erro", async () => {
  status = 500;
  assert.equal(await enviarTelegram("oi", { token: "T", chat: "42", base }), false);
  assert.equal(await enviarTelegram("oi", { token: "T", chat: "42", base: "http://127.0.0.1:1" }), false);
  assert.equal(await enviarTelegram("oi", { token: "", chat: "", base }), false);
});
