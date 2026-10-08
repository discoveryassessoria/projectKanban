"use client"
// lib/localidade/use-localidade.ts
// ============================================================================
// O CARREGAMENTO DA LOCALIDADE, num lugar só (08/10/2026) — o par cliente de `regra-localidade.ts`. Todo formulário com País/Estado-Província/Cidade/Cartório chama ESTE hook e só
// desenha o que ele devolve: o formulário «Dados registrados» (Central), o «Editar dados registrais» (aba Dados Registrais) e qualquer outro.
//   Brasil → estados e municípios do IBGE; qualquer outro país → províncias e cidades da base do servidor (`/api/localidades/*`). Cidade que a base não conhece é texto livre.
// ============================================================================
import { useEffect, useState } from "react"
import { useApi } from "@/src/lib/dados"
import { ehPaisBrasil, rotuloDaDivisao } from "./regra-localidade"

export interface PaisDaLista { id: number; codigo: string; nome: string }

export function useLocalidade(args: { ativo: boolean; pais: string; estadoOuProvincia: string; cidade: string }) {
  const { ativo, pais, estadoOuProvincia, cidade } = args
  const paisesReq = useApi<{ paises?: PaisDaLista[] }>(ativo ? "/api/geografia/paises" : null)
  const paises = paisesReq.dados?.paises ?? []
  const paisSelecionado = paises.find((p) => p.nome === pais) ?? null
  // Documento sem país gravado ainda (legado) segue tratado como Brasil.
  const paisCodigo = paisSelecionado?.codigo ?? (pais ? null : "BR")
  const ehBrasil = paisCodigo === "BR" || (paisCodigo == null && ehPaisBrasil(pais))

  // BRASIL: Estado → Cidade em cascata, direto do IBGE (fonte pública oficial, sem chave).
  const [ufs, setUfs] = useState<{ sigla: string; nome: string }[]>([])
  const [municipiosDaUf, setMunicipiosDaUf] = useState<{ uf: string; lista: string[] } | null>(null)
  useEffect(() => {
    if (!ativo) return
    fetch("https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome")
      .then((r) => (r.ok ? r.json() : []))
      .then((lista: Array<{ sigla: string; nome: string }>) => setUfs(Array.isArray(lista) ? lista : []))
      .catch(() => setUfs([]))
  }, [ativo])
  const ufSigla = ufs.find((u) => u.nome === estadoOuProvincia)?.sigla ?? null
  useEffect(() => {
    if (!ativo || !ufSigla) return
    let vivo = true
    fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${ufSigla}/municipios?orderBy=nome`)
      .then((r) => (r.ok ? r.json() : []))
      .then((lista: Array<{ nome: string }>) => { if (vivo) setMunicipiosDaUf({ uf: ufSigla, lista: Array.isArray(lista) ? lista.map((m) => m.nome) : [] }) })
      .catch(() => { if (vivo) setMunicipiosDaUf({ uf: ufSigla, lista: [] }) })
    return () => { vivo = false }
  }, [ativo, ufSigla])
  // Derivado (sem setState síncrono no efeito): só vale a lista da UF escolhida agora.
  const municipios = ufSigla && municipiosDaUf?.uf === ufSigla ? municipiosDaUf.lista : []

  // FORA DO BRASIL: Província e Cidade da base do servidor.
  const provinciasReq = useApi<{ provincias?: { codigo: string; nome: string }[] }>(ativo && !ehBrasil && paisCodigo ? `/api/localidades/provincias?pais=${paisCodigo}` : null)
  const cidadesReq = useApi<{ cidades?: { nome: string; provincia: string | null }[] }>(
    ativo && !ehBrasil && paisCodigo ? `/api/localidades/cidades?pais=${paisCodigo}${estadoOuProvincia ? `&provincia=${encodeURIComponent(estadoOuProvincia)}` : ""}&q=${encodeURIComponent(cidade)}` : null,
  )
  return {
    paises, paisSelecionado, paisCodigo, ehBrasil, rotuloDivisao: rotuloDaDivisao(pais),
    ufs, municipios, ufSigla,
    provincias: provinciasReq.dados?.provincias ?? [], cidadesSugeridas: cidadesReq.dados?.cidades ?? [],
  }
}
