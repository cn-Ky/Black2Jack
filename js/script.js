(() => {
  const $ = id => document.getElementById(id);

  const cash = value =>
    value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2
    });

  const state = {
    bank: 1000,
    bet: 50,
    hands: [],
    dealer: [],
    deck: [],
    phase: "ready",
    active: 0,
    split: false,
    reveal: false,
    start: 1000
  };

  const slots = [...document.querySelectorAll(".slot")];
  const denominations = [10, 25, 50, 100];
  const cardNodes = new Map();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  let serial = 0;
  let resultTimer;
  let balanceTimer;
  let wagerTimer;
  let moneyFrame;
  let resizeFrame;
  let displayedBalance = 950;
  let targetBalance = 950;

  const wait = duration =>
    new Promise(resolve =>
      setTimeout(resolve, reducedMotion.matches ? 0 : duration)
    );

  const cardValue = card =>
    card.rank === "A"
      ? 11
      : ["J", "Q", "K"].includes(card.rank)
        ? 10
        : Number(card.rank);

  function total(cards) {
    let value = cards.reduce((sum, card) => sum + cardValue(card), 0);
    let aces = cards.filter(card => card.rank === "A").length;

    while (value > 21 && aces > 0) {
      value -= 10;
      aces--;
    }

    return value;
  }

  const blackjack = cards =>
    cards.length === 2 && total(cards) === 21;

  const betting = () =>
    state.phase === "ready" || state.phase === "settled";

  const currentHand = () => state.hands[state.active];

  function canDouble() {
    const hand = currentHand();

    return Boolean(
      hand &&
      !hand.done &&
      !hand.splitAces &&
      hand.cards.length === 2 &&
      total(hand.cards) < 21 &&
      state.bank >= hand.stake
    );
  }

  function canSplit() {
    const hand = currentHand();

    return Boolean(
      canDouble() &&
      !state.split &&
      hand.cards[0].rank === hand.cards[1].rank
    );
  }

  const sound = (() => {
    const base =
      "https://raw.githubusercontent.com/ETdoFresh/kenney.nl/master/kenney_casinoaudio/Audio/";

    const files = {
      chip: ["chipsStack1.ogg", "chipsStack2.ogg", "chipsCollide1.ogg"],
      card: ["cardPlace1.ogg", "cardPlace2.ogg"]
    };

    const buffers = {};
    const voices = new Set();

    let context;
    let master;
    let enabled = false;
    let busy = false;
    let loaded = false;
    let cardCount = 0;

    function stopVoices() {
      for (const source of voices) {
        try {
          source.stop();
        } catch {}
      }
    }

    async function load() {
      const entries = await Promise.all(
        Object.entries(files).map(async ([type, names]) => {
          const decoded = await Promise.all(
            names.map(async name => {
              const response = await fetch(base + name);

              if (!response.ok) {
                throw new Error("Audio download failed");
              }

              return context.decodeAudioData(await response.arrayBuffer());
            })
          );

          return [type, decoded];
        })
      );

      for (const [type, decoded] of entries) {
        buffers[type] = decoded;
      }

      loaded = true;
    }

    function sample(type, volume, rate, pan, delay = 0) {
      if (
        !enabled ||
        !loaded ||
        !context ||
        context.state !== "running" ||
        document.hidden
      ) {
        return;
      }

      if (voices.size >= 12) {
        const oldest = voices.values().next().value;

        try {
          oldest.stop();
        } catch {}

        voices.delete(oldest);
      }

      const options = buffers[type];
      const source = context.createBufferSource();
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      const panner = context.createStereoPanner();

      source.buffer = options[Math.floor(Math.random() * options.length)];
      source.playbackRate.value = rate;
      gain.gain.value = volume;

      filter.type = "highpass";
      filter.frequency.value = 90;
      panner.pan.value = pan;

      source.connect(filter);
      filter.connect(gain);
      gain.connect(panner);
      panner.connect(master);

      voices.add(source);

      source.onended = () => {
        voices.delete(source);
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
        panner.disconnect();
      };

      source.start(context.currentTime + delay);
    }

    function play(type) {
      if (!enabled) return;

      const rate = .97 + Math.random() * .06;

      if (type === "card") {
        sample("card", .55, rate, (cardCount++ % 2 ? 1 : -1) * .16);
      } else if (type === "chip") {
        sample("chip", 1.3, rate, -.12);
        sample("chip", .28, rate * .92, .15, .045);
      } else if (type === "remove") {
        sample("chip", .85, .93, .12);
      } else {
        sample("chip", .3, .86, 0);
      }
    }

    async function toggle() {
      if (busy) return;

      busy = true;
      $("sound").setAttribute("aria-busy", "true");

      try {
        if (!context) {
          const AudioContext =
            window.AudioContext || window.webkitAudioContext;

          if (!AudioContext) throw new Error("Audio unavailable");

          context = new AudioContext();
          master = context.createGain();

          const compressor = context.createDynamicsCompressor();
          compressor.threshold.value = -12;
          compressor.knee.value = 12;
          compressor.ratio.value = 3;

          master.gain.value = 0;
          master.connect(compressor);
          compressor.connect(context.destination);
        }

        await context.resume();

        if (!loaded) await load();

        enabled = !enabled;

        master.gain.setTargetAtTime(
          enabled ? .8 : 0,
          context.currentTime,
          .015
        );

        $("sound").setAttribute("aria-pressed", String(enabled));
        $("sound").title = enabled ? "Turn sound off" : "Turn sound on";

        if (enabled) {
          play("chip");
        } else {
          stopVoices();
        }
      } catch {
        enabled = false;
        stopVoices();

        if (master && context) {
          master.gain.setValueAtTime(0, context.currentTime);
        }

        $("sound").setAttribute("aria-pressed", "false");
        $("sound").title = "Sound could not load. Click to retry.";
        $("status").textContent =
          "Sound could not load. Click the sound button to retry.";
      } finally {
        busy = false;
        $("sound").removeAttribute("aria-busy");
      }
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopVoices();
    });

    return { play, toggle };
  })();

  $("sound").onclick = sound.toggle;

  function syncMoney() {
    const value = Math.max(
      0,
      state.bank - (betting() ? state.bet : 0)
    );

    $("bank").setAttribute(
      "aria-label",
      cash(value) + " available"
    );

    if (value === targetBalance) return;

    const previous = targetBalance;
    targetBalance = value;

    cancelAnimationFrame(moneyFrame);
    clearTimeout(balanceTimer);

    $("bm").className =
      "meter " + (value > previous ? "up" : "down");

    const from = displayedBalance;
    const started = performance.now();

    function tick(now) {
      const progress = reducedMotion.matches
        ? 1
        : Math.min(1, (now - started) / 320);

      displayedBalance =
        from + (value - from) * (1 - Math.pow(1 - progress, 3));

      $("bank").textContent =
        progress === 1
          ? cash(value)
          : cash(Math.round(displayedBalance));

      if (progress < 1) {
        moneyFrame = requestAnimationFrame(tick);
      }
    }

    moneyFrame = requestAnimationFrame(tick);

    balanceTimer = setTimeout(() => {
      $("bm").className = "meter";
    }, 650);
  }

  function makeDeck() {
    const deck = [];

    for (const suit of ["♠", "♥", "♣", "♦"]) {
      for (const rank of [
        "A", "2", "3", "4", "5", "6", "7",
        "8", "9", "10", "J", "Q", "K"
      ]) {
        deck.push({ rank, suit, id: ++serial });
      }
    }

    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    return deck;
  }

  function dismissResult() {
    clearTimeout(resultTimer);
    $("result").classList.remove("show");
    $("result").replaceChildren();
  }

  function announce(net, natural, push, bust) {
    dismissResult();

    const title =
      natural && net > 0 ? "BLACKJACK" :
      bust ? "BUST" :
      push ? "PUSH" :
      net > 0 ? "YOU WIN" :
      net < 0 ? "DEALER WINS" :
      "ROUND EVEN";

    const detail = state.split
      ? state.hands.map((hand, index) => {
          const outcome =
            hand.outcome === "loss" && total(hand.cards) > 21
              ? "bust"
              : hand.outcome;

          return `Hand ${index + 1}: ${outcome}`;
        }).join(" · ")
      : natural && net > 0
        ? "PAYS 3:2"
        : push
          ? "BET RETURNED"
          : "";

    const returnedBet = push
      ? state.hands.reduce((sum, hand) => sum + hand.stake, 0)
      : 0;

    const amount = Math.abs(net) || returnedBet;
    const sign = net > 0 ? "+" : net < 0 ? "−" : "";

    $("result").dataset.tone =
      net > 0 ? "win" : net < 0 ? "loss" : "push";

    $("result").innerHTML = `
      <div class="result-inner">
        <div class="result-kicker">
          ${state.split ? "SPLIT HANDS" : "HAND COMPLETE"}
        </div>
        <div class="result-title">${title}</div>
        <div class="result-rule"></div>
        <div class="result-amount">${sign}${cash(amount)}</div>
        <div class="result-detail">${detail}</div>
      </div>
    `;

    void $("result").offsetWidth;
    $("result").classList.add("show");

    $("status").textContent =
      title + ". " +
      (net
        ? cash(Math.abs(net)) + (net > 0 ? " won." : " lost.")
        : push ? "Bet returned." : "Round even.");

    resultTimer = setTimeout(dismissResult, 3000);
  }

  function cardBack(id) {
    return `
      <svg viewBox="0 0 100 140" aria-hidden="true">
        <defs>
          <pattern id="p${id}" width="9" height="9" patternUnits="userSpaceOnUse">
            <path d="M0 4.5L4.5 0 9 4.5 4.5 9Z"
              fill="none" stroke="#94b5dc" stroke-width=".65"/>
          </pattern>
          <linearGradient id="b${id}" x2="1" y2="1">
            <stop stop-color="#365c93"/>
            <stop offset="1" stop-color="#18365f"/>
          </linearGradient>
        </defs>
        <rect width="100" height="140" rx="7" fill="#f5efdf"/>
        <rect x="5" y="5" width="90" height="130" rx="4" fill="url(#b${id})"/>
        <rect x="8" y="8" width="84" height="124" rx="2"
          fill="url(#p${id})" stroke="#b8c9df" stroke-width=".6"/>
        <circle cx="50" cy="70" r="25" fill="#234675" stroke="#d1d9e5"/>
        <circle cx="50" cy="70" r="21" fill="none" stroke="#a9bdd6" stroke-width=".6"/>
        <text x="50" y="85" text-anchor="middle" font-size="43" fill="#e5e9ed">♠</text>
      </svg>
    `;
  }

  const pips = {
    A: [[50, 70]],
    2: [[50, 32], [50, 108]],
    3: [[50, 32], [50, 70], [50, 108]],
    4: [[32, 32], [68, 32], [32, 108], [68, 108]],
    5: [[32, 32], [68, 32], [50, 70], [32, 108], [68, 108]],
    6: [[32, 32], [68, 32], [32, 70], [68, 70], [32, 108], [68, 108]],
    7: [[32, 32], [68, 32], [50, 51], [32, 70], [68, 70], [32, 108], [68, 108]],
    8: [[32, 32], [68, 32], [50, 51], [32, 70], [68, 70], [50, 90], [32, 108], [68, 108]],
    9: [[32, 28], [68, 28], [32, 56], [68, 56], [50, 70], [32, 84], [68, 84], [32, 112], [68, 112]],
    10: [[32, 28], [68, 28], [50, 42], [32, 56], [68, 56], [32, 84], [68, 84], [50, 98], [32, 112], [68, 112]]
  };

  function court(card, color) {
    const queen = card.rank === "Q";
    const king = card.rank === "K";
    const gold = "#d4ad49";
    const blue = "#244a7a";
    const red = "#ae303b";
    const ink = "#252729";

    const crown = king
      ? `<path d="M36 34L33 23 41 28 47 20 53 28 62 23 59 34Z" fill="${gold}"/>
         <path d="M36 30H59M37 33H58" fill="none"/>`
      : queen
        ? `<path d="M36 34L35 26 41 29 47 22 53 29 60 26 58 34Z" fill="${gold}"/>
           <circle cx="47" cy="24" r="2" fill="${red}"/>`
        : `<path d="M34 34Q31 22 44 22Q58 20 62 32L57 35Z" fill="${red}"/>
           <path d="M37 26L57 30M36 29L59 33" stroke="${gold}" stroke-width="2"/>`;

    const hair = queen
      ? `<path d="M37 35Q31 46 38 56L42 51 39 43M57 35Q63 47 57 54" fill="${gold}"/>`
      : king
        ? `<path d="M43 45Q48 49 54 45L52 53 46 55 42 50Z" fill="${gold}"/>
           <path d="M46 46L49 47 52 46" fill="none"/>`
        : `<path d="M36 35L39 46 43 49M36 38L39 39M36 41L40 42" fill="none"/>`;

    const ornament = queen
      ? `<path d="M65 55L65 36" stroke="${blue}" stroke-width="1.2"/>
         <path d="M65 35C54 33 63 25 65 30C69 23 76 34 65 35Z" fill="${red}"/>
         <circle cx="65" cy="32" r="1.8" fill="${gold}"/>`
      : king
        ? `<path d="M68 56V24L71 20 73 25 71 56Z" fill="#f6edce"/>
           <path d="M65 50H75" stroke="${gold}" stroke-width="2"/>`
        : `<path d="M68 58V29" stroke="${gold}" stroke-width="2"/>
           <path d="M64 30L68 23 73 30 68 35Z" fill="${blue}"/>`;

    const half = `
      <g stroke="${ink}" stroke-width=".65" stroke-linejoin="round">
        <path d="M24 70V57L36 48H57L76 58V70Z" fill="${blue}"/>
        <path d="M35 49L46 57 60 49 69 70H29Z" fill="${gold}"/>
        <path d="M39 53L45 57 34 70H27ZM55 52L49 58 59 70H69Z" fill="${red}"/>
        <path d="M42 57L49 61 56 70H38Z" fill="#fff9e6"/>
        <path d="M37 34Q33 41 38 49L44 54 54 49 58 36Z" fill="${gold}"/>
        <path d="M40 34H56L55 40 59 43 54 45 53 49 45 51 40 46Z" fill="#fff4d9"/>
        ${hair}
        <path d="M48 38L53 38M50 39L51 39M52 41L51 43 54 43M49 46L52 46" fill="none"/>
        ${crown}
        <path d="M26 59L35 65M25 63L32 69M66 56L73 61M65 60L74 66"
          stroke="${gold}" stroke-width="1.5"/>
        <path d="M36 58L40 61M33 63L37 66M57 57L60 61M60 64L63 68"
          stroke="#fff4d9" stroke-width="1.3"/>
        ${ornament}
        <path d="M64 55Q66 51 69 53L71 58 67 61 63 59Z" fill="#fff4d9"/>
        <text x="27" y="44" font-size="12" stroke="none" fill="${color}">${card.suit}</text>
      </g>
    `;

    return `
      <rect x="23" y="20" width="54" height="100"
        fill="#fff7e2" stroke="${ink}" stroke-width=".8"/>
      ${half}
      <g transform="rotate(180 50 70)">${half}</g>
      <path d="M24 70H76" stroke="${gold}" stroke-width="1"/>
    `;
  }

  function cardFace(card, hidden) {
    if (hidden) return cardBack(card.id);

    const color = ["♥", "♦"].includes(card.suit)
      ? "#b72e3c"
      : "#20272a";

    const corner = `
      <text x="6" y="19" font-family="Helvetica,Arial,sans-serif"
        font-size="17" font-weight="700">${card.rank}</text>
      <text x="7" y="34" font-size="16">${card.suit}</text>
    `;

    const middle = pips[card.rank]
      ? pips[card.rank].map(([x, y]) => `
          <text x="${x}" y="${y}" text-anchor="middle"
            dominant-baseline="central"
            font-size="${card.rank === "A" ? 43 : 24}"
            ${y > 75 ? `transform="rotate(180 ${x} ${y})"` : ""}
          >${card.suit}</text>
        `).join("")
      : court(card, color);

    return `
      <svg viewBox="0 0 100 140" aria-hidden="true">
        <rect x=".5" y=".5" width="99" height="139" rx="7"
          fill="#fffdf3" stroke="#d7d5bd"/>
        <g fill="${color}">
          ${corner}
          <g transform="rotate(180 50 70)">${corner}</g>
          ${middle}
        </g>
      </svg>
    `;
  }

  function paint(element, cards, hideHoleCard = false) {
    if (!cards.length) {
      if (!element.querySelector(".placeholder")) {
        element.innerHTML =
          '<div class="placeholder"></div><div class="placeholder"></div>';
      }
      return;
    }

    const ids = new Set(cards.map(card => String(card.id)));

    [...element.children].forEach(node => {
      if (!ids.has(node.dataset.id)) node.remove();
    });

    cards.forEach((card, index) => {
      let node = cardNodes.get(card.id);

      if (!node) {
        node = document.createElement("div");
        node.className = "card";
        node.dataset.id = card.id;
        node.setAttribute("role", "img");
        cardNodes.set(card.id, node);
      }

      const hidden = hideHoleCard && index === 1;
      const face = hidden ? "back" : "face";

      if (node.dataset.face !== face) {
        node.innerHTML = cardFace(card, hidden);
        node.dataset.face = face;
        node.setAttribute(
          "aria-label",
          hidden ? "Face-down card" : `${card.rank} ${card.suit}`
        );
      }

      if (node.parentNode !== element) {
        element.append(node);
      }
    });

    const width = element.firstElementChild.getBoundingClientRect().width;
    const overlap = Math.max(
      width * .24,
      (cards.length * width - element.clientWidth + 6) /
        Math.max(1, cards.length - 1)
    );

    [...element.children].forEach((node, index) => {
      node.style.marginLeft = index ? -overlap + "px" : "0";
    });
  }

  function render() {
    const canBet = betting();
    const playerTurn = state.phase === "player";

    syncMoney();

    $("machine").classList.toggle("ready", state.phase === "ready");
    $("tray").classList.toggle("playing", !canBet);

    $("bet").textContent = cash(
      canBet
        ? state.bet
        : state.hands.reduce((sum, hand) => sum + hand.stake, 0)
    );

    $("bet-label").textContent = canBet ? "BET" : "IN PLAY";

    $("deal").firstElementChild.textContent =
      canBet && state.bank === 0 ? "RESET" : "DEAL";

    $("deal").disabled =
      !canBet || (state.bank > 0 && !state.bet);

    $("minus").disabled = !canBet || state.bet <= 0;
    $("plus").disabled = !canBet || state.bet >= state.bank;

    slots.forEach((button, index) => {
      button.disabled = canBet
        ? state.bet + denominations[index] > state.bank
        : !playerTurn ||
          (index === 2 && !canDouble()) ||
          (index === 3 && !canSplit());

      const label = canBet
        ? "Add " + cash(denominations[index])
        : ["Hit", "Stand", "Double down", "Split matching cards"][index];

      button.setAttribute("aria-label", label);
      button.title = label;
    });

    if (state.phase === "ready") {
      if (!$("dh").querySelector(".opening")) {
        $("dh").innerHTML = `
          <div class="card opening" role="img" aria-label="Face-down card">
            ${cardBack("open1")}
          </div>
          <div class="card opening" role="img" aria-label="Face-down card">
            ${cardBack("open2")}
          </div>
        `;
      }
    } else {
      paint($("dh"), state.dealer, !state.reveal);
    }

    $("ds").innerHTML = !state.dealer.length
      ? "—"
      : state.reveal
        ? total(state.dealer)
        : `${cardValue(state.dealer[0])}<small>?</small>`;

    $("dealer-state").textContent =
      state.phase === "dealer"
        ? "DRAWING"
        : state.reveal && total(state.dealer) > 21
          ? "BUST"
          : "";

    const count = Math.max(1, state.hands.length);
    const root = $("players");

    while (root.children.length < count) {
      const element = document.createElement("div");
      element.className = "player";
      element.innerHTML = `
        <div class="hand"></div>
        <div class="score">
          <span>YOUR HAND</span>
          <b>—</b>
          <span class="hand-state"></span>
        </div>
      `;
      root.append(element);
    }

    while (root.children.length > count) {
      root.lastElementChild.remove();
    }

    root.classList.toggle("split", state.split);

    [...root.children].forEach((element, index) => {
      const hand = state.hands[index];
      const active = playerTurn && index === state.active;

      element.classList.toggle("active", active);
      element.dataset.outcome = hand?.outcome || "";

      element.querySelector(".score > span").textContent =
        state.split ? "HAND " + (index + 1) : "YOUR HAND";

      element.querySelector(".score b").textContent =
        hand?.cards.length ? total(hand.cards) : "—";

      element.querySelector(".hand-state").textContent =
        hand && total(hand.cards) > 21
          ? "BUST"
          : active
            ? "PLAYING"
            : hand?.done && !canBet
              ? total(hand.cards) === 21 ? "21" : "STAND"
              : "";

      paint(element.querySelector(".hand"), hand?.cards || []);
    });

    if (playerTurn) {
      $("status").textContent =
        (state.split ? `Hand ${state.active + 1}. ` : "") +
        "Choose Hit, Stand, or an available action.";
    }
  }

  async function draw(cards) {
    cards.push(state.deck.pop());
    render();
    sound.play("card");
    await wait(280);
  }

  function settle() {
    state.reveal = true;

    const dealerTotal = total(state.dealer);
    const dealerNatural = blackjack(state.dealer);

    state.hands.forEach(hand => {
      const handTotal = total(hand.cards);
      const natural = blackjack(hand.cards) && !state.split;
      let payout = 0;

      if (handTotal > 21) {
        hand.outcome = "loss";
      } else if (dealerNatural) {
        hand.outcome = natural ? "push" : "loss";
        payout = natural ? hand.stake : 0;
      } else if (natural) {
        hand.outcome = "win";
        payout = hand.stake * 2.5;
      } else if (dealerTotal > 21 || handTotal > dealerTotal) {
        hand.outcome = "win";
        payout = hand.stake * 2;
      } else if (handTotal === dealerTotal) {
        hand.outcome = "push";
        payout = hand.stake;
      } else {
        hand.outcome = "loss";
      }

      hand.done = true;
      state.bank += payout;
    });

    state.phase = "settled";
    state.bet = Math.min(state.bet, state.bank);

    render();

    announce(
      state.bank - state.start,
      !state.split && blackjack(state.hands[0].cards),
      state.hands.every(hand => hand.outcome === "push"),
      state.hands.every(hand => total(hand.cards) > 21)
    );
  }

  async function dealerTurn() {
    state.phase = "dealer";
    state.reveal = true;

    sound.play("card");
    $("status").textContent = "Dealer is playing.";
    render();

    await wait(500);

    if (state.hands.some(hand => total(hand.cards) <= 21)) {
      while (total(state.dealer) < 17) {
        await draw(state.dealer);
        await wait(150);
      }
    }

    settle();
  }

  async function nextHand() {
    const index = state.hands.findIndex(
      (hand, index) => index > state.active && !hand.done
    );

    if (index >= 0) {
      state.active = index;
      state.phase = "player";
      render();
    } else {
      await dealerTurn();
    }
  }

  function reset() {
    dismissResult();

    Object.assign(state, {
      bank: 1000,
      bet: 50,
      hands: [],
      dealer: [],
      deck: [],
      phase: "ready",
      active: 0,
      split: false,
      reveal: false,
      start: 1000
    });

    cardNodes.clear();
    $("dh").replaceChildren();
    $("players").replaceChildren();
    $("status").textContent = "Add chips and deal.";

    render();
  }

  $("deal").onclick = async () => {
    if (!betting()) return;

    dismissResult();

    if (!state.bank) {
      sound.play("tap");
      reset();
      return;
    }

    if (!state.bet || state.bet > state.bank) return;

    sound.play("tap");

    state.phase = "dealing";
    state.start = state.bank;
    state.deck = makeDeck();
    state.dealer = [];
    state.hands = [{
      cards: [],
      stake: state.bet,
      done: false,
      splitAces: false
    }];
    state.active = 0;
    state.split = false;
    state.reveal = false;

    cardNodes.clear();
    $("dh").replaceChildren();
    $("players").replaceChildren();

    state.bank -= state.bet;
    $("status").textContent = "Dealing.";

    render();

    await draw(state.hands[0].cards);
    await draw(state.dealer);
    await draw(state.hands[0].cards);
    await draw(state.dealer);

    if (
      blackjack(state.hands[0].cards) ||
      blackjack(state.dealer)
    ) {
      state.reveal = true;
      sound.play("card");
      render();
      await wait(400);
      settle();
    } else {
      state.phase = "player";
      render();
    }
  };

  async function hit() {
    state.phase = "drawing";
    render();

    const hand = currentHand();
    await draw(hand.cards);

    if (total(hand.cards) >= 21) {
      hand.done = true;
      await nextHand();
    } else {
      state.phase = "player";
      render();
    }
  }

  async function stand() {
    sound.play("tap");
    state.phase = "drawing";
    currentHand().done = true;

    render();
    await nextHand();
  }

  async function doubleDown() {
    if (!canDouble()) return;

    sound.play("chip");
    state.phase = "drawing";

    const hand = currentHand();

    state.bank -= hand.stake;
    hand.stake *= 2;

    render();
    await draw(hand.cards);

    hand.done = true;
    await nextHand();
  }

  async function splitHand() {
    if (!canSplit()) return;

    sound.play("chip");
    state.phase = "drawing";

    const hand = currentHand();
    const splitAces = hand.cards[0].rank === "A";

    state.bank -= hand.stake;
    state.split = true;

    state.hands = hand.cards.map(card => ({
      cards: [card],
      stake: hand.stake,
      done: false,
      splitAces
    }));

    render();

    await draw(state.hands[0].cards);
    await draw(state.hands[1].cards);

    state.hands.forEach(hand => {
      hand.done = splitAces || total(hand.cards) === 21;
    });

    const index = state.hands.findIndex(hand => !hand.done);

    if (index < 0) {
      await dealerTurn();
    } else {
      state.active = index;
      state.phase = "player";
      render();
    }
  }

  function changeBet(delta) {
    if (!betting()) return;

    const next = Math.min(
      state.bank,
      Math.max(0, state.bet + delta)
    );

    if (next === state.bet) return;

    dismissResult();
    state.bet = next;

    sound.play(delta > 0 ? "chip" : "remove");

    clearTimeout(wagerTimer);
    $("wm").classList.remove("changed");
    void $("wm").offsetWidth;
    $("wm").classList.add("changed");

    wagerTimer = setTimeout(() => {
      $("wm").classList.remove("changed");
    }, 350);

    render();
  }

  const actions = [hit, stand, doubleDown, splitHand];

  slots.forEach((button, index) => {
    button.onclick = () => {
      if (betting()) {
        if (state.bet + denominations[index] <= state.bank) {
          changeBet(denominations[index]);
        }
      } else if (state.phase === "player") {
        actions[index]();
      }
    };
  });

  $("minus").onclick = () => changeBet(-10);
  $("plus").onclick = () => changeBet(10);

  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(render);
  });

  render();
})();