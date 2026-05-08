// lib/financeiro/codigos.ts
// Geração de códigos únicos para Receita ("REC-XXXXXX") e Custo ("CUS-XXXXXX").
// Random com retry; baixa probabilidade de colisão (32^6 = ~1 bilhão).

import { prisma } from "@/lib/prisma";

// Alfabeto sem 0/O/1/I para evitar ambiguidade visual
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TAMANHO_SUFIXO = 6;
const MAX_TENTATIVAS = 10;

function gerarSufixo(): string {
  let s = "";
  for (let i = 0; i < TAMANHO_SUFIXO; i++) {
    s += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  }
  return s;
}

export async function gerarCodigoReceita(): Promise<string> {
  for (let i = 0; i < MAX_TENTATIVAS; i++) {
    const codigo = `REC-${gerarSufixo()}`;
    const existe = await prisma.receita.findUnique({ where: { codigo } });
    if (!existe) return codigo;
  }
  throw new Error(
    `Não foi possível gerar código único de Receita após ${MAX_TENTATIVAS} tentativas`
  );
}

export async function gerarCodigoCusto(): Promise<string> {
  for (let i = 0; i < MAX_TENTATIVAS; i++) {
    const codigo = `CUS-${gerarSufixo()}`;
    const existe = await prisma.custo.findUnique({ where: { codigo } });
    if (!existe) return codigo;
  }
  throw new Error(
    `Não foi possível gerar código único de Custo após ${MAX_TENTATIVAS} tentativas`
  );
}
