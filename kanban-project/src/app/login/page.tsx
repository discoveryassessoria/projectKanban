"use client";

import { useState, useEffect } from "react"
import Image from "next/image"
import AuthComponent from "@/src/components/auth"
import backgroundImage from "@/public/imagemfundo.jpg"
import discoveryLogo from "@/public/discoverylogo.svg"
import { motion } from "framer-motion"
import { useIsClient } from "@/src/lib/cliente"

export default function AuthPage() {
  // `mounted` virou useIsClient: mesmo contrato (false no servidor e no primeiro
  // render, true depois), sem o render em cascata que o setState no efeito causa.
  const mounted = useIsClient()

  return (
    <div className="fixed inset-0 z-50">
      {/* Fundo do login - cobre tudo incluindo o fundo global */}
      <Image
        src={backgroundImage}
        alt="Fundo"
        fill
        priority
        className="object-cover"
      />

      {/* Loading spinner */}
      {!mounted && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--overlay-modal)] z-10">
          <div className="animate-spin h-12 w-12 border-4 border-[var(--border-default)] border-t-transparent rounded-full" />
        </div>
      )}

      {/* Conteúdo */}
      {mounted && (
        // ABAIXO DE md: empilhado (logo pequeno em cima, formulário embaixo) —
        // lado a lado num viewport de 390px espremia os dois flex-1 até o
        // logo virar decoração ilegível (mandato "modernização visual",
        // 19/09/2026). A partir de md, volta ao layout lado a lado original.
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-10 md:flex-row md:items-center md:justify-between md:gap-0 md:overflow-visible md:px-20 md:py-0 lg:px-32">
          {/* Logo — pequeno e no topo em mobile; grande à esquerda a partir de md */}
          <motion.div
            className="flex shrink-0 items-center justify-center md:flex-1"
            initial={{ x: -80, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <Image
              src={discoveryLogo}
              alt="Logo Discovery"
              width={560}
              height={200}
              className="h-auto w-40 drop-shadow-[var(--elev-3)] md:w-auto"
              priority
            />
          </motion.div>

          {/* Caixa de login */}
          <motion.div
            className="flex w-full flex-1 items-center justify-center md:flex-1"
            initial={{ x: 80, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <div className="w-full max-w-md">
              <AuthComponent />
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}