/**
 * Estado persistido do provedor (JSON em disco).
 * O painel do React le e escreve este mesmo arquivo via API REST.
 */

import fs from 'node:fs'
import path from 'node:path'
import { ARQUIVO_ESTADO, DATA_DIR, garantirDir } from './config.mjs'
import { estadoPadrao } from './seed.mjs'

/** Mescla objetos comuns preservando as chaves do arquivo salvo. */
function mesclar(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return patch === undefined ? base : patch
  }
  const saida = { ...(base && typeof base === 'object' ? base : {}) }
  for (const [chave, valor] of Object.entries(patch)) {
    const atual = saida[chave]
    if (
      valor &&
      typeof valor === 'object' &&
      !Array.isArray(valor) &&
      atual &&
      typeof atual === 'object' &&
      !Array.isArray(atual)
    ) {
      saida[chave] = mesclar(atual, valor)
    } else {
      saida[chave] = valor
    }
  }
  return saida
}

const ESTADO_INICIAL = estadoPadrao()

let cache = null

export function lerEstado() {
  if (cache) return cache
  garantirDir(DATA_DIR)
  if (fs.existsSync(ARQUIVO_ESTADO)) {
    try {
      const bruto = fs.readFileSync(ARQUIVO_ESTADO, 'utf8')
      // O seed preenche o que ainda nao existe no arquivo salvo: assim uma
      // instalacao antiga ganha o perfil de referencia sem perder a operacao.
      cache = mesclar(ESTADO_INICIAL, JSON.parse(bruto))
      return cache
    } catch (erro) {
      console.error('estado.json invalido, recriando:', erro.message)
    }
  }
  cache = structuredClone(ESTADO_INICIAL)
  return cache
}

export function salvarEstado(estado) {
  garantirDir(DATA_DIR)
  cache = estado
  const temporario = path.join(DATA_DIR, `estado.${process.pid}.tmp`)
  fs.writeFileSync(temporario, JSON.stringify(estado, null, 2), 'utf8')
  fs.renameSync(temporario, ARQUIVO_ESTADO)
  return estado
}

export function atualizarEstado(mutador) {
  const atual = lerEstado()
  const novo = mutador(structuredClone(atual)) || atual
  return salvarEstado(novo)
}

export function estadoInicial() {
  return structuredClone(ESTADO_INICIAL)
}
