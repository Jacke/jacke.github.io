/**
 * Rich rules-and-reference HTML. Rendered into the side panel and the modal.
 * All strings come from the i18n dictionary so `rulesHtml()` always reflects
 * the current language.
 */

import { t } from './i18n.js';

function miniCard(rank: string, suit: 's' | 'h' | 'd' | 'c'): string {
  const symbol = { s: '\u2660', h: '\u2665', d: '\u2666', c: '\u2663' }[suit];
  const color = (suit === 'h' || suit === 'd') ? 'red-suit' : 'black-suit';
  const display = rank === 'T' ? '10' : rank;
  return `
    <div class="card mini-card ${color}">
      <div class="card-face">
        <span class="card-rank-tl">${display}</span>
        <span class="card-suit-tl">${symbol}</span>
        <span class="card-rank-br">${display}</span>
        <span class="card-suit-br">${symbol}</span>
      </div>
    </div>`;
}

function example(cards: Array<[string, 's' | 'h' | 'd' | 'c']>): string {
  return `<div class="rules-example">${cards.map(([r, s]) => miniCard(r, s)).join('')}</div>`;
}

function rankRow(titleKey: string, descKey: string, cards: Array<[string, 's' | 'h' | 'd' | 'c']>): string {
  return `
    <div>
      <b>${t(titleKey)}</b>
      <span class="rules-rank-desc">${t(descKey)}</span>
      ${example(cards)}
    </div>`;
}

export function rulesHtml(): string {
  return `
    <section class="rules-section">
      <h4>${t('rules.goal')}</h4>
      <p>${t('rules.goalText')}</p>
    </section>

    <section class="rules-section">
      <h4>${t('rules.handAtGlance')}</h4>
      <ol class="rules-list">
        <li>${t('rules.step1')}</li>
        <li>${t('rules.step2')}</li>
        <li>${t('rules.step3')}</li>
        <li>${t('rules.step4')}</li>
        <li>${t('rules.step5')}</li>
      </ol>
    </section>

    <section class="rules-section">
      <h4>${t('rules.actions')}</h4>
      <div class="rules-actions">
        <div class="rules-action act-fold">
          <span class="rules-icon">✕</span>
          <div>
            <b>${t('rules.foldTitle')}</b>
            <p>${t('rules.foldDesc')}</p>
          </div>
        </div>
        <div class="rules-action act-check">
          <span class="rules-icon">○</span>
          <div>
            <b>${t('rules.checkTitle')}</b>
            <p>${t('rules.checkDesc')}</p>
          </div>
        </div>
        <div class="rules-action act-call">
          <span class="rules-icon">→</span>
          <div>
            <b>${t('rules.callTitle')}</b>
            <p>${t('rules.callDesc')}</p>
          </div>
        </div>
        <div class="rules-action act-raise">
          <span class="rules-icon">▲</span>
          <div>
            <b>${t('rules.raiseTitle')}</b>
            <p>${t('rules.raiseDesc')}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="rules-section">
      <h4>${t('rules.rankings')}</h4>
      <div class="rules-rank">
        ${rankRow('rules.royalFlush',   'rules.royalFlushDesc',   [['A','s'],['K','s'],['Q','s'],['J','s'],['T','s']])}
        ${rankRow('rules.straightFlush','rules.straightFlushDesc',[['9','h'],['8','h'],['7','h'],['6','h'],['5','h']])}
        ${rankRow('rules.fourKind',     'rules.fourKindDesc',     [['Q','s'],['Q','h'],['Q','d'],['Q','c'],['2','s']])}
        ${rankRow('rules.fullHouse',    'rules.fullHouseDesc',    [['K','s'],['K','h'],['K','d'],['4','s'],['4','h']])}
        ${rankRow('rules.flush',        'rules.flushDesc',        [['A','d'],['J','d'],['8','d'],['5','d'],['2','d']])}
        ${rankRow('rules.straight',     'rules.straightDesc',     [['J','s'],['T','c'],['9','d'],['8','h'],['7','s']])}
        ${rankRow('rules.trips',        'rules.tripsDesc',        [['8','s'],['8','h'],['8','c'],['A','d'],['3','s']])}
        ${rankRow('rules.twoPair',      'rules.twoPairDesc',      [['A','s'],['A','h'],['9','d'],['9','c'],['K','s']])}
        ${rankRow('rules.pair',         'rules.pairDesc',         [['7','s'],['7','d'],['A','h'],['K','c'],['5','s']])}
        ${rankRow('rules.highCard',     'rules.highCardDesc',     [['A','s'],['Q','d'],['9','h'],['6','c'],['3','s']])}
      </div>
    </section>

    <section class="rules-section">
      <h4>${t('rules.keyConcepts')}</h4>
      <dl class="rules-glossary">
        <dt>${t('rules.blinds')}</dt><dd>${t('rules.blindsDesc')}</dd>
        <dt>${t('rules.button')}</dt><dd>${t('rules.buttonDesc')}</dd>
        <dt>${t('rules.potOdds')}</dt><dd>${t('rules.potOddsDesc')}</dd>
        <dt>${t('rules.outs')}</dt><dd>${t('rules.outsDesc')}</dd>
        <dt>${t('rules.allIn')}</dt><dd>${t('rules.allInDesc')}</dd>
        <dt>${t('rules.position')}</dt><dd>${t('rules.positionDesc')}</dd>
      </dl>
    </section>

    <section class="rules-section">
      <h4>${t('rules.tips')}</h4>
      <ul class="rules-list">
        <li>${t('rules.tip1')}</li>
        <li>${t('rules.tip2')}</li>
        <li>${t('rules.tip3')}</li>
        <li>${t('rules.tip4')}</li>
        <li>${t('rules.tip5')}</li>
      </ul>
    </section>
  `;
}
