/**
 * Rich rules-and-reference HTML. Rendered into the side panel and the modal.
 * Uses inline card markup styled by the existing .card-face CSS so the
 * example cards look exactly like game cards.
 */

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

export function rulesHtml(): string {
  return `
    <section class="rules-section">
      <h4>The Goal</h4>
      <p>Make the best 5-card hand using your 2 hole cards plus 5 shared community cards. Win chips by having the strongest hand at showdown — or by betting so boldly that everyone else folds before you get there.</p>
    </section>

    <section class="rules-section">
      <h4>A Hand at a Glance</h4>
      <ol class="rules-list">
        <li><b>Pre-flop</b> — Small &amp; big blinds post. Each player gets 2 private cards. Betting starts.</li>
        <li><b>Flop</b> — 3 community cards revealed. Second betting round.</li>
        <li><b>Turn</b> — 4th community card. Third betting round.</li>
        <li><b>River</b> — 5th community card. Final betting round.</li>
        <li><b>Showdown</b> — best 5-card hand wins the pot.</li>
      </ol>
    </section>

    <section class="rules-section">
      <h4>Your Actions</h4>
      <div class="rules-actions">
        <div class="rules-action act-fold">
          <span class="rules-icon">✕</span>
          <div>
            <b>Fold</b>
            <p>Give up your hand. You lose whatever you've already bet.</p>
          </div>
        </div>
        <div class="rules-action act-check">
          <span class="rules-icon">○</span>
          <div>
            <b>Check</b>
            <p>Pass to the next player. Only if nobody has bet this round.</p>
          </div>
        </div>
        <div class="rules-action act-call">
          <span class="rules-icon">→</span>
          <div>
            <b>Call</b>
            <p>Match the current bet. Stay in the hand for equal cost.</p>
          </div>
        </div>
        <div class="rules-action act-raise">
          <span class="rules-icon">▲</span>
          <div>
            <b>Raise</b>
            <p>Increase the bet. Everyone else must call, raise, or fold.</p>
          </div>
        </div>
      </div>
    </section>

    <section class="rules-section">
      <h4>Hand Rankings (strongest → weakest)</h4>
      <div class="rules-rank">
        <div>
          <b>Royal Flush</b>
          <span class="rules-rank-desc">A, K, Q, J, 10 — all same suit</span>
          ${example([['A','s'],['K','s'],['Q','s'],['J','s'],['T','s']])}
        </div>
        <div>
          <b>Straight Flush</b>
          <span class="rules-rank-desc">Five in a row, same suit</span>
          ${example([['9','h'],['8','h'],['7','h'],['6','h'],['5','h']])}
        </div>
        <div>
          <b>Four of a Kind</b>
          <span class="rules-rank-desc">Four cards of the same rank</span>
          ${example([['Q','s'],['Q','h'],['Q','d'],['Q','c'],['2','s']])}
        </div>
        <div>
          <b>Full House</b>
          <span class="rules-rank-desc">Three + a pair</span>
          ${example([['K','s'],['K','h'],['K','d'],['4','s'],['4','h']])}
        </div>
        <div>
          <b>Flush</b>
          <span class="rules-rank-desc">Five same suit, any order</span>
          ${example([['A','d'],['J','d'],['8','d'],['5','d'],['2','d']])}
        </div>
        <div>
          <b>Straight</b>
          <span class="rules-rank-desc">Five in a row, any suits</span>
          ${example([['J','s'],['T','c'],['9','d'],['8','h'],['7','s']])}
        </div>
        <div>
          <b>Three of a Kind</b>
          <span class="rules-rank-desc">Three same rank</span>
          ${example([['8','s'],['8','h'],['8','c'],['A','d'],['3','s']])}
        </div>
        <div>
          <b>Two Pair</b>
          <span class="rules-rank-desc">Two pairs of different ranks</span>
          ${example([['A','s'],['A','h'],['9','d'],['9','c'],['K','s']])}
        </div>
        <div>
          <b>Pair</b>
          <span class="rules-rank-desc">Two same rank</span>
          ${example([['7','s'],['7','d'],['A','h'],['K','c'],['5','s']])}
        </div>
        <div>
          <b>High Card</b>
          <span class="rules-rank-desc">None of the above — highest card wins</span>
          ${example([['A','s'],['Q','d'],['9','h'],['6','c'],['3','s']])}
        </div>
      </div>
    </section>

    <section class="rules-section">
      <h4>Key Concepts</h4>
      <dl class="rules-glossary">
        <dt>Blinds</dt><dd>Forced bets by the two players left of the dealer. Small blind (SB) = ½ big blind. Heads-up: button is SB.</dd>
        <dt>Button</dt><dd>Marked with <b>D</b>. Dealer position. Acts last post-flop — a big advantage.</dd>
        <dt>Pot odds</dt><dd>Ratio of the current bet you must call to the total pot. If pot is $80 and opponent bets $20, you call $20 to win $100 → 20% pot odds. Call if your winning chance &gt; 20%.</dd>
        <dt>Outs</dt><dd>Cards that would complete your hand. A flush draw has 9 outs on the flop.</dd>
        <dt>All-in</dt><dd>Committing every last chip. You can only win as much as you put in (side pots handle the rest).</dd>
        <dt>Position</dt><dd>Acting later = more information = more power. "In position" means you act after your opponent on the current street.</dd>
      </dl>
    </section>

    <section class="rules-section">
      <h4>A Few Starting Tips</h4>
      <ul class="rules-list">
        <li>Play fewer, stronger hands. AA, KK, QQ, AK — these are premium. 72 offsuit is famously the worst.</li>
        <li>Be more aggressive in late position, more cautious early.</li>
        <li>Don't chase draws if pot odds don't justify it. Know your outs.</li>
        <li>A pair of aces wins a lot of small pots but can lose big ones. Don't get married to it on a scary board.</li>
        <li>Bluff sparingly and with a plan — you should have a credible story the board supports.</li>
      </ul>
    </section>
  `;
}
