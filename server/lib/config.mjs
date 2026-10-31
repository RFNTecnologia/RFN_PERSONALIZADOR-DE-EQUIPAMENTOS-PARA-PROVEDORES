import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))

export const RAIZ = path.resolve(aqui, '..', '..')
export const DIR_SERVIDOR = path.resolve(aqui, '..')
export const DATA_DIR = process.env.RFN_DATA_DIR || path.join(RAIZ, 'data')
export const ARQUIVO_ESTADO = path.join(DATA_DIR, 'estado.json')
export const ARQUIVO_TOKEN = path.join(DATA_DIR, 'token.txt')
export const DIR_DIST = path.join(RAIZ, 'dist')

export const PORTA = Number(process.env.PORT || process.env.RFN_PORT || 8080)
export const HOST = process.env.RFN_HOST || '0.0.0.0'

export function garantirDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * Token de administracao do painel. Se nao vier por variavel de ambiente,
 * e gerado uma vez e persistido em data/token.txt.
 */
export function tokenPainel() {
  if (process.env.RFN_TOKEN) return process.env.RFN_TOKEN
  garantirDir(DATA_DIR)
  if (fs.existsSync(ARQUIVO_TOKEN)) {
    const salvo = fs.readFileSync(ARQUIVO_TOKEN, 'utf8').trim()
    if (salvo) return salvo
  }
  const novo = randomBytes(24).toString('hex')
  fs.writeFileSync(ARQUIVO_TOKEN, `${novo}\n`, { mode: 0o600 })
  return novo
}

/** Token usado pelos equipamentos (CPE) nas chamadas de bootstrap/CWMP. */
export function tokenDispositivo() {
  return process.env.RFN_DEVICE_TOKEN || tokenPainel()
}

export function tokenValido(esperado, informado) {
  if (!informado) return false
  const a = Buffer.from(String(esperado))
  const b = Buffer.from(String(informado))
  if (a.length !== b.length) return false
  return a.equals(b)
}

export function log(...partes) {
  const carimbo = new Date().toISOString()
  console.log(`[${carimbo}]`, ...partes)
}
