import type { MetodoRestore, StatusCPE, TipoEquipamento } from './types'

export function formatarData(iso: string | null) {
  if (!iso || iso === '—') return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatarRelativo(iso: string | null) {
  if (!iso) return 'nunca'
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return 'nunca'
  const minutos = Math.round((Date.now() - d) / 60000)
  if (minutos < 1) return 'agora'
  if (minutos < 60) return `há ${minutos} min`
  const horas = Math.round(minutos / 60)
  if (horas < 24) return `há ${horas} h`
  return `há ${Math.round(horas / 24)} d`
}

export const rotuloTipo: Record<TipoEquipamento, string> = {
  roteador: 'Roteador',
  ont: 'ONT',
  modem: 'Modem',
  mesh: 'Mesh',
  switch: 'Switch',
}

export const rotuloMetodo: Record<MetodoRestore, string> = {
  'tr069-acs': 'TR-069 / ACS',
  'url-bootstrap': 'URL de bootstrap',
  'token-nuvem': 'Token na nuvem',
}
