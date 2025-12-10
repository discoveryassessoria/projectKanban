"use client";

import { useState, useEffect } from "react"
import Image from "next/image"
import AuthComponent from "@/src/components/auth"
import backgroundImage from "@/public/imagemfundo.jpg"
import discoveryLogo from "@/public/discoverylogo.svg"
import { motion } from "framer-motion"

export default function AuthPage() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

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
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-10">
          <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full" />
        </div>
      )}

      {/* Conteúdo */}
      {mounted && (
        <div className="absolute inset-0 flex items-center justify-between px-8 md:px-20 lg:px-32">
          {/* Logo grande à esquerda */}
          <motion.div 
            className="flex-1 flex items-center justify-center" 
            initial={{ x: -80, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <Image
              src={discoveryLogo}
              alt="Logo Discovery"
              width={560}
              height={200}
              className="drop-shadow-2xl"
              priority
            />
          </motion.div>

          {/* Caixa de login */}
          <motion.div 
            className="flex-1 flex items-center justify-center"
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