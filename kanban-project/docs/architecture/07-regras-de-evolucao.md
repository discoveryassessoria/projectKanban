# 07 — Regras de evolução

> Baseline congelada em 04/08/2026. Evolução **estende**; nunca substitui.

## Toda nova funcionalidade DEVE reutilizar

1. o **contrato documental** (família, natureza, perfil);
2. o **Cadastro Mestre** de tipos de documento;
3. a **Matriz Documental** para definir o que deve nascer;
4. o **Materializador** existente;
5. o **Runtime** de workflow existente;
6. o **Documento Operacional** como entidade central;
7. o **Workflow Interno** como modelo de execução.

## É PROIBIDO

- criar novo fluxo paralelo ao existente;
- criar novo runtime;
- criar nova forma de anexar documentos;
- criar nova forma de criar tarefas;
- criar outra fonte da verdade;
- substituir a arquitetura;
- reescrever o runtime;
- criar legado, alias ou fallback estrutural;
- alterar a arquitetura sem ADR;
- alterar contratos sem atualizar os testes no mesmo commit.

## Como propor uma mudança estrutural

Mudança estrutural exige **ADR** — um registro de decisão em
[09-decisoes-arquiteturais](09-decisoes-arquiteturais.md), no mesmo commit da
implementação, contendo:

1. **o problema concreto** — não "seria melhor se", mas o que quebra hoje;
2. **por que a arquitetura atual não resolve** — provado, não afirmado;
3. **o que a mudança custa** — quais invariantes precisam mudar e o que depende delas;
4. **como o dado existente migra** — aditivo, idempotente, reversível;
5. **quais testes mudam** — e por quê a mudança não é regressão disfarçada.

Sem os cinco, a proposta não é avaliável.

## O que NÃO exige ADR

Estender sem contrariar: novo tipo documental no cadastro, novo perfil operacional,
nova regra na Matriz, novo passo num workflow, nova tela que consome o contrato
existente. Isso é uso da arquitetura, não mudança dela.

## Quando a baseline muda

Se um ADR for aprovado e a arquitetura mudar, **os documentos desta pasta e a suíte
`test:arquitetura-baseline` mudam no mesmo commit**. Documento que descreve uma
arquitetura que não existe mais é pior que nenhum documento.
