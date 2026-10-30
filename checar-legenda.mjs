// Trava de qualidade da legenda em pt-BR. Devolve a lista de erros (vazia = pode sair).
const INVISIVEIS = /[­​-‏‪-‮⁠-⁤﻿\u{E0000}-\u{E007F}]/u;
const LINK = /https?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|com\.br|food|net|org|io|app)\b/i;
const SAUDACAO = /^(oi|olá|ola|e aí|e ai|fala|bom dia|boa tarde|boa noite)\b/i;

// Frases de texto genérico de IA e de isca de engajamento.
const CLICHES = [
  "no mundo de hoje", "nos dias de hoje", "cada vez mais competitivo", "não é apenas", "nao e apenas",
  "não é só sobre", "mais do que nunca", "vale ressaltar", "é importante destacar", "em resumo",
  "descubra como", "desbloqueie", "potencialize", "alavanque", "eleve o seu", "eleve seu",
  "revolucione", "revolucionar", "transforme seu", "transforme o seu", "imperdível", "jornada",
  "segue pra mais", "siga para mais", "marque alguém", "marca alguém", "curte se", "pare de rolar",
];

export function checarLegenda(legenda) {
  const erros = [];
  const texto = (legenda || "").trim();
  if (!texto) return ["legenda vazia"];
  if (texto.length > 2200) erros.push(`${texto.length} caracteres, máximo 2200`);
  if (texto.includes("{{")) erros.push("ainda tem {{campo}} sem preencher");
  if (INVISIVEIS.test(texto)) erros.push("tem caractere invisível");
  if (/[—–]/.test(texto)) erros.push("tem travessão");
  if (LINK.test(texto)) erros.push("tem link, que não é clicável na legenda");
  const tags = texto.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || [];
  if (tags.length > 5) erros.push(`${tags.length} hashtags, máximo 5`);
  const primeira = texto.split("\n")[0];
  if (primeira.startsWith("#")) erros.push("começa com hashtag");
  if (/^\p{Extended_Pictographic}/u.test(primeira)) erros.push("começa com emoji");
  if (SAUDACAO.test(primeira)) erros.push("começa com saudação");
  const minusculo = texto.toLowerCase();
  for (const c of CLICHES) if (minusculo.includes(c)) erros.push(`clichê: "${c}"`);
  return erros;
}
