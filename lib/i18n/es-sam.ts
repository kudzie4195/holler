/**
 * Ronda 33 (SAM): los gemelos en español de en-sam.ts, para las etiquetas de un aviso federal (lib/signals/sam-notice.ts). Mismas
 * claves, mismos {marcadores}. Trato de usted. Una etiqueta dice lo que dice el aviso y nada más.
 */
import type { EN_SAM } from './en-sam';

export const ES_SAM: Record<keyof typeof EN_SAM, string> = {
  'sam.early.sources_sought': 'Aviso anticipado: la agencia está preguntando quién podría hacer este trabajo. Todavía no se piden ofertas.',
  'sam.early.presolicitation': 'Aviso anticipado: la agencia planea pedir ofertas más adelante. Todavía no se piden ofertas.',
  'sam.early.bundle': 'Aviso anticipado: la agencia planea combinar varios pedidos en un solo contrato. Todavía no se piden ofertas.',

  'sam.setaside.sba': 'Reservado para pequeñas empresas',
  'sam.setaside.sbp': 'Reservado en parte para pequeñas empresas',
  'sam.setaside.8a': 'Reservado para pequeñas empresas del programa 8(a)',
  'sam.setaside.8an': 'Contratación directa planeada con una sola empresa del programa 8(a). No está abierto a ofertas',
  'sam.setaside.hzc': 'Reservado para pequeñas empresas HUBZone',
  'sam.setaside.hzs': 'Contratación directa planeada con una sola empresa HUBZone. No está abierto a ofertas',
  'sam.setaside.sdvosbc': 'Reservado para pequeñas empresas de veteranos con discapacidad relacionada con el servicio',
  'sam.setaside.sdvosbs': 'Contratación directa planeada con una sola pequeña empresa de veteranos con discapacidad relacionada con el servicio. No está abierto a ofertas',
  'sam.setaside.wosb': 'Reservado para pequeñas empresas de mujeres',
  'sam.setaside.wosbss': 'Contratación directa planeada con una sola pequeña empresa de mujeres. No está abierto a ofertas',
  'sam.setaside.edwosb': 'Reservado para pequeñas empresas de mujeres en desventaja económica',
  'sam.setaside.edwosbss': 'Contratación directa planeada con una sola pequeña empresa de mujeres en desventaja económica. No está abierto a ofertas',
  'sam.setaside.las': 'Reservado para empresas en un área de desastre o emergencia declarada',
  'sam.setaside.iee': 'Reservado para empresas económicas indígenas (Departamento del Interior)',
  'sam.setaside.isbee': 'Reservado para pequeñas empresas económicas indígenas (Departamento del Interior)',
  'sam.setaside.biciv': 'Reservado para compras a empresas indígenas, Buy Indian (Servicio de Salud Indígena)',
  'sam.setaside.vsa': 'Reservado para pequeñas empresas de veteranos (Departamento de Asuntos de Veteranos)',
  'sam.setaside.vss': 'Contratación directa planeada con una sola pequeña empresa de veteranos (Departamento de Asuntos de Veteranos). No está abierto a ofertas',
  'sam.setaside.other': 'Reservado para ciertas empresas. Vea en el aviso quién puede responder',

  'sam.early.intent_line': 'Este es un aviso anticipado. Todavía no se piden ofertas.',
  'sam.email.honesty_bid_setaside': 'Una licitación publicada no muestra a quién van a elegir. Una reserva limita quién puede responder: lea el aviso para ver las reglas.',
};
