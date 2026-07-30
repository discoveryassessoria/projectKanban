"use client"

// src/hooks/use-debounce.ts
// ============================================================================
// DEBOUNCE de um valor — uma definição, todas as telas.
//
// Por que existe: as telas com busca faziam sempre a mesma coisa à mão — um
// `useEffect` com `setTimeout(…, 500)` chamando o carregador, mais um segundo
// efeito para a carga inicial, mais um `eslint-disable-line` em cada um. Isso
// atrasava a BUSCA, não o VALOR, então cada tela precisava de estado próprio
// para o resultado.
//
// Aqui o que atrasa é o valor. Quem consome usa o valor atrasado como chave da
// consulta, e a camada de dados cuida de cache, dedupe e cancelamento.
//
// O `setEstavel` acontece DENTRO do timer, não no corpo do efeito: sincronizar
// com um cronômetro é exatamente o caso em que efeito é a ferramenta certa.
// ============================================================================

import { useEffect, useState } from "react"

export function useDebounce<T>(valor: T, atrasoMs = 500): T {
  const [estavel, setEstavel] = useState(valor)

  useEffect(() => {
    const timer = setTimeout(() => setEstavel(valor), atrasoMs)
    // Digitar de novo antes do prazo cancela o anterior: só a última tecla conta.
    return () => clearTimeout(timer)
  }, [valor, atrasoMs])

  return estavel
}
