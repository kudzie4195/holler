/**
 * Round 17, unit ES (redo 1): the corrected Spanish strings from the independent grade (grade-ES.md), pinned, plus the code fixes C1 to C5
 * and the review's P3 items. Each pinned string also keeps its {placeholders} (tests/i18n/dictionary.test.ts) and passes spanishProblems here.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { es } from '@/lib/i18n/es';
import { en } from '@/lib/i18n/en';
import { bannedDraftWordsIn, spanishProblems, ES_BANNED, foldEs } from '@/lib/i18n/rules';
import { violatesDraftRules, fallbackDraft } from '@/lib/ai/fallback';
import { renderNote } from '@/lib/outreach/templates';
import { renderDigest, contactLine } from '@/lib/email/templates';
import { Footer } from '@/components/footer';
import { TopNavEs } from '@/components/es/top-nav';
import { FooterEs } from '@/components/es/footer';
import { tradeLabel } from '@/lib/check/trades';
import { lowerFirst } from '@/lib/i18n';
import { NOW } from '../signals/brief-fixtures';

const CORRECTED: Record<string, string> = {
  "brief.link.home": "Abrir la página principal de la fuente pública",
  "brief.uncertain.mention": "menciona {phrase} (dato no confirmado)",
  "brief.work.tree-service": "poda o remoción de árboles",
  "brief.work.landscaping": "trabajo de jardinería y paisajismo",
  "brief.work.snow-removal": "remoción de nieve y hielo",
  "brief.why.airport.coming_soon": "Hay un retraso en un aeropuerto cercano; puede cambiar la demanda de {work}.",
  "brief.why.311.act_now": "Un reporte al 311 señala algo que hay que reparar; puede hacer falta {work}.",
  "brief.why.inspection.act_now_repair": "Cerca, un local de comida no pasó la inspección; puede requerir {work}.",
  "brief.why.inspection.coming_soon_repair": "Un local de comida cercano no pasó la inspección; puede surgir {work}.",
  "brief.why.inspection.neutral": "Un local de comida cercano no pasó la inspección; vea si lo que falló encaja con lo que usted hace.",
  "brief.why.business.coming_soon": "Se registró un negocio nuevo cerca; puede necesitar {work}.",
  "brief.why.event-permit.coming_soon": "Se solicitó un permiso de evento cerca; el evento puede necesitar {work}.",
  "brief.why.big-event.coming_soon": "Hay un evento grande publicado cerca; puede cambiar la demanda de {work}.",
  "brief.why.federal-bid.act_now": "Hay una licitación federal abierta para {work}; aún no se ha adjudicado.",
  "brief.why.city-bid.act_now": "Hay una licitación de la ciudad abierta para {work}; aún no se ha adjudicado.",
  "brief.override.act_now|storm-report|restoration": "Se presentó un reporte de tormenta cerca; después puede hacer falta restauración.",
  "brief.override.act_now|storm-report|insurance": "Se presentó un reporte de tormenta cerca; después pueden venir reclamos al seguro.",
  "brief.override.act_now|storm-report|public-adjuster": "Se presentó un reporte de tormenta cerca; después pueden venir reclamos al seguro.",
  "brief.route.re-roof|siding-gutters": "Se presentó {permit} cerca; con un techo nuevo suelen cambiarse canaletas y revestimiento.",
  "brief.route.new-build|landscaping": "Se presentó {permit} cerca; los patios nuevos suelen necesitar jardinería.",
  "emptyfeed.settings_link": "Cambiar sus oficios o su zona en la configuración de su cuenta",
  "card.done": "Terminada",
  "card.reply.hint": "Se la enviamos por correo a la persona que preguntó. Esa persona verá el nombre de su negocio, su ciudad y su correo para poder contestarle. Si quiere, puede agregar su teléfono.",
  "who.reach_area": "Contacte a la gente de esta zona",
  "who.locked.org": "Elija un plan para ver a quién nombra este registro y cómo contactarlo.",
  "who.locked.area": "Elija un plan para ver cómo contactar a la gente de esta zona.",
  "who.copy_note": "Copiar un mensaje de presentación",
  "who.copy_door": "Copiar texto para volante de puerta",
  "outreach.role.permit": "Aparece en este permiso",
  "note.org_team": ", equipo de {org}",
  "note.org": ", {org}",
  "note.greeting.owner": "propietario",
  "note.greeting.resident": "residente",
  "note.trade-to-owner": "Estimado {greeting}: Se emitió un permiso de construcción{at}, según una fuente pública. Soy [su nombre], de [su negocio], y trabajo cerca de allí. Si desea una segunda cotización o tiene preguntas sobre el trabajo del permiso, llámeme al [su teléfono]. Si ya tiene a alguien, gracias de todos modos. No volveré a escribirle.",
  "note.bidder-to-buyer": "Hola{org}. Soy [su nombre], de [su negocio]. Estoy revisando la licitación abierta que publicó su oficina y tengo una pregunta sobre el alcance. ¿Siguen abiertas las visitas al sitio o las preguntas por escrito, y cuál es la fecha límite? Seguiré el proceso de su oficina. Puede comunicarse conmigo al [su teléfono]. Gracias.",
  "trade.landscaping": "Jardinería y paisajismo",
  // Round 23 rewrote the launch message in both languages. These four keys carry it; the grader's wording rules still apply (checked below).
  // INT2 (round 24 copy pass): hero.sub and chk.quiet rewritten ("techos rehechos" read translated; "temporadas" for weeks).
  "land.title": "Holler: vea dónde está el trabajo cerca de usted esta semana",
  "hero.h1": "Vea dónde está el trabajo cerca de usted esta semana.",
  "hero.sub": "Permisos de casas nuevas y de techos nuevos cerca de usted, cada uno con la dirección y un enlace a su fuente pública. Holler pone esas direcciones en una lista y en un colgante de puerta para imprimir, para que sepa dónde colgar y repartir volantes esta semana. Pensado para equipos de jardinería, corte de césped, canaletas y lavado a presión.",
  "fam.civic.tag": "311 E INFRACCIONES",
  "fam.civic.title": "Solicitudes a la ciudad e infracciones de código",
  // Round 18 ES: the owner's rule for plan names ("El plan Solo cuesta" can read as "the plan only costs"): "Plan Solo:" with a colon.
  "price.line": "Plan {starter}: {a} al mes o {b} al año. Plan {pro}: {c} al mes o {d} al año.",
  "footer.tag": "Vea dónde está el trabajo cerca de usted esta semana.",
  "chk.preview.civic.t": "Solicitudes al 311 e infracciones de código",
  "chk.h.watching": "Holler busca trabajo de {trade} cerca de {place}",
  "chk.quiet": "Hay semanas tranquilas, y algunas ciudades publican más que otras. Holler revisa cada fuente pública según su propio horario, desde cada 15 minutos hasta cada 12 horas, y le escribe como máximo una vez por hora. Una alerta puede llegar un poco después de lo ocurrido.",
  "srcl.fixed.bids-gwinnett": "Compras del condado de Gwinnett: licitaciones abiertas",
  "draft.trade_fallback": "servicios locales",
};

// Round 19 RULES removed the two failed-inspection overrides ("failures often involve ..." was a guess, review section 6), so their corrections
// are no longer in the dictionary.
// Round 24 INT2 retired a third: chk.uncovered.cta sent Spanish visitors to the English waitlist page; /es/check now has the card itself
// (wl.card.*, checked in tests/int2/waitlist-es.test.ts), so the key is gone and the test below makes sure it stays gone.
describe('grader corrections (grade-ES.md, 50 dictionary keys, 3 retired in rounds 19 and 24)', () => {
  it('the retired English-page waitlist line is not in the dictionary', () => {
    expect('chk.uncovered.cta' in es).toBe(false);
    expect(Object.values(es).join('\n')).not.toContain('en la página en inglés');
  });
  for (const [k, v] of Object.entries(CORRECTED)) {
    it(k, () => {
      expect(es[k as keyof typeof es]).toBe(v);
      expect(spanishProblems(v, { allowDamageWords: false })).toEqual([]);
      const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(holes(es[k as keyof typeof es])).toEqual(holes(en[k as keyof typeof en]));
    });
  }
  it('the words the grader flagged are gone from the dictionary', () => {
    const all = Object.values(es).join('\n');
    for (const bad of ['nada está adjudicado', 'Llegue a esta zona', 'ordenados para su oficio', 'cuando granizo', 'casos de código', 'solicitud abierta', 'trabajo permitido', 'Estimados {greeting}', 'Nombrado en este']) {
      expect(all.includes(bad), bad).toBe(false);
    }
    expect(Object.entries(es).filter(([, v]) => v === 'Lista')).toEqual([]);
  });
});

describe('notes read as a greeting with a comma and one person', () => {
  it('the vocative comma: "Hola, equipo de X." and "Hola, X."', () => {
    const vars = { org: 'Peachtree Builders LLC', address: '123 Main St' };
    expect(renderNote('sub-to-contractor', vars, 'es')).toMatch(/^Hola, (equipo de )?Peachtree Builders LLC\./);
    expect(renderNote('bidder-to-buyer', vars, 'es')).toMatch(/^Hola, Peachtree Builders LLC\./);
    expect(renderNote('trade-to-owner', { address: '123 Main St' }, 'es')).toMatch(/^Estimado propietario: /);
    expect(renderNote('bidder-to-buyer', {}, 'es')).toMatch(/^Hola\. /);
  });
});

describe('C3: a one-item digest has a Spanish subject, not the English title', () => {
  it('"New home permit in Atlanta" becomes "Permiso de vivienda nueva en Atlanta"', () => {
    const mail = renderDigest({
      businessName: 'Jardinería Ramírez',
      items: [{ title: 'New home permit in Atlanta', kind: 'permit', source: 'arcgis-atlanta-permits', place: 'Atlanta, GA', ago: 'hace 4 días', url: null, label: 'coming_soon', trade: 'landscaping' } as never],
      appUrl: 'https://localholler.com/app',
      unsubscribeUrl: 'https://localholler.com/u',
      now: NOW,
      lang: 'es',
    });
    // Round 24 (review P1-3): the title already names the town, so the card is headed by its own (Spanish) title, and so is the subject
    // (round 23 read "Permiso de casa nueva en Atlanta, GA", the city as the heading).
    expect(mail.subject).toBe('Permiso de vivienda nueva en Atlanta');
    expect(mail.text).toContain('Permiso de vivienda nueva en Atlanta');
    expect(mail.text).not.toContain('New home');
  });
  it('an English member keeps the English subject', () => {
    const mail = renderDigest({
      businessName: 'Peachtree Roofing',
      items: [{ title: 'New home permit in Atlanta', kind: 'permit', source: 'arcgis-atlanta-permits', place: 'Atlanta, GA', ago: '4 days ago', url: null, label: 'coming_soon', trade: 'landscaping' } as never],
      appUrl: 'https://localholler.com/app',
      unsubscribeUrl: 'https://localholler.com/u',
      now: NOW,
    });
    // Round 24 (review P1-3, P2-7): never "at" a city ("New home permit at Atlanta, GA" in round 23).
    expect(mail.subject).toBe('New home permit in Atlanta');
    expect(mail.text).toContain('New home permit in Atlanta');
  });
});

describe('C4 and P3-1: the draft checker matches whole words, ignores accents, and does not over-reject', () => {
  it('"revolución" is caught with or without the accent, in any case', () => {
    for (const w of ['revolución', 'Revolucion', 'REVOLUCIÓN', 'revolucionario', 'revolucionamos nuestro servicio']) {
      expect(violatesDraftRules(`Hola, soy de Techos Pinos. Ofrecemos una ${w} en techos.`, 'es'), w).toBe(true);
    }
    expect(foldEs('Revolución')).toBe('revolucion');
    expect(bannedDraftWordsIn('Una revolución en techos')).toContain('revolución');
  });
  it('"empleados" (contains "lead" as letters only) and "si lo necesita" (a polite offer) are not rejected', () => {
    expect(violatesDraftRules('Hola, soy de Techos Pinos. Tenemos empleados con experiencia en techos. Con gusto le ayudo.', 'es')).toBe(false);
    expect(violatesDraftRules('Hola, soy de Techos Pinos. Si lo necesita, con gusto reviso su techo esta semana.', 'es')).toBe(false);
    expect(bannedDraftWordsIn('empleados, leaderazgo, mislead')).toEqual([]);
  });
  it('the real banned words still fail: lead, leads, garantizado, "le necesita", "cliente potencial"', () => {
    for (const text of ['Hola. Tengo un lead para usted.', 'Hola. Estos leads son buenos.', 'Hola. Trabajo garantizado.', 'Hola. Su vecino le necesita ahora.', 'Hola. Es un cliente potencial.', 'Hola. Garantía total.']) {
      expect(violatesDraftRules(text, 'es'), text).toBe(true);
    }
    expect(ES_BANNED.some((r) => r.id === 'they-need-you')).toBe(true);
  });
  it('the fallback draft for no trade is a sentence, not "trabajamos en trabajos locales" (P3-5)', () => {
    const d = fallbackDraft({ businessName: 'P', categories: [], title: 't', lang: 'es' });
    expect(d).toContain('trabajamos en servicios locales');
    expect(d).not.toContain('trabajos locales');
    expect(violatesDraftRules(d, 'es')).toBe(false);
  });
});

describe('C5: acronyms keep their capitals', () => {
  it('lowerFirst keeps "(HVAC)"', () => {
    expect(lowerFirst(tradeLabel('hvac', 'es'))).toBe('calefacción y aire acondicionado (HVAC)');
    expect(lowerFirst('Techos')).toBe('techos');
  });
});

describe('P3-3 and P3-4: links to pages in another language say so', () => {
  // Round 18 ES: pricing, log-in and sign-up now exist in Spanish, so the nav links go to /es/pricing, /es/login and /es/signup with no
  // "(en inglés)"; privacy and terms are still English and keep the label and hreflang en.
  it('the Spanish nav links pricing, log in and sign up to the Spanish pages, with no "(en inglés)"', () => {
    const html = renderToStaticMarkup(createElement(TopNavEs, {}));
    for (const label of ['Precios', 'Iniciar sesión', 'Empezar gratis']) expect(html, label).toContain(`>${label}<`);
    expect(html).not.toContain('(en inglés)');
    for (const href of ['/es/pricing', '/es/login', '/es/signup']) expect(html, href).toContain(`href="${href}"`);
    for (const href of ['/pricing', '/login', '/signup']) expect(html, href).not.toContain(`href="${href}"`);
  });
  it('the Spanish footer marks privacy and terms as English pages; pricing is the Spanish page', () => {
    const html = renderToStaticMarkup(createElement(FooterEs, {}));
    for (const href of ['/privacy', '/terms']) expect(html, href).toMatch(new RegExp(`<a[^>]*href="${href}"[^>]*hrefLang="en"|<a[^>]*hrefLang="en"[^>]*href="${href}"`, 'i'));
    expect(html).toContain('Privacidad (en inglés)');
    expect(html).toContain('Términos (en inglés)');
    expect(html).toContain('href="/es/pricing"');
    expect(html).not.toContain('Precios (en inglés)');
  });
  it('the English footer\'s Español link says lang="es" and hreflang="es"', () => {
    const html = renderToStaticMarkup(createElement(Footer, {}));
    expect(html).toMatch(/<a[^>]*href="\/es"[^>]*>Español<\/a>/);
    const link = /<a[^>]*href="\/es"[^>]*>/.exec(html)![0];
    expect(link).toMatch(/lang="es"/);
    expect(link).toMatch(/hrefLang="es"/i);
    // no other English footer link got a language attribute
    expect((html.match(/ lang="/g) ?? []).length).toBe(1);
  });
});

// ---- Redo 3 (regrade-ES.md): 16 more dictionary keys, exactly as the grader wrote them ----
const REGRADE_CORRECTED: Record<string, string> = {
  "title.area": "el área de {place}",
  "title.nws_other": "Alerta del Servicio Meteorológico: {event} ({area})",
  "title.nws_other_plain": "Alerta del Servicio Meteorológico: {event}",
  "nws.hazard.special-weather": "condiciones meteorológicas especiales",
  "nws.hazard.small-craft": "peligro para embarcaciones pequeñas",
  "sum.fema_head_typed": "FEMA hizo una declaración por {incident} ({code}) para {state}",
  "sum.fema_head": "FEMA hizo una declaración por {incident} para {state}",
  "sum.fema_head_other_typed": "FEMA hizo una declaración ({code}), tipo de incidente: {incident}, para {state}",
  "sum.fema_head_other": "FEMA hizo una declaración, tipo de incidente: {incident}, para {state}",
  "sum.faa.end": "Hora prevista de fin: {when}",
  "naics.retail": "Comercio al por menor",
  "recent.type.weather-alert.one": "alerta del clima",
  "recent.type.weather-alert.many": "alertas del clima",
  "civic.water_fire": "problemas por agua o incendio",
  "brief.why.public-post.act_now": "Alguien publicó que busca ayuda con {work} cerca.",
  "who.copied_hint": "Copiado al portapapeles. Cambie las partes [entre corchetes] antes de enviarlo.",
};

describe('regrade corrections (regrade-ES.md, 16 keys)', () => {
  for (const [k, v] of Object.entries(REGRADE_CORRECTED)) {
    it(k, () => {
      expect(es[k as keyof typeof es]).toBe(v);
      expect(spanishProblems(v)).toEqual([]);
      const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(holes(es[k as keyof typeof es])).toEqual(holes(en[k as keyof typeof en]));
    });
  }
  it('"Aviso" is kept for a real Warning: other NWS products take "Alerta"', async () => {
    const { localizeTitle } = await import('@/lib/signals/title-i18n');
    expect(localizeTitle('Tornado Warning: Cobb, GA', 'es', 'nws')).toMatch(/^Aviso de tornado/);
    expect(localizeTitle('Hazardous Weather Outlook: Cobb, GA', 'es', 'nws')).toBe('Alerta del Servicio Meteorológico: Hazardous Weather Outlook (Cobb, GA)');
    expect(localizeTitle('Special Weather Statement: Cobb, GA', 'es', 'nws')).toBe('Declaración de condiciones meteorológicas especiales: Cobb, GA');
    expect(localizeTitle('Small Craft Advisory: Lake Lanier', 'es', 'nws')).toBe('Advertencia de peligro para embarcaciones pequeñas: Lake Lanier');
  });
  it('"Licitación abierta en el área de Los Angeles" reads right', async () => {
    const { localizeTitle } = await import('@/lib/signals/title-i18n');
    expect(localizeTitle('Open bid in Los Angeles area: REPLACE COOLING TOWERS', 'es', 'bids-la')).toBe('Licitación abierta en el área de Los Angeles: REPLACE COOLING TOWERS');
  });
  it('the "Done" button has its own key; the status badge stays "Terminada"', () => {
    expect(es['card.mark_done']).toBe('Marcar como terminada');
    expect(es['card.done']).toBe('Terminada');
    expect(en['card.mark_done']).toBe(en['card.done']);
  });
  it('the contact role is lower case inside the parentheses in Spanish and unchanged in English', () => {
    expect(contactLine({ name: 'SUMMIT ROOFING & SIDING INC', role: 'Aparece en este permiso' }, 'es')).toBe('Contacto: SUMMIT ROOFING & SIDING INC (aparece en este permiso)');
    expect(contactLine({ name: 'Acme Roofing LLC', role: 'General contractor on this permit' })).toBe('Contact: Acme Roofing LLC (General contractor on this permit)');
    expect(contactLine({ name: 'Acme Roofing LLC', role: 'General contractor on this permit' }, 'en')).toBe('Contact: Acme Roofing LLC (General contractor on this permit)');
  });
});
