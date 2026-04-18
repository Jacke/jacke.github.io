/**
 * Lightweight i18n — English + Russian. Translations are keyed strings
 * looked up at render time. Current language persists via settings.
 *
 * To translate a DOM element at any time, set attribute `data-i18n="key"`
 * and call `applyI18n()`. Placeholders (e.g. {name}) can be passed via
 * `t('key', { name: 'Stan' })`.
 */

export type Lang = 'en' | 'ru';

const DICT: Record<Lang, Record<string, string>> = {
  en: {
    // Header chrome
    'chrome.home': 'New game / main menu',
    'chrome.rules': 'Rules',
    'chrome.equity': 'Win probability',
    'chrome.mode': 'Toggle light / dark',
    'chrome.fullscreen': 'Fullscreen',
    'chrome.settings': 'Settings',
    'chrome.lang': 'Language',

    // Landing
    'landing.title': 'THE HAND',
    'landing.tagline': 'Two-player · Heads-up · Texas Hold\'em · No-limit',
    'landing.dealIn': 'DEAL ME IN',
    'landing.inviteHint': 'Invite a friend. No signup. No server.',
    'landing.solo': '— or play solo —',
    'landing.buyIn': 'BUY-IN',
    'landing.bank': 'Bank',
    'landing.variant': 'VARIANT',
    'landing.opponents': 'How many opponents?',
    'landing.resume': '▶ RESUME SESSION',
    'landing.replay': '▶ REPLAY LAST MATCH',
    'landing.easy': 'EASY',
    'landing.easyDesc': 'loose · rarely bluffs',
    'landing.medium': 'MEDIUM',
    'landing.mediumDesc': 'value · pot odds',
    'landing.hard': 'HARD',
    'landing.hardDesc': 'equity · aggression',
    'landing.headsup': 'heads-up',
    'landing.opps': 'opponents',

    // Waiting room
    'waiting.roomCode': 'Room Code',
    'waiting.copy': 'Copy',
    'waiting.copied': 'Copied!',
    'waiting.sendCode': 'Or send the room code directly',
    'waiting.forOpponent': 'Waiting for opponent',
    'waiting.joining': 'Joining game…',

    // Ready screen
    'ready.title': 'Connected — Ready to Play?',
    'ready.vs': 'vs',
    'ready.ready': 'READY?',
    'ready.waiting': 'WAITING...',
    'ready.game': 'GAME',
    'ready.holeCards': 'Hole cards',
    'ready.blinds': 'Blinds',
    'ready.buyIn': 'Buy-in',
    'ready.players': 'Players',
    'ready.variantHoldem': 'Texas Hold\'em',
    'ready.variantOmaha': 'Omaha',
    'ready.variantShortDeck': 'Short Deck (6+)',
    'ready.variantPineapple': 'Pineapple',
    'ready.variantCrazyPineapple': 'Crazy Pineapple',
    'ready.variantIrish': 'Irish',
    'ready.holeCardsTag': '{n} cards',
    'ready.yourName': 'Your name',

    // Game actions
    'action.fold': 'Fold',
    'action.check': 'Check',
    'action.call': 'Call',
    'action.raise': 'Raise',
    'action.allIn': 'ALL-IN',
    'action.yourTurn': 'Your turn',
    'action.waitingFor': 'Waiting for {name}…',
    'preset.half': '½ POT',
    'preset.twoThird': '⅔ POT',
    'preset.pot': 'POT',
    'preset.oneHalf': '1.5×',

    // Showdown
    'showdown.youWin': 'You win!',
    'showdown.winner': '{name} wins',
    'showdown.splitPot': 'Split pot',
    'showdown.uncontested': 'UNCONTESTED',
    'showdown.title': 'HAND #{n} · SHOWDOWN',
    'showdown.nextHand': 'Next Hand',
    'showdown.newGame': 'New Game',
    'showdown.folded': 'folded',
    'showdown.foldAll': 'Won uncontested — everyone else folded.',
    'showdown.winLabel': 'WIN',

    // Settings
    'settings.title': 'Table Settings',
    'settings.mode': 'Color Mode',
    'settings.modeDark': 'Dark',
    'settings.modeLight': 'Light',
    'settings.chipStyle': 'Chip Style',
    'settings.background': 'Background',
    'settings.cardBack': 'Card Back',
    'settings.table': 'Table',
    'settings.audio': 'Audio & Motion',
    'settings.sound': 'Sound effects',
    'settings.reducedMotion': 'Reduced motion',
    'settings.matchReplay': 'Match Replay',
    'settings.bankSection': 'Bank',
    'settings.clearMatch': 'Clear saved match',
    'settings.resetBank': 'Reset bank to $1000',
    'settings.clearHistory': 'Clear match history',
    'settings.done': 'Done',
    'settings.language': 'Language',

    // Generic
    'btn.close': 'Close',
    'btn.gotIt': 'Got it',
    'btn.cancel': 'Cancel',

    // Rules reference
    'rules.modalTitle': 'Texas Hold\'em · Rules & Reference',
    'rules.asideTitle': 'Rules & Reference',
    'rules.close': 'CLOSE ×',
    'rules.goal': 'The Goal',
    'rules.goalText': 'Make the best 5-card hand using your 2 hole cards plus 5 shared community cards. Win chips by having the strongest hand at showdown — or by betting so boldly that everyone else folds before you get there.',
    'rules.handAtGlance': 'A Hand at a Glance',
    'rules.step1': '<b>Pre-flop</b> — Small &amp; big blinds post. Each player gets 2 private cards. Betting starts.',
    'rules.step2': '<b>Flop</b> — 3 community cards revealed. Second betting round.',
    'rules.step3': '<b>Turn</b> — 4th community card. Third betting round.',
    'rules.step4': '<b>River</b> — 5th community card. Final betting round.',
    'rules.step5': '<b>Showdown</b> — best 5-card hand wins the pot.',
    'rules.actions': 'Your Actions',
    'rules.foldTitle': 'Fold',
    'rules.foldDesc': 'Give up your hand. You lose whatever you\'ve already bet.',
    'rules.checkTitle': 'Check',
    'rules.checkDesc': 'Pass to the next player. Only if nobody has bet this round.',
    'rules.callTitle': 'Call',
    'rules.callDesc': 'Match the current bet. Stay in the hand for equal cost.',
    'rules.raiseTitle': 'Raise',
    'rules.raiseDesc': 'Increase the bet. Everyone else must call, raise, or fold.',
    'rules.rankings': 'Hand Rankings (strongest → weakest)',
    'rules.royalFlush': 'Royal Flush',
    'rules.royalFlushDesc': 'A, K, Q, J, 10 — all same suit',
    'rules.straightFlush': 'Straight Flush',
    'rules.straightFlushDesc': 'Five in a row, same suit',
    'rules.fourKind': 'Four of a Kind',
    'rules.fourKindDesc': 'Four cards of the same rank',
    'rules.fullHouse': 'Full House',
    'rules.fullHouseDesc': 'Three + a pair',
    'rules.flush': 'Flush',
    'rules.flushDesc': 'Five same suit, any order',
    'rules.straight': 'Straight',
    'rules.straightDesc': 'Five in a row, any suits',
    'rules.trips': 'Three of a Kind',
    'rules.tripsDesc': 'Three same rank',
    'rules.twoPair': 'Two Pair',
    'rules.twoPairDesc': 'Two pairs of different ranks',
    'rules.pair': 'Pair',
    'rules.pairDesc': 'Two same rank',
    'rules.highCard': 'High Card',
    'rules.highCardDesc': 'None of the above — highest card wins',
    'rules.keyConcepts': 'Key Concepts',
    'rules.blinds': 'Blinds',
    'rules.blindsDesc': 'Forced bets by the two players left of the dealer. Small blind (SB) = ½ big blind. Heads-up: button is SB.',
    'rules.button': 'Button',
    'rules.buttonDesc': 'Marked with <b>D</b>. Dealer position. Acts last post-flop — a big advantage.',
    'rules.potOdds': 'Pot odds',
    'rules.potOddsDesc': 'Ratio of the current bet you must call to the total pot. If pot is $80 and opponent bets $20, you call $20 to win $100 → 20% pot odds. Call if your winning chance &gt; 20%.',
    'rules.outs': 'Outs',
    'rules.outsDesc': 'Cards that would complete your hand. A flush draw has 9 outs on the flop.',
    'rules.allIn': 'All-in',
    'rules.allInDesc': 'Committing every last chip. You can only win as much as you put in (side pots handle the rest).',
    'rules.position': 'Position',
    'rules.positionDesc': 'Acting later = more information = more power. "In position" means you act after your opponent on the current street.',
    'rules.tips': 'A Few Starting Tips',
    'rules.tip1': 'Play fewer, stronger hands. AA, KK, QQ, AK — these are premium. 72 offsuit is famously the worst.',
    'rules.tip2': 'Be more aggressive in late position, more cautious early.',
    'rules.tip3': 'Don\'t chase draws if pot odds don\'t justify it. Know your outs.',
    'rules.tip4': 'A pair of aces wins a lot of small pots but can lose big ones. Don\'t get married to it on a scary board.',
    'rules.tip5': 'Bluff sparingly and with a plan — you should have a credible story the board supports.',
  },
  ru: {
    // Header chrome
    'chrome.home': 'Новая игра / главное меню',
    'chrome.rules': 'Правила',
    'chrome.equity': 'Вероятность победы',
    'chrome.mode': 'Светлая / тёмная тема',
    'chrome.fullscreen': 'Полный экран',
    'chrome.settings': 'Настройки',
    'chrome.lang': 'Язык',

    // Landing
    'landing.title': 'THE HAND',
    'landing.tagline': 'На двоих · Хэдз-ап · Техасский холдем · Без лимита',
    'landing.dealIn': 'РАЗДАТЬ КАРТЫ',
    'landing.inviteHint': 'Пригласи друга. Без регистрации. Без сервера.',
    'landing.solo': '— или играй один —',
    'landing.buyIn': 'БАЙ-ИН',
    'landing.bank': 'Банк',
    'landing.variant': 'ВАРИАНТ',
    'landing.opponents': 'Сколько соперников?',
    'landing.resume': '▶ ПРОДОЛЖИТЬ СЕССИЮ',
    'landing.replay': '▶ ПОВТОР ПОСЛЕДНЕГО МАТЧА',
    'landing.easy': 'ЛЁГКИЙ',
    'landing.easyDesc': 'пассивный · не блефует',
    'landing.medium': 'СРЕДНИЙ',
    'landing.mediumDesc': 'пот-оддсы · велью',
    'landing.hard': 'СЛОЖНЫЙ',
    'landing.hardDesc': 'эквити · агрессия',
    'landing.headsup': 'хэдз-ап',
    'landing.opps': 'соперников',

    // Waiting room
    'waiting.roomCode': 'Код комнаты',
    'waiting.copy': 'Копировать',
    'waiting.copied': 'Скопировано!',
    'waiting.sendCode': 'Или отправь код напрямую',
    'waiting.forOpponent': 'Ждём соперника',
    'waiting.joining': 'Подключение…',

    // Ready screen
    'ready.title': 'Соединено — готов играть?',
    'ready.vs': 'vs',
    'ready.ready': 'ГОТОВ?',
    'ready.waiting': 'ОЖИДАНИЕ...',
    'ready.game': 'ИГРА',
    'ready.holeCards': 'Карманные карты',
    'ready.blinds': 'Блайнды',
    'ready.buyIn': 'Бай-ин',
    'ready.players': 'Игроки',
    'ready.variantHoldem': 'Техасский холдем',
    'ready.variantOmaha': 'Омаха',
    'ready.variantShortDeck': 'Шорт-дек (6+)',
    'ready.variantPineapple': 'Пайнэппл',
    'ready.variantCrazyPineapple': 'Крейзи Пайнэппл',
    'ready.variantIrish': 'Айриш',
    'ready.holeCardsTag': '{n} карт',
    'ready.yourName': 'Твоё имя',

    // Game actions
    'action.fold': 'Пас',
    'action.check': 'Чек',
    'action.call': 'Колл',
    'action.raise': 'Рейз',
    'action.allIn': 'ОЛ-ИН',
    'action.yourTurn': 'Твой ход',
    'action.waitingFor': 'Ждём {name}…',
    'preset.half': '½ БАНК',
    'preset.twoThird': '⅔ БАНК',
    'preset.pot': 'БАНК',
    'preset.oneHalf': '1.5×',

    // Showdown
    'showdown.youWin': 'Ты выиграл!',
    'showdown.winner': '{name} выигрывает',
    'showdown.splitPot': 'Дележ банка',
    'showdown.uncontested': 'БЕЗ ШОУДАУНА',
    'showdown.title': 'РУКА #{n} · ВСКРЫТИЕ',
    'showdown.nextHand': 'Следующая рука',
    'showdown.newGame': 'Новая игра',
    'showdown.folded': 'фолд',
    'showdown.foldAll': 'Выиграл без вскрытия — остальные скинули.',
    'showdown.winLabel': 'WIN',

    // Settings
    'settings.title': 'Настройки стола',
    'settings.mode': 'Цветовая тема',
    'settings.modeDark': 'Тёмная',
    'settings.modeLight': 'Светлая',
    'settings.chipStyle': 'Дизайн фишек',
    'settings.background': 'Фон',
    'settings.cardBack': 'Рубашка карт',
    'settings.table': 'Стол',
    'settings.audio': 'Звук и анимация',
    'settings.sound': 'Звуковые эффекты',
    'settings.reducedMotion': 'Меньше анимаций',
    'settings.matchReplay': 'Повтор матча',
    'settings.bankSection': 'Банк',
    'settings.clearMatch': 'Очистить последний матч',
    'settings.resetBank': 'Сбросить банк до $1000',
    'settings.clearHistory': 'Очистить историю матчей',
    'settings.done': 'Готово',
    'settings.language': 'Язык',

    // Generic
    'btn.close': 'Закрыть',
    'btn.gotIt': 'Понятно',
    'btn.cancel': 'Отмена',

    // Rules reference
    'rules.modalTitle': 'Техасский холдем · Правила и справка',
    'rules.asideTitle': 'Правила и справка',
    'rules.close': 'ЗАКРЫТЬ ×',
    'rules.goal': 'Цель',
    'rules.goalText': 'Собери лучшую пятикарточную комбинацию из двух своих карманных карт и пяти общих карт на столе. Выиграй банк либо имея сильнейшую руку на вскрытии, либо заставив всех остальных сбросить.',
    'rules.handAtGlance': 'Как проходит раздача',
    'rules.step1': '<b>Префлоп</b> — Малый и большой блайнды поставлены. Каждому по 2 карманные карты. Начинается торговля.',
    'rules.step2': '<b>Флоп</b> — Открываются 3 общие карты. Второй круг торговли.',
    'rules.step3': '<b>Тёрн</b> — 4-я общая карта. Третий круг торговли.',
    'rules.step4': '<b>Ривер</b> — 5-я общая карта. Финальный круг торговли.',
    'rules.step5': '<b>Вскрытие</b> — лучшая 5-карточная рука забирает банк.',
    'rules.actions': 'Твои действия',
    'rules.foldTitle': 'Пас (Fold)',
    'rules.foldDesc': 'Сбросить карты. Всё, что уже поставил, теряешь.',
    'rules.checkTitle': 'Чек (Check)',
    'rules.checkDesc': 'Пропустить ход. Только если никто в этом круге ещё не ставил.',
    'rules.callTitle': 'Колл (Call)',
    'rules.callDesc': 'Уравнять текущую ставку и остаться в раздаче.',
    'rules.raiseTitle': 'Рейз (Raise)',
    'rules.raiseDesc': 'Повысить ставку. Остальные должны колл, рейз или фолд.',
    'rules.rankings': 'Силы рук (от сильнейшей к слабейшей)',
    'rules.royalFlush': 'Роял-флеш',
    'rules.royalFlushDesc': 'Т, К, Д, В, 10 — все одной масти',
    'rules.straightFlush': 'Стрит-флеш',
    'rules.straightFlushDesc': 'Пять подряд одной масти',
    'rules.fourKind': 'Каре',
    'rules.fourKindDesc': 'Четыре карты одного достоинства',
    'rules.fullHouse': 'Фулл-хаус',
    'rules.fullHouseDesc': 'Тройка + пара',
    'rules.flush': 'Флеш',
    'rules.flushDesc': 'Пять карт одной масти, в любом порядке',
    'rules.straight': 'Стрит',
    'rules.straightDesc': 'Пять подряд, любых мастей',
    'rules.trips': 'Тройка',
    'rules.tripsDesc': 'Три карты одного достоинства',
    'rules.twoPair': 'Две пары',
    'rules.twoPairDesc': 'Две пары разных достоинств',
    'rules.pair': 'Пара',
    'rules.pairDesc': 'Две карты одного достоинства',
    'rules.highCard': 'Старшая карта',
    'rules.highCardDesc': 'Ничего из вышеперечисленного — решает старшая карта',
    'rules.keyConcepts': 'Ключевые понятия',
    'rules.blinds': 'Блайнды',
    'rules.blindsDesc': 'Обязательные ставки двух игроков слева от дилера. Малый блайнд (SB) = ½ большого. В хэдз-апе баттон ставит SB.',
    'rules.button': 'Баттон',
    'rules.buttonDesc': 'Метка <b>D</b>. Позиция дилера. Ходит последним на постфлопе — большое преимущество.',
    'rules.potOdds': 'Пот-оддсы',
    'rules.potOddsDesc': 'Соотношение суммы колла к итоговому банку. Банк $80, соперник ставит $20 — ты коллируешь $20, чтобы выиграть $100 → 20% pot odds. Колл, если вероятность победы > 20%.',
    'rules.outs': 'Ауты',
    'rules.outsDesc': 'Карты, которые достраивают твою руку. Флеш-дро на флопе имеет 9 аутов.',
    'rules.allIn': 'Олл-ин',
    'rules.allInDesc': 'Ставка всем стеком. Можешь выиграть только в пределах того, что положил в банк (side pots справедливо разделят остальное).',
    'rules.position': 'Позиция',
    'rules.positionDesc': 'Ход позже = больше информации = больше силы. «В позиции» значит ты ходишь после соперника на этой улице.',
    'rules.tips': 'Стартовые советы',
    'rules.tip1': 'Играй меньше рук, но сильнее. AA, KK, QQ, AK — премиум. 72 оффсьют — знаменитая худшая рука.',
    'rules.tip2': 'Агрессивнее в поздней позиции, осторожнее в ранней.',
    'rules.tip3': 'Не гонись за дро, если пот-оддсы не оправдывают. Знай свои ауты.',
    'rules.tip4': 'Пара тузов выигрывает кучу мелких банков, но проигрывает крупные. Не женись на ней на страшной доске.',
    'rules.tip5': 'Блефуй редко и по плану — у тебя должна быть правдоподобная история, которую доска подтверждает.',
  },
};

let currentLang: Lang = 'en';

/** Set the active language and mark it on <html> for possible CSS hooks. */
export function setLang(lang: Lang): void {
  currentLang = lang;
  document.documentElement.lang = lang;
  document.body.dataset['lang'] = lang;
  applyI18n();
}

export function getLang(): Lang {
  return currentLang;
}

/** Translate a key, interpolating `{name}`-style placeholders. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = DICT[currentLang] ?? DICT.en;
  const raw = dict[key] ?? DICT.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** Apply translations to any element with [data-i18n="key"]. */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    const key = el.dataset['i18n'];
    if (!key) return;
    // If the element has children (SVG, icons, etc), replace only the text node.
    const text = t(key);
    if (el.children.length === 0) {
      el.textContent = text;
    } else {
      // Find first text node child and replace.
      let replaced = false;
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          node.textContent = text;
          replaced = true;
          break;
        }
      }
      if (!replaced) el.appendChild(document.createTextNode(text));
    }
  });
  // [data-i18n-title] → set title attribute
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
    const key = el.dataset['i18nTitle'];
    if (key) el.title = t(key);
  });
  // [data-i18n-placeholder]
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset['i18nPlaceholder'];
    if (key) el.placeholder = t(key);
  });
}
