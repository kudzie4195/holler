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
import { renderDigest } from '@/lib/email/templates';
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
  "brief.override.act_now|inspection|pest-control": "Un local de comida cercano no pasó la inspección; muchas veces hay problemas de plagas.",
  "brief.override.act_now|inspection|janitorial-commercial": "Un local de comida cercano no pasó la inspección; muchas veces hay fallas de limpieza.",
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
  "land.title": "Holler: entérese cuando algo cerca de usted tenga que ver con su oficio",
  "hero.h1": "Registros públicos cerca de usted, filtrados para su oficio.",
  "hero.sub": "Alertas cuando una granizada, un permiso o una solicitud al 311 cerca de usted encaja con su oficio. Cada alerta enlaza a su fuente pública.",
  "fam.civic.tag": "311 E INFRACCIONES",
  "fam.civic.title": "Solicitudes a la ciudad e infracciones de código",
  "price.line": "El plan \"{starter}\" cuesta {a} al mes o {b} al año. El plan \"{pro}\" cuesta {c} al mes o {d} al año.",
  "footer.tag": "Registros públicos cerca de usted, filtrados para su oficio.",
  "chk.preview.civic.t": "Solicitudes al 311 e infracciones de código",
  "chk.h.watching": "Holler busca trabajo de {trade} cerca de {place}",
  "chk.quiet": "Hay temporadas tranquilas, y algunos lugares publican más que otros. Según la fuente, Holler la revisa desde cada 15 minutos hasta cada 12 horas, y le escribe como máximo una vez por hora. Una alerta puede llegar un poco después de lo ocurrido.",
  "chk.uncovered.cta": "Deje su correo en la página en inglés y le avisaremos cuando Holler cubra su zona.",
  "srcl.fixed.bids-gwinnett": "Compras del condado de Gwinnett: licitaciones abiertas",
  "draft.trade_fallback": "servicios locales",
};

describe('grader corrections (grade-ES.md, 50 dictionary keys)', () => {
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
    expect(mail.subject).toBe('1 novedad cerca de usted: Permiso de vivienda nueva en Atlanta');
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
    expect(mail.subject).toContain('New home permit in Atlanta');
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
  it('the Spanish nav labels pricing, log in and sign up "(en inglés)" and marks them hreflang en', () => {
    const html = renderToStaticMarkup(createElement(TopNavEs, {}));
    for (const label of ['Precios (en inglés)', 'Iniciar sesión (en inglés)', 'Empezar gratis (en inglés)']) expect(html, label).toContain(label);
    for (const href of ['/pricing', '/login', '/signup']) expect(html, href).toMatch(new RegExp(`<a[^>]*href="${href}"[^>]*hrefLang="en"|<a[^>]*hrefLang="en"[^>]*href="${href}"`, 'i'));
  });
  it('the Spanish footer marks pricing, privacy and terms as English pages', () => {
    const html = renderToStaticMarkup(createElement(FooterEs, {}));
    for (const href of ['/pricing', '/privacy', '/terms']) expect(html, href).toMatch(new RegExp(`<a[^>]*href="${href}"[^>]*hrefLang="en"|<a[^>]*hrefLang="en"[^>]*href="${href}"`, 'i'));
    expect(html).toContain('Precios (en inglés)');
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
