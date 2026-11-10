/* «Искра: проект Ракета» — пиксельный платформер с головоломками для Яндекс.Игр.
   Всё рисуется кодом: ни одного внешнего файла с картинками. */
(() => {
  'use strict';

  // ---------- виртуальный экран ----------
  // Базовая портретная сетка 240×427. На широких экранах видимая область
  // расширяется по горизонтали (до 960 юнитов), чтобы на десктопе игра
  // занимала ландшафтный экран, а не узкую колонку по центру.
  const VH = 427;
  let VW = 240;
  const T = 12; // тайл в пикселях

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.width = VW;
  canvas.height = VH;
  ctx.imageSmoothingEnabled = false;

  function desiredVW() {
    const w = Math.round(VH * (window.innerWidth / Math.max(1, window.innerHeight)));
    return Math.max(240, Math.min(w, 960));
  }

  const buttons = {
    left: { x: 10, y: VH - 46, w: 46, h: 36 },
    right: { x: 62, y: VH - 46, w: 46, h: 36 },
    jump: { x: VW - 62, y: VH - 46, w: 52, h: 36 },
  };
  function layoutButtons() {
    buttons.left.y = VH - 46;
    buttons.right.y = VH - 46;
    buttons.jump.y = VH - 46;
    buttons.jump.x = VW - 62;
  }

  let resizedHook = null;

  function fit() {
    const next = desiredVW();
    if (next !== VW) {
      VW = next;
      canvas.width = VW;
      ctx.imageSmoothingEnabled = false;
      layoutButtons();
      if (resizedHook) resizedHook();
    }
    const s = Math.min(window.innerWidth / VW, window.innerHeight / VH);
    canvas.style.width = Math.floor(VW * s) + 'px';
    canvas.style.height = Math.floor(VH * s) + 'px';
  }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  fit();

  // ---------- палитра ----------
  const C = {
    void: '#05070c',
    wall: '#111a29',
    wall2: '#16202f',
    wall3: '#1d2a3d',
    metal: '#2b3c58',
    metalHi: '#48618a',
    metalLo: '#1a2740',
    accent: '#7fc8ff',
    accentDk: '#3b83c9',
    warm: '#ffd166',
    warmDk: '#b98a1f',
    danger: '#ff6b6b',
    dangerDk: '#7d2f3a',
    green: '#7ce0a3',
    greenDk: '#2f8f5d',
    white: '#e8eef7',
    grey: '#6d829e',
    skin: '#c8d6e8',
    rust: '#b06b3a',
  };

  // ---------- сохранение ----------
  const SAVE_KEY = 'iskra_save_v2';
  const freshSave = () => ({
    step: 0,
    maxStep: 0,
    bolts: 0,
    best: 0,
    muted: false,
    flags: {},
    started: false,
    skin: { shape: 'standard', color: 'blue' },
    bought: { shapes: ['standard'], colors: ['blue'] },
    usedCodes: [],
    patron: false,
  });
  let save = freshSave();

  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) save = Object.assign(freshSave(), JSON.parse(raw));
  } catch (e) {
    /* ignore */
  }

  function persist() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch (e) {
      /* ignore */
    }
    Yandex.save(save);
  }

  // ---------- Яндекс SDK ----------
  const Yandex = {
    sdk: null,
    player: null,
    async init() {
      if (!window.YaGames) return;
      try {
        this.sdk = await window.YaGames.init();
        if (this.sdk.features && this.sdk.features.LoadingAPI) this.sdk.features.LoadingAPI.ready();
        try {
          this.player = await this.sdk.getPlayer({ scopes: false });
          const data = await this.player.getData();
          if (data && typeof data === 'object' && data.step !== undefined) {
            save = Object.assign(freshSave(), data);
            persist();
          }
        } catch (e) {
          /* гость */
        }
      } catch (e) {
        console.warn('SDK init failed', e);
      }
    },
    async save(data) {
      if (!this.player) return;
      try {
        await this.player.setData(data, false);
      } catch (e) {
        /* ignore */
      }
    },
    fullscreen() {
      if (this.sdk && this.sdk.adv) this.sdk.adv.showFullscreenAdv({ callbacks: { onClose: () => {} } });
    },
    rewarded(cb) {
      if (this.sdk && this.sdk.adv) {
        let got = false;
        this.sdk.adv.showRewardedVideo({
          callbacks: {
            onRewarded: () => {
              got = true;
            },
            onClose: () => cb(got),
            onError: () => cb(false),
          },
        });
      } else {
        setTimeout(() => cb(true), 350);
      }
    },
  };

  // ---------- звук ----------
  let ac = null;
  function audio() {
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        return null;
      }
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function beep(freq, dur, type, vol, to) {
    if (save.muted) return;
    const a = audio();
    if (!a) return;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, a.currentTime);
    if (to) o.frequency.exponentialRampToValueAtTime(to, a.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.05, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + dur + 0.02);
  }
  const sfx = {
    jump: () => beep(320, 0.1, 'square', 0.05, 520),
    double: () => beep(520, 0.12, 'square', 0.05, 760),
    coin: () => beep(880, 0.08, 'square', 0.045, 1180),
    part: () => beep(660, 0.16, 'triangle', 0.06, 990),
    hurt: () => beep(200, 0.3, 'sawtooth', 0.07, 70),
    ui: () => beep(440, 0.06, 'square', 0.04),
    ok: () => beep(660, 0.12, 'triangle', 0.06, 990),
    win: () => beep(523, 0.5, 'triangle', 0.06, 1046),
  };

  // ---------- утилиты ----------
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const aabb = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // ---------- история и шаги ----------
  const STEPS = [
    {
      kind: 'story',
      tag: 'Завязка',
      title: 'Подвал лаборатории',
      text:
        'Лаборатория закрылась три года назад. В подвале остался робот №7 — Искра. Пока наверху шли дожди, он разбирал списанные механизмы и собирал из них ракету. Осталось немного: три детали, схема питания — и старт.',
    },
    { kind: 'level', id: 0 },
    {
      kind: 'story',
      tag: 'Глава 1',
      title: 'Схема питания',
      text:
        'Детали на месте, но пульт не включается: энергия идёт не туда. Искра вскрыл щиток. Внутри — трубы и поворотные муфты. Нужно собрать дорожку от реактора к пульту.',
    },
    { kind: 'puzzle', id: 0 },
    {
      kind: 'story',
      tag: 'Глава 2',
      title: 'Пульт ожил',
      text:
        'Пульт загорелся. Искра получил второй импульс двигателей и теперь может прыгнуть дважды — это пригодится выше, в вентиляционных шахтах, где скользко и жарко.',
    },
    { kind: 'level', id: 1 },
    {
      kind: 'story',
      tag: 'Глава 3',
      title: 'Порядок чипов',
      text:
        'Осталось вставить чипы питания в стойку. На стене нацарапано правило: «Нечётные — по возрастанию, чётные — по убыванию». Четыре чипа и один запасной лежат в лотке.',
    },
    { kind: 'puzzle', id: 1 },
    {
      kind: 'story',
      tag: 'Глава 4',
      title: 'Шахта',
      text:
        'Стойка загудела, шахта открылась. Дальше — вертикальный подъём к стартовому столу. Платформы старые, между ними — пропасти. Искра, не спеши.',
    },
    { kind: 'level', id: 2 },
    { kind: 'finale' },
    {
      kind: 'story',
      tag: 'Финал',
      title: 'Космос',
      text:
        'Ракета вышла на орбиту. Внизу осталась лаборатория, подвал и три года тишины. Искра смотрит в иллюминатор и записывает в журнал: «Проект „Ракета“ — выполнен». Продолжение следует.',
    },
      {
      kind: 'story',
      tag: 'Эпизод 2',
      title: 'Станция «Маяк»',
      text:
        'Топлива хватило ровно на стыковку. За иллюминатором — станция «Маяк»: десять лет без экипажа, погасшие лампы и тишина. Искра понимает: без питания домой не вернуться. Значит, надо войти внутрь — и запустить реактор.',
    },
    { kind: 'level', id: 3 },
    {
      kind: 'story',
      tag: 'Глава 5',
      title: 'Невесомость',
      text:
        'В жилом отсеке отключили гравитацию. Искра отталкивается от пола и потолка: в невесомости прыжок получается выше, но падение мягче и дольше. Впереди — лазерные затворы, их лучше проходить, когда луч гаснет.',
      },
    { kind: 'puzzle', id: 2 },
    {
      kind: 'story',
      tag: 'Глава 6',
      title: 'Стыковочный коридор',
      text:
        'Схема собрана, но реактор подаёт питание импульсами. Коридор до реакторного зала узкий, с паром и лучами. Где-то здесь Искра впервые слышит чужой сигнал: кто-то стучит по обшивке.',
    },
    { kind: 'level', id: 4 },
    {
      kind: 'story',
      tag: 'Глава 7',
      title: 'Второй робот',
      text:
        'За переборкой — ещё один робот. Корпус помят, питание на нуле, но ядро живое. Он не говорит, только моргает индикатором. Искра находит в себе место для ещё одной строки в журнале: «не бросить».',
    },
    { kind: 'puzzle', id: 3 },
    {
      kind: 'story',
      tag: 'Глава 8',
      title: 'Реакторный зал',
      text:
        'До реактора остаётся последний отсек — самый высокий и самый тёмный. Гравитация здесь почти выключена, а лазеры включены. В журнале станции сохранилась строка: «первое число вдвое меньше второго, третье — единица, сумма всех трёх — семь». Искра идёт наверх.',
    },
    { kind: 'level', id: 5 },
    { kind: 'puzzle', id: 4 },
    {
      kind: 'story',
      tag: 'Глава 9',
      title: 'Выбор',
      text:
        'Пульта два: один запускает ракету на Землю, второй — буксир для второго робота. Топлива хватит только на одно. Искра держит руку над переключателем.',
    },
    { kind: 'choice' },
    { kind: 'finale2' },
    { kind: 'story', tag: 'Финал', title: 'Домой', text: '__ENDING__' },
  ];



  // ---------- уровни ----------
  function levelOne() {
    const solids = [];
    const ground = (x, w, y) => solids.push({ x, y: y || 340, w, h: VH - (y || 340) + 40 });
    const plat = (x, y, w) => solids.push({ x, y, w, h: 6 });
    ground(0, 300);
    ground(360, 240);
    ground(660, 200);
    ground(900, 300);
    ground(1260, 400);
    plat(120, 292, 54);
    plat(320, 268, 48);
    plat(430, 236, 60);
    plat(700, 260, 56);
    plat(790, 292, 44);
    plat(960, 270, 60);
    plat(1080, 220, 52);
    plat(1180, 290, 44);
    return {
      width: 1660,
      height: VH,
      solids,
      spawn: { x: 24, y: 300 },
      parts: [
        { x: 140, y: 270 },
        { x: 456, y: 214 },
        { x: 1092, y: 198 },
      ],
      bolts: [
        { x: 200, y: 316 },
        { x: 356, y: 214 },
        { x: 600, y: 312 },
        { x: 724, y: 238 },
        { x: 992, y: 248 },
        { x: 1160, y: 300 },
        { x: 1300, y: 316 },
      ],
      spikes: [],
      goal: { x: 1540, y: 316, w: 34, h: 40 },
      checkpoints: [{ x: 900, y: 316 }],
      needParts: 3,
    };
  }

  function levelTwo() {
    const solids = [];
    const ground = (x, w, y) => solids.push({ x, y: y || 340, w, h: VH - (y || 340) + 40 });
    const plat = (x, y, w) => solids.push({ x, y, w, h: 6 });
    ground(0, 200);
    ground(260, 150);
    ground(470, 120);
    ground(650, 180);
    ground(900, 160);
    ground(1120, 200);
    ground(1390, 300);
    plat(90, 286, 44);
    plat(300, 250, 48);
    plat(390, 210, 44);
    plat(520, 262, 52);
    plat(700, 226, 48);
    plat(790, 186, 44);
    plat(950, 236, 56);
    plat(1060, 200, 44);
    plat(1200, 250, 56);
    plat(1310, 210, 44);
    return {
      width: 1700,
      height: VH,
      solids,
      spawn: { x: 18, y: 300 },
      parts: [
        { x: 406, y: 186 },
        { x: 806, y: 162 },
        { x: 1326, y: 186 },
      ],
      bolts: [
        { x: 120, y: 258 },
        { x: 316, y: 222 },
        { x: 560, y: 306 },
        { x: 720, y: 198 },
        { x: 980, y: 208 },
        { x: 1090, y: 172 },
        { x: 1240, y: 312 },
        { x: 1450, y: 300 },
      ],
      spikes: [
        { x: 120, y: 340, w: 40 },
        { x: 340, y: 340, w: 40 },
        { x: 720, y: 340, w: 44 },
        { x: 1500, y: 340, w: 44 },
      ],
      steam: [
        { x: 620, y: 300, w: 24, period: 2.4, phase: 0 },
        { x: 1010, y: 300, w: 24, period: 2.0, phase: 0.9 },
        { x: 1440, y: 300, w: 24, period: 2.6, phase: 1.7 },
      ],
      goal: { x: 1600, y: 316, w: 34, h: 40 },
      checkpoints: [
        { x: 665, y: 316 },
        { x: 1135, y: 316 },
      ],
      needParts: 3,
    };
  }

  function levelThree() {
    const solids = [];
    const plat = (x, y, w) => solids.push({ x, y, w, h: 6 });
    solids.push({ x: 0, y: 340, w: 250, h: 200 });
    plat(280, 310, 60);
    plat(370, 270, 56);
    plat(300, 226, 44);
    plat(410, 186, 50);
    plat(330, 144, 46);
    plat(440, 108, 60);
    plat(560, 150, 50);
    plat(660, 120, 56);
    plat(760, 90, 50);
    plat(860, 60, 44);
    plat(960, 96, 60);
    plat(1060, 70, 70);
    return {
      width: 1180,
      height: 427,
      solids,
      spawn: { x: 20, y: 300 },
      parts: [
        { x: 348, y: 206 },
        { x: 470, y: 84 },
        { x: 1010, y: 46 },
      ],
      bolts: [
        { x: 300, y: 290 },
        { x: 430, y: 246 },
        { x: 590, y: 126 },
        { x: 700, y: 96 },
        { x: 800, y: 66 },
        { x: 900, y: 40 },
        { x: 1120, y: 60 },
      ],
      spikes: [],
      steam: [{ x: 660, y: 108, w: 18, period: 1.8, phase: 0.4 }],
      goal: { x: 1080, y: 30, w: 34, h: 40 },
      checkpoints: [
        { x: 300, y: 296 },
        { x: 760, y: 78 },
      ],
      needParts: 0,
    };
  }


  function stationGround(solids, x, w, y) {
    solids.push({ x, y: y || 340, w, h: 420 - (y || 340) });
  }
  function stationPlat(solids, x, y, w) {
    solids.push({ x, y, w, h: 6 });
  }

  function levelFour() {
    const solids = [];
    stationGround(solids, 0, 240);
    stationGround(solids, 320, 220);
    stationGround(solids, 620, 200);
    stationGround(solids, 900, 240);
    stationGround(solids, 1220, 220);
    stationGround(solids, 1520, 260);
    stationGround(solids, 1860, 320);
    stationPlat(solids, 120, 286, 52);
    stationPlat(solids, 300, 250, 46);
    stationPlat(solids, 400, 210, 48);
    stationPlat(solids, 520, 250, 52);
    stationPlat(solids, 660, 214, 50);
    stationPlat(solids, 780, 176, 46);
    stationPlat(solids, 960, 230, 56);
    stationPlat(solids, 1100, 190, 48);
    stationPlat(solids, 1280, 236, 52);
    stationPlat(solids, 1420, 196, 46);
    stationPlat(solids, 1600, 244, 54);
    stationPlat(solids, 1740, 200, 48);
    return {
      theme: 'station',
      width: 2200,
      height: 427,
      solids,
      spawn: { x: 20, y: 300 },
      parts: [
        { x: 424, y: 186 },
        { x: 804, y: 152 },
        { x: 1124, y: 166 },
        { x: 1766, y: 176 },
      ],
      bolts: [
        { x: 140, y: 262 }, { x: 340, y: 226 }, { x: 540, y: 226 },
        { x: 680, y: 190 }, { x: 990, y: 206 }, { x: 1300, y: 212 },
        { x: 1440, y: 172 }, { x: 1620, y: 220 }, { x: 1900, y: 312 },
      ],
      spikes: [{ x: 700, y: 340, w: 40 }],
      steam: [{ x: 1060, y: 300, w: 20, period: 2.2, phase: 0.3 }],
      lasers: [
        { x: 560, y: 120, h: 190, period: 2.6, phase: 0 },
        { x: 1180, y: 130, h: 200, period: 2.2, phase: 1.1 },
        { x: 1700, y: 120, h: 210, period: 2.8, phase: 0.6 },
      ],
      gravityZones: [{ x0: 780, x1: 1260, mult: 0.55 }],
      goal: { x: 2080, y: 316, w: 34, h: 40 },
      checkpoints: [{ x: 630, y: 316 }, { x: 1540, y: 316 }],
      needParts: 4,
    };
  }

  function levelFive() {
    const solids = [];
    stationGround(solids, 0, 200);
    stationGround(solids, 280, 160);
    stationGround(solids, 500, 180);
    stationGround(solids, 760, 160);
    stationGround(solids, 1000, 200);
    stationGround(solids, 1280, 180);
    stationGround(solids, 1540, 200);
    stationGround(solids, 1820, 180);
    stationGround(solids, 2080, 300);
    stationPlat(solids, 100, 282, 44);
    stationPlat(solids, 240, 240, 44);
    stationPlat(solids, 340, 200, 44);
    stationPlat(solids, 440, 160, 46);
    stationPlat(solids, 560, 206, 44);
    stationPlat(solids, 660, 166, 46);
    stationPlat(solids, 800, 214, 44);
    stationPlat(solids, 900, 174, 44);
    stationPlat(solids, 1040, 210, 48);
    stationPlat(solids, 1160, 170, 44);
    stationPlat(solids, 1320, 210, 46);
    stationPlat(solids, 1440, 168, 46);
    stationPlat(solids, 1580, 212, 48);
    stationPlat(solids, 1700, 170, 44);
    stationPlat(solids, 1860, 212, 46);
    stationPlat(solids, 1980, 170, 46);
    return {
      theme: 'station',
      width: 2400,
      height: 427,
      solids,
      spawn: { x: 18, y: 300 },
      parts: [
        { x: 464, y: 136 },
        { x: 684, y: 142 },
        { x: 924, y: 150 },
        { x: 1464, y: 144 },
        { x: 2004, y: 146 },
      ],
      bolts: [
        { x: 120, y: 258 }, { x: 260, y: 216 }, { x: 360, y: 176 },
        { x: 580, y: 182 }, { x: 820, y: 190 }, { x: 1060, y: 186 },
        { x: 1180, y: 146 }, { x: 1340, y: 186 }, { x: 1600, y: 188 },
        { x: 1720, y: 146 }, { x: 1880, y: 188 }, { x: 2120, y: 312 },
      ],
      spikes: [
        { x: 120, y: 340, w: 36 },
        { x: 820, y: 340, w: 36 },
        { x: 1600, y: 340, w: 36 },
      ],
      steam: [
        { x: 330, y: 300, w: 20, period: 2.0, phase: 0.2 },
        { x: 1180, y: 300, w: 20, period: 2.4, phase: 1.4 },
      ],
      lasers: [
        { x: 420, y: 110, h: 210, period: 2.4, phase: 0.2 },
        { x: 1000, y: 120, h: 200, period: 2.0, phase: 1.0 },
        { x: 1500, y: 110, h: 220, period: 2.6, phase: 0.5 },
        { x: 1960, y: 120, h: 210, period: 2.2, phase: 1.7 },
      ],
      gravityZones: [
        { x0: 380, x1: 900, mult: 0.5 },
        { x0: 1280, x1: 1800, mult: 0.5 },
      ],
      goal: { x: 2280, y: 316, w: 34, h: 40 },
      checkpoints: [{ x: 515, y: 316 }, { x: 1300, y: 316 }, { x: 2100, y: 316 }],
      needParts: 5,
    };
  }

  function levelSix() {
    const solids = [];
    stationGround(solids, 0, 180);
    stationGround(solids, 300, 140);
    stationGround(solids, 540, 160);
    stationGround(solids, 780, 140);
    stationGround(solids, 1000, 160);
    stationGround(solids, 1240, 140);
    stationGround(solids, 1460, 160);
    stationGround(solids, 1700, 140);
    stationGround(solids, 1920, 180);
    stationGround(solids, 2180, 340);
    stationPlat(solids, 80, 276, 40);
    stationPlat(solids, 200, 232, 40);
    stationPlat(solids, 300, 190, 40);
    stationPlat(solids, 400, 150, 40);
    stationPlat(solids, 500, 112, 42);
    stationPlat(solids, 620, 150, 40);
    stationPlat(solids, 720, 190, 40);
    stationPlat(solids, 820, 150, 40);
    stationPlat(solids, 920, 110, 42);
    stationPlat(solids, 1040, 150, 40);
    stationPlat(solids, 1140, 190, 40);
    stationPlat(solids, 1260, 150, 40);
    stationPlat(solids, 1360, 110, 42);
    stationPlat(solids, 1480, 150, 40);
    stationPlat(solids, 1580, 190, 40);
    stationPlat(solids, 1700, 150, 40);
    stationPlat(solids, 1800, 110, 42);
    stationPlat(solids, 1920, 150, 40);
    stationPlat(solids, 2040, 190, 40);
    return {
      theme: 'station',
      width: 2560,
      height: 427,
      solids,
      spawn: { x: 16, y: 300 },
      parts: [
        { x: 520, y: 88 },
        { x: 940, y: 86 },
        { x: 1380, y: 86 },
        { x: 1820, y: 86 },
        { x: 2080, y: 166 },
        { x: 2270, y: 300 },
      ],
      bolts: [
        { x: 100, y: 252 }, { x: 220, y: 208 }, { x: 320, y: 166 },
        { x: 420, y: 126 }, { x: 640, y: 126 }, { x: 740, y: 166 },
        { x: 840, y: 126 }, { x: 1060, y: 126 }, { x: 1160, y: 166 },
        { x: 1280, y: 126 }, { x: 1500, y: 126 }, { x: 1600, y: 166 },
        { x: 1720, y: 126 }, { x: 1940, y: 126 }, { x: 2240, y: 300 },
      ],
      spikes: [
        { x: 200, y: 340, w: 36 },
        { x: 900, y: 340, w: 36 },
        { x: 1560, y: 340, w: 40 },
      ],
      steam: [
        { x: 520, y: 300, w: 20, period: 2.2, phase: 0.5 },
        { x: 1300, y: 300, w: 20, period: 1.8, phase: 1.2 },
        { x: 1980, y: 300, w: 20, period: 2.6, phase: 0.8 },
      ],
      lasers: [
        { x: 360, y: 100, h: 220, period: 2.2, phase: 0 },
        { x: 760, y: 100, h: 210, period: 2.6, phase: 0.9 },
        { x: 1160, y: 100, h: 230, period: 2.0, phase: 0.4 },
        { x: 1560, y: 100, h: 210, period: 2.4, phase: 1.3 },
        { x: 1960, y: 100, h: 220, period: 2.8, phase: 0.7 },
      ],
      gravityZones: [
        { x0: 240, x1: 1000, mult: 0.45 },
        { x0: 1200, x1: 1900, mult: 0.42 },
      ],
      goal: { x: 2440, y: 316, w: 34, h: 40 },
      checkpoints: [{ x: 520, y: 316 }, { x: 1040, y: 316 }, { x: 1720, y: 316 }, { x: 2200, y: 316 }],
      needParts: 6,
    };
  }

  const LEVELS = [levelOne, levelTwo, levelThree, levelFour, levelFive, levelSix];

  // ---------- состояние ----------
  const input = { left: false, right: false, jump: false, jumpPressed: false };
  const touch = { left: false, right: false };
  const game = {
    mode: 'menu',
    step: 0,
    level: null,
    camX: 0,
    camY: 0,
    time: 0,
    flash: 0,
    shake: 0,
    particles: [],
    rings: [],
    msg: null,
    msgTimer: 0,
    levelDone: false,
    deathFromX: 0,
    respawn: null,
    paused: false,
    puzzle: null,
    finale: null,
  };

  const player = {
    invuln: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    w: 18,
    h: 30,
    onGround: false,
    face: 1,
    coyote: 0,
    buffer: 0,
    jumps: 0,
    maxJumps: 1,
    anim: 0,
    jumpTimer: 1,
    spawnX: 0,
    spawnY: 0,
  };

  const SHOW_TOUCH = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window) || /[?&]touch=1/.test(location.search);
  const keys = {};
  resizedHook = () => {
    if (!game.level) return;
    game.camX = Math.max(0, Math.min(player.x - VW * 0.42, Math.max(0, game.level.width - VW)));
    game.camY = Math.max(0, Math.min(player.y - VH * 0.55, Math.max(0, game.level.height - VH)));
  };
  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Space', 'ArrowUp', 'KeyA', 'KeyD'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      if (game.mode === 'play') {
        input.jumpPressed = true;
        input.jump = true;
      }
    }
    if (e.code === 'Escape' && game.mode === 'play') togglePause();
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'Space' || e.code === 'ArrowUp') input.jump = false;
  });

  function readKeys() {
    input.left = !!(keys.ArrowLeft || keys.KeyA) || touch.left;
    input.right = !!(keys.ArrowRight || keys.KeyD) || touch.right;
  }

  // ---------- касания ----------
  // кнопки объявлены выше вместе с виртуальным экраном (layoutButtons)

  function toLocal(ev) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / r.width) * VW,
      y: ((ev.clientY - r.top) / r.height) * VH,
    };
  }
  function hit(p, b) {
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  }

  const activePointers = new Map();

  canvas.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    const p = toLocal(ev);
    audio();

    if (game.mode === 'play') {
      activePointers.set(ev.pointerId, p);
      if (hit(p, buttons.left)) touch.left = true;
      else if (hit(p, buttons.right)) touch.right = true;
      else if (hit(p, buttons.jump)) {
        input.jumpPressed = true;
        input.jump = true;
      }
      return;
    }
    if (game.mode === 'puzzle') puzzleTap(p);
    if (game.mode === 'finale') finaleTap();
    if (game.mode === 'finale2' && game.finale2) game.finale2.t = 9.5;
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (game.mode !== 'play') return;
    if (!activePointers.has(ev.pointerId)) return;
    const p = toLocal(ev);
    activePointers.set(ev.pointerId, p);
    touch.left = false;
    touch.right = false;
    for (const q of activePointers.values()) {
      if (hit(q, buttons.left)) touch.left = true;
      else if (hit(q, buttons.right)) touch.right = true;
    }
  });

  function releasePointer(ev) {
    activePointers.delete(ev.pointerId);
    if (game.mode === 'play') {
      touch.left = false;
      touch.right = false;
      input.jump = false;
      for (const q of activePointers.values()) {
        if (hit(q, buttons.left)) touch.left = true;
        else if (hit(q, buttons.right)) touch.right = true;
      }
    }
  }
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('pointerleave', releasePointer);

  // ---------- уровень ----------
  function sanitizeCheckpoints(L) {
    if (!L.checkpoints) return;
    L.checkpoints = L.checkpoints
      .map((cp) => {
        const near = L.solids
          .filter((s) => cp.x >= s.x - 50 && cp.x <= s.x + s.w + 50 && s.y < 380)
          .sort((a, b) => b.y - a.y)[0];
        if (!near) return null;
        const x = Math.min(Math.max(cp.x, near.x + 6), near.x + near.w - 26);
        return { x, y: near.y };
      })
      .filter(Boolean);
  }

  function safeRespawnPoint(r) {
    const L = game.level;
    if (!L) return r;
    const under = L.solids
      .filter((s) => r.x >= s.x - 6 && r.x <= s.x + s.w + 6 && s.y >= r.y - 40 && s.y < 400)
      .sort((a, b) => a.y - b.y)[0];
    if (under) return { x: r.x, y: under.y };
    const nearest = L.solids
      .filter((s) => s.y < 400)
      .sort((a, b) => Math.abs(a.x + a.w / 2 - r.x) - Math.abs(b.x + b.w / 2 - r.x))[0];
    if (!nearest) return r;
    return { x: Math.min(Math.max(r.x, nearest.x + 6), nearest.x + nearest.w - 26), y: nearest.y };
  }

  function resetTouch() {
    touch.left = false;
    touch.right = false;
    input.jump = false;
    activePointers.clear();
  }

  function loadLevel(idx) {
    const L = LEVELS[idx]();
    sanitizeCheckpoints(L);
    game.level = L;
    game.levelDone = false;
    game.particles = [];
    game.rings = [];
    game.camX = 0;
    game.camY = 0;
    player.x = L.spawn.x;
    player.y = L.spawn.y;
    player.spawnX = L.spawn.x;
    player.spawnY = L.spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.jumps = 0;
    player.invuln = 1.2;
    player.maxJumps = save.flags.doubleJump ? 2 : 1;
    game.level.partsGot = 0;
    game.level.boltsGot = 0;
    game.level.taken = new Set();
    game.mode = 'play';
    game.respawn = { x: L.spawn.x, y: L.spawn.y };
    ui.menu.classList.add('hidden');
    ui.story.classList.add('hidden');
    ui.dead.classList.add('hidden');
    ui.pauseMenu.classList.add('hidden');
    ui.hud.classList.remove('hidden');
    ui.pause.classList.remove('hidden');
    updateHud();
  }

  function resetLevel() {
    const L = game.level;
    player.x = L.spawn.x;
    player.y = L.spawn.y;
    player.spawnX = L.spawn.x;
    player.spawnY = L.spawn.y;
    player.vx = 0;
    player.vy = 0;
    game.level.taken = new Set();
    game.level.partsGot = 0;
    game.level.boltsGot = 0;
    game.camX = 0;
    game.mode = 'play';
    game.deathShown = false;
    updateHud();
  }

  // ---------- физика ----------
  function solidRects() {
    return game.level.solids;
  }

  function movePlayer(dt) {
    if (!game.level) return;
    const accel = 620;
    const maxSpeed = 112;
    const friction = 900;
    const gravity = 760;
    const jumpV = 380;

    readKeys();
    let dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) {
      player.vx += dir * accel * dt;
      player.face = dir;
    } else if (player.onGround) {
      const f = friction * dt;
      player.vx = Math.abs(player.vx) <= f ? 0 : player.vx - Math.sign(player.vx) * f;
    }
    player.vx = clamp(player.vx, -maxSpeed, maxSpeed);

    // койот-тайм и буфер прыжка
    player.coyote = player.onGround ? 0.1 : Math.max(0, player.coyote - dt);
    player.buffer = input.jumpPressed ? 0.12 : Math.max(0, player.buffer - dt);
    input.jumpPressed = false;

    if (player.buffer > 0 && (player.onGround || player.coyote > 0 || player.jumps < player.maxJumps)) {
      const doubleJump = !player.onGround && player.jumps > 0;
      player.vy = doubleJump ? -jumpV * 0.88 : -jumpV;
      player.onGround = false;
      player.coyote = 0;
      player.buffer = 0;
      player.jumps = doubleJump ? player.maxJumps : 1;
      player.jumpTimer = 0;
      if (doubleJump) {
        sfx.double();
        burst(player.x + 3, player.y + player.h, 6, C.accent, 55);
      } else {
        sfx.jump();
        burst(player.x + 3, player.y + player.h, 4, C.metalHi, 35);
      }
    }

    const zones = game.level.gravityZones || [];
    let gMult = 1;
    for (const z of zones) if (player.x >= z.x0 && player.x <= z.x1) gMult = z.mult;
    player.vy = Math.min(player.vy + gravity * gMult * dt, 600 * gMult);

    // X
    player.x += player.vx * dt;
    for (const s of solidRects()) {
      const box = { x: player.x, y: player.y, w: player.w, h: player.h };
      if (aabb(box, s)) {
        if (player.vx > 0) player.x = s.x - player.w;
        else if (player.vx < 0) player.x = s.x + s.w;
        player.vx = 0;
      }
    }
    player.x = clamp(player.x, 0, game.level.width - player.w);

    // Y
    player.y += player.vy * dt;
    player.onGround = false;
    for (const s of solidRects()) {
      const box = { x: player.x, y: player.y, w: player.w, h: player.h };
      if (aabb(box, s)) {
        if (player.vy > 0) {
          player.y = s.y - player.h;
          player.vy = 0;
          player.onGround = true;
          player.jumps = 0;
        } else if (player.vy < 0) {
          player.y = s.y + s.h;
          player.vy = 0;
        }
      }
    }

    player.anim += Math.abs(player.vx) * dt * 0.16;

    // камера
    const targetX = clamp(player.x - VW * 0.42, 0, game.level.width - VW);
    game.camX += (targetX - game.camX) * Math.min(1, dt * 7);
    const targetY = clamp(player.y - VH * 0.55, 0, Math.max(0, game.level.height - VH));
    game.camY += (targetY - game.camY) * Math.min(1, dt * 6);

    if (player.y > game.level.height + 60) hurt('fall');
    if (game.level.goal && !game.levelDone) {
      const g = game.level.goal;
      if (aabb({ x: player.x, y: player.y, w: player.w, h: player.h }, { x: g.x, y: g.y, w: g.w, h: g.h })) {
        completeLevel();
      }
    }
  }

  function burst(x, y, n, color, spread) {
    for (let i = 0; i < n; i++) {
      game.particles.push({
        x,
        y,
        vx: rnd(-spread, spread),
        vy: rnd(-spread, 10),
        life: rnd(0.2, 0.5),
        color,
        size: 1,
      });
    }
  }

  // ---------- предметы и опасности ----------
  function interact(dt) {
    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);
    const L = game.level;
    const box = { x: player.x, y: player.y, w: player.w, h: player.h };

    L.parts.forEach((p, i) => {
      if (L.taken.has('p' + i)) return;
      if (aabb(box, { x: p.x, y: p.y, w: 9, h: 9 })) {
        L.taken.add('p' + i);
        L.partsGot += 1;
        save.bolts += 3;
        sfx.part();
        burst(p.x + 4, p.y + 4, 10, C.warm, 60);
        updateHud();
      }
    });

    L.bolts.forEach((b, i) => {
      if (L.taken.has('b' + i)) return;
      if (aabb(box, { x: b.x, y: b.y, w: 7, h: 7 })) {
        L.taken.add('b' + i);
        L.boltsGot += 1;
        save.bolts += 1;
        sfx.coin();
        burst(b.x + 3, b.y + 3, 5, C.accent, 45);
        updateHud();
      }
    });

    const safe = player.invuln > 0;
    for (const s of L.spikes || []) {
      if (!safe && aabb(box, { x: s.x + 5, y: s.y - 6, w: s.w - 10, h: 6 })) return hurt('spike');
    }
    for (const lz of L.lasers || []) {
      const t = (game.time + lz.phase) % lz.period;
      const effH = Math.max(0, Math.min(lz.h, 268 - lz.y));
      const on = t < 1.1;
      if (!safe && on && effH > 0 && aabb(box, { x: lz.x + 1, y: lz.y, w: 5, h: effH })) return hurt('laser');
    }
    for (const st of L.steam || []) {
      const t = (game.time + st.phase) % st.period;
      if (t < 0.75) {
        if (!safe && aabb(box, { x: st.x + 3, y: st.y - 48, w: st.w - 6, h: 30 })) return hurt('steam');
      }
    }

    for (const cp of L.checkpoints || []) {
      if (aabb(box, { x: cp.x, y: cp.y - 30, w: 12, h: 40 })) {
        if (!game.respawn || game.respawn.x !== cp.x) {
          game.respawn = { x: cp.x, y: cp.y };
          sfx.ok();
          burst(cp.x + 6, cp.y - 6, 8, C.green, 40);
        }
      }
    }
  }

  // ---------- смерть ----------
  let deathShown = false;
  let lastHurtReason = 'неизвестно';
  function hurt(reason) {
    if (deathShown || game.mode !== 'play') return;
    deathShown = true;
    lastHurtReason = reason || 'неизвестно';
    game.mode = 'dead';
    game.shake = 0.5;
    game.lastDeath = {
      reason: lastHurtReason,
      x: Math.round(player.x),
      feet: Math.round(player.y + player.h),
      vy: Math.round(player.vy),
      step: save.step,
      onGround: player.onGround,
    };
    sfx.hurt();
    burst(player.x + 3, player.y + 6, 16, C.danger, 90);
    const causes = {
      spike: 'Шипы пробили корпус.',
      steam: 'Пар обжёг обшивку.',
      laser: 'Луч пересёк корпус.',
      fall: 'Искра сорвался в шахту.',
    };
    ui.deadText.textContent =
      (causes[lastHurtReason] || 'Корпус повреждён.') +
      ' Ядро цело — можно вернуться к последней контрольной точке.';
    ui.continueBtn.classList.toggle('hidden', !!game.continueUsed);
    ui.dead.classList.remove('hidden');
    ui.hud.classList.add('hidden');
    ui.pause.classList.add('hidden');
    if (navigator.vibrate) navigator.vibrate(60);
  }

  // ---------- конец уровня ----------
  function completeLevel() {
    game.levelDone = true;
    game.mode = 'story-wait';
    sfx.win();
    burst(game.level.goal.x + 16, game.level.goal.y + 10, 24, C.warm, 110);
    save.bolts += 10;
    save.best = Math.max(save.best, game.level.partsGot);
    persist();
    setTimeout(() => {
      ui.hud.classList.add('hidden');
      ui.pause.classList.add('hidden');
      Yandex.fullscreen();
      advanceStep();
    }, 900);
  }


  function skinOwned(kind, id) {
    const list = kind === 'shape' ? save.bought.shapes : save.bought.colors;
    return list.includes(id);
  }


  const LEVEL_LIST = [
    { step: 1, name: 'Подвал лаборатории', tag: 'Эпизод 1' },
    { step: 5, name: 'Вентиляционные шахты', tag: 'Эпизод 1' },
    { step: 9, name: 'Шахта к старту', tag: 'Эпизод 1' },
    { step: 13, name: 'Станция «Маяк»', tag: 'Эпизод 2' },
    { step: 17, name: 'Стыковочный коридор', tag: 'Эпизод 2' },
    { step: 21, name: 'Реакторный зал', tag: 'Эпизод 2' },
  ];

  function renderLevels() {
    const box = document.getElementById('levels-list');
    if (!box) return;
    box.innerHTML = '';
    const reached = Math.max(save.maxStep || 0, save.step || 0);
    for (const item of LEVEL_LIST) {
      const unlocked = item.step <= reached;
      const row = document.createElement('button');
      row.className = 'level-item' + (unlocked ? '' : ' locked');
      const num = LEVEL_LIST.indexOf(item) + 1;
      row.innerHTML =
        '<span class="num">' + num + '</span>' +
        '<span class="info"><span class="nm">' + item.name + '</span><span class="tg">' + item.tag + '</span></span>' +
        '<span class="st">' + (unlocked ? 'играть' : '🔒') + '</span>';
      row.onclick = () => {
        sfx.ui();
        if (!unlocked) {
          row.classList.add('nope');
          setTimeout(() => row.classList.remove('nope'), 400);
          return;
        }
        document.getElementById('levels').classList.add('hidden');
        runStep(item.step);
      };
      box.appendChild(row);
    }
  }

  function renderSkins() {
    const shapesEl = document.getElementById('skin-shapes');
    const colorsEl = document.getElementById('skin-colors');
    if (!shapesEl || !colorsEl) return;
    shapesEl.innerHTML = '';
    colorsEl.innerHTML = '';

    const mkRow = (kind, id, name, price, swatch) => {
      const owned = skinOwned(kind, id);
      const equipped = kind === 'shape' ? save.skin.shape === id : save.skin.color === id;
      const row = document.createElement('button');
      row.className = 'skin-item' + (equipped ? ' on' : '');
      row.innerHTML = '<span class="sw" style="background:' + swatch + '"></span><span class="nm">' + name + '</span>' +
        '<span class="pr">' + (equipped ? 'надето' : owned ? 'надеть' : price + ' болтов') + '</span>';
      row.onclick = () => {
        sfx.ui();
        if (owned) {
          if (kind === 'shape') save.skin.shape = id;
          else save.skin.color = id;
          persist();
          renderSkins();
          return;
        }
        if (save.bolts < price) {
          row.classList.add('nope');
          setTimeout(() => row.classList.remove('nope'), 500);
          return;
        }
        save.bolts -= price;
        if (kind === 'shape') {
          save.bought.shapes.push(id);
          save.skin.shape = id;
        } else {
          save.bought.colors.push(id);
          save.skin.color = id;
        }
        persist();
        renderSkins();
        updateHud();
        sfx.coin();
      };
      return row;
    };

    for (const id of Object.keys(SKINS)) {
      const s = SKINS[id];
      shapesEl.appendChild(mkRow('shape', id, s.name, s.price, '#bfd4ec'));
    }
    for (const id of Object.keys(COLORS)) {
      const c = COLORS[id];
      colorsEl.appendChild(mkRow('color', id, c.name, c.price, c.B));
    }
  }

  // ---------- шаги ----------
  function currentStep() {
    return STEPS[save.step] || null;
  }

  function startFromSave() {
    if (!save.started) {
      save.started = true;
      save.step = 0;
      persist();
    }
    runStep(save.step);
  }

  function hideAllOverlays() {
    hidePuzzleUI();
    hideFinaleUI();
    showPuzzleBack(false);
    ui.menu.classList.add('hidden');
    ui.story.classList.add('hidden');
    ui.dead.classList.add('hidden');
    ui.pauseMenu.classList.add('hidden');
    ui.hud.classList.add('hidden');
    ui.pause.classList.add('hidden');
  }

  function runStep(index) {
    hideAllOverlays();
    save.step = index;
    save.maxStep = Math.max(save.maxStep || 0, index);
    persist();
    const step = STEPS[index];
    if (!step) {
      game.mode = 'menu';
      showMenu();
      return;
    }
    if (step.kind === 'story') showStory(step);
    else if (step.kind === 'level') loadLevel(step.id);
    else if (step.kind === 'puzzle') startPuzzle(step.id);
    else if (step.kind === 'finale') startFinale();
    else if (step.kind === 'choice') showChoice();
    else if (step.kind === 'finale2') startFinale2();
  }

  function advanceStep() {
    const next = save.step + 1;
    if (next >= STEPS.length) {
      save.step = 0;
      save.flags = save.flags || {};
      persist();
      showMenu();
      return;
    }
    runStep(next);
  }

  function showChoice() {
    hideAllOverlays();
    game.mode = 'choice';
    const el = document.getElementById('choice');
    if (el) el.classList.remove('hidden');
    sfx.ui();
  }

  function pickEnding(friend) {
    save.flags.friend = !!friend;
    persist();
    const el = document.getElementById('choice');
    if (el) el.classList.add('hidden');
    sfx.ui();
    advanceStep();
  }

  // ---------- меню и оверлеи ----------
  const ui = {
    hud: document.getElementById('hud'),
    bolts: document.getElementById('hud-bolts'),
    parts: document.getElementById('hud-parts'),
    menu: document.getElementById('menu'),
    menuBest: document.getElementById('menu-best'),
    menuBolts: document.getElementById('menu-bolts'),
    story: document.getElementById('story'),
    storyTag: document.getElementById('story-tag'),
    storyTitle: document.getElementById('story-title'),
    storyText: document.getElementById('story-text'),
    dead: document.getElementById('dead'),
    deadText: document.getElementById('dead-text'),
    continueBtn: document.getElementById('btn-continue'),
    pause: document.getElementById('btn-pause'),
    pauseMenu: document.getElementById('pausemenu'),
    bonusBtn: document.getElementById('btn-bonus'),
  };

  function updateHud() {
    ui.bolts.textContent = String(save.bolts);
    const L = game.level;
    ui.parts.textContent = L ? L.partsGot + '/' + L.parts.length : '0/0';
  }

  function showMenu() {
    game.mode = 'menu';
    ui.menu.classList.remove('hidden');
    ui.hud.classList.add('hidden');
    ui.pause.classList.add('hidden');
    ui.story.classList.add('hidden');
    ui.dead.classList.add('hidden');
    ui.pauseMenu.classList.add('hidden');
    ui.menuBest.textContent = String(save.best);
    ui.menuBolts.textContent = String(save.bolts);
    const patronLine = document.getElementById('patron-line');
    if (patronLine) patronLine.classList.toggle('hidden', !save.patron);
    document.getElementById('btn-mute').textContent = 'звук: ' + (save.muted ? 'выкл' : 'вкл');
  }

  function showStory(step) {
    game.mode = 'story';
    ui.hud.classList.add('hidden');
    ui.pause.classList.add('hidden');
    ui.storyTag.textContent = step.tag;
    ui.storyTitle.textContent = step.title;
    ui.storyText.textContent = step.text;
    ui.story.classList.remove('hidden');
    sfx.ui();
  }

  function togglePause() {
    if (game.mode !== 'play' && game.mode !== 'paused') return;
    if (game.mode === 'paused') {
      game.mode = 'play';
      ui.pauseMenu.classList.add('hidden');
      game.paused = false;
    } else {
      game.mode = 'paused';
      ui.pauseMenu.classList.remove('hidden');
      game.paused = true;
    }
  }

  // ---------- промокоды ----------
  // Код выдаётся после оплаты набора в магазине (shop.html).
  // Формат: ISKRA-K-7K3M-9Q2F, где K — «Космонавт», I — «Инженер», P — «Спасибо в титрах».
  // Проверка офлайн: контрольная сумма считается от секрета и полезной части кода,
  // случайно набранный код не пройдёт. Секрет лежит в этом файле, то есть при желании
  // его можно вытащить — для наборов за 150–300 ₽ этого достаточно; повторная
  // активация одного и того же кода на устройстве заблокирована.
  const PROMO_SECRET = 'iskra-rocket-2026-11';
  const PROMO_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function promoHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function promoSuffix(tier, payload) {
    let n = promoHash(PROMO_SECRET + '|' + tier + '|' + payload);
    let out = '';
    for (let i = 0; i < 4; i++) {
      out += PROMO_ALPHA[n & 31];
      n = Math.floor(n / 32);
    }
    return out;
  }

  function promoParse(raw) {
    let s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (s.startsWith('ISKRA')) s = s.slice(5);
    if (s.length !== 9) return null;
    const tier = s[0];
    const payload = s.slice(1, 5);
    if ('KIP'.indexOf(tier) < 0) return null;
    if (promoSuffix(tier, payload) !== s.slice(5)) return null;
    return { tier: tier, payload: payload };
  }

  function promoApply(tier) {
    const got = [];
    if (tier === 'K' || tier === 'I') {
      if (tier === 'I') {
        for (const id of Object.keys(SKINS)) {
          if (save.bought.shapes.indexOf(id) < 0) {
            save.bought.shapes.push(id);
            got.push('корпус «' + SKINS[id].name + '»');
          }
        }
      }
      for (const id of Object.keys(COLORS)) {
        if (save.bought.colors.indexOf(id) < 0) {
          save.bought.colors.push(id);
          got.push('окраска «' + COLORS[id].name + '»');
        }
      }
      const bolts = tier === 'K' ? 300 : 1000;
      save.bolts += bolts;
      got.push(bolts + ' болтиков');
    } else {
      save.patron = true;
      got.push('спасибо за поддержку');
    }
    persist();
    updateHud();
    ui.menuBolts.textContent = String(save.bolts);
    return got;
  }

  const codeOverlay = document.getElementById('code');
  const codeInput = document.getElementById('code-input');
  const codeMsg = document.getElementById('code-msg');

  function showCodeMsg(text, kind) {
    codeMsg.className = 'hint' + (kind ? ' ' + kind : '');
    codeMsg.textContent = text;
  }

  function openCodes() {
    sfx.ui();
    codeInput.value = '';
    showCodeMsg('', '');
    codeOverlay.classList.remove('hidden');
    setTimeout(() => codeInput.focus(), 30);
  }

  function closeCodes() {
    sfx.ui();
    codeOverlay.classList.add('hidden');
  }

  function submitCode() {
    const parsed = promoParse(codeInput.value);
    if (!parsed) {
      showCodeMsg('Код не подошёл. Он выглядит так: ISKRA-K-7K3M-9Q2F', 'bad');
      return;
    }
    const key = parsed.tier + parsed.payload;
    if (!Array.isArray(save.usedCodes)) save.usedCodes = [];
    if (save.usedCodes.indexOf(key) >= 0) {
      showCodeMsg('Этот код уже активирован на этом устройстве.', 'bad');
      return;
    }
    save.usedCodes.push(key);
    const got = promoApply(parsed.tier);
    persist();
    sfx.coin();
    renderSkins();
    const patronLine = document.getElementById('patron-line');
    if (patronLine) patronLine.classList.toggle('hidden', !save.patron);
    showCodeMsg('Готово: ' + got.join(', ') + '.', 'good');
  }

  document.getElementById('btn-code').addEventListener('click', openCodes);
  document.getElementById('btn-code-close').addEventListener('click', closeCodes);
  document.getElementById('btn-code-ok').addEventListener('click', submitCode);
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitCode();
    }
  });

  // ---------- кнопки UI ----------
  document.getElementById('btn-play').addEventListener('click', () => {
    sfx.ui();
    ui.menu.classList.add('hidden');
    startFromSave();
  });
  document.getElementById('btn-restart').addEventListener('click', () => {
    sfx.ui();
    const bolts = save.bolts;
    save = freshSave();
    save.bolts = bolts;
    save.started = true;
    persist();
    ui.menu.classList.add('hidden');
    runStep(0);
  });
  document.getElementById('btn-story').addEventListener('click', () => {
    sfx.ui();
    ui.story.classList.add('hidden');
    advanceStep();
  });
  document.getElementById('btn-retry').addEventListener('click', () => {
    sfx.ui();
    ui.dead.classList.add('hidden');
    ui.hud.classList.remove('hidden');
    ui.pause.classList.remove('hidden');
    deathShown = false;
    game.continueUsed = false;
    const r = safeRespawnPoint(game.respawn || { x: game.level.spawn.x, y: game.level.spawn.y });
    player.x = r.x;
    player.y = r.y - player.h;
    player.vx = 0;
    player.vy = 0;
    player.onGround = true;
    player.jumps = 0;
    player.invuln = 1.2;
    game.mode = 'play';
    game.camX = clamp(player.x - VW * 0.42, 0, game.level.width - VW);
    updateHud();
  });
  document.getElementById('btn-continue').addEventListener('click', () => {
    sfx.ui();
    Yandex.rewarded((ok) => {
      if (!ok) return;
      game.continueUsed = true;
      ui.dead.classList.add('hidden');
      ui.hud.classList.remove('hidden');
      ui.pause.classList.remove('hidden');
      deathShown = false;
      const r = safeRespawnPoint(game.respawn || { x: game.level.spawn.x, y: game.level.spawn.y });
      player.x = r.x;
      player.y = r.y - player.h;
      player.vx = 0;
      player.vy = 0;
      player.onGround = true;
      player.jumps = 0;
      player.invuln = 1.2;
      game.mode = 'play';
      updateHud();
    });
  });
  document.getElementById('btn-dead-home').addEventListener('click', () => {
    sfx.ui();
    deathShown = false;
    showMenu();
  });
  ui.pause.addEventListener('click', () => {
    sfx.ui();
    togglePause();
  });
  document.getElementById('btn-resume').addEventListener('click', () => {
    sfx.ui();
    togglePause();
  });
  document.getElementById('btn-pause-home').addEventListener('click', () => {
    sfx.ui();
    showMenu();
  });
  ui.bonusBtn.addEventListener('click', () => {
    sfx.ui();
    Yandex.rewarded((ok) => {
      if (!ok) return;
      save.bolts += 50;
      persist();
      ui.menuBolts.textContent = String(save.bolts);
    });
  });
  const choiceAlone = document.getElementById('btn-choice-alone');
  if (choiceAlone) choiceAlone.addEventListener('click', () => pickEnding(false));
  const choiceFriend = document.getElementById('btn-choice-friend');
  if (choiceFriend) choiceFriend.addEventListener('click', () => pickEnding(true));

  const pzBack = document.getElementById('btn-pz-back');
  if (pzBack) {
    pzBack.addEventListener('click', () => {
      sfx.ui();
      showMenu();
    });
  }

  const btnLevels = document.getElementById('btn-levels');
  if (btnLevels) {
    btnLevels.addEventListener('click', () => {
      sfx.ui();
      renderLevels();
      ui.menu.classList.add('hidden');
      document.getElementById('levels').classList.remove('hidden');
    });
  }
  const btnLevelsClose = document.getElementById('btn-levels-close');
  if (btnLevelsClose) {
    btnLevelsClose.addEventListener('click', () => {
      sfx.ui();
      document.getElementById('levels').classList.add('hidden');
      ui.menu.classList.remove('hidden');
    });
  }

  const btnSkins = document.getElementById('btn-skins');
  if (btnSkins) {
    btnSkins.addEventListener('click', () => {
      sfx.ui();
      renderSkins();
      ui.menu.classList.add('hidden');
      document.getElementById('skins').classList.remove('hidden');
    });
  }
  const btnSkinsClose = document.getElementById('btn-skins-close');
  if (btnSkinsClose) {
    btnSkinsClose.addEventListener('click', () => {
      sfx.ui();
      document.getElementById('skins').classList.add('hidden');
      ui.menu.classList.remove('hidden');
      ui.menuBolts.textContent = String(save.bolts);
    });
  }

  document.getElementById('btn-mute').addEventListener('click', () => {
    save.muted = !save.muted;
    persist();
    document.getElementById('btn-mute').textContent = 'звук: ' + (save.muted ? 'выкл' : 'вкл');
  });

  // Кнопка доната — только на собственном сайте (на Яндекс Играх внешние платежи запрещены).
  (function initDonateButton() {
    const btn = document.getElementById('btn-donate');
    if (!btn) return;
    if (!/\.github\.io$/.test(location.hostname)) return;
    btn.classList.remove('hidden');
    btn.addEventListener('click', () => {
      window.open('donate.html', '_blank', 'noopener');
    });
  })();

  // ---------- головоломки ----------
  const PIPE_BITS = { N: 1, E: 2, S: 4, W: 8 };
  function rotMask(mask, rot) {
    const r = ((rot % 4) + 4) % 4;
    return ((mask << r) | (mask >> (4 - r))) & 15;
  }

  const PIPE_GRID = [
    [5, 3, 3, 7],
    [5, 3, 3, 5],
    [3, 5, 3, 5],
  ];
  const PIPE_SOLUTION = [
    [0, 1, 2, 0],
    [1, 3, 0, 1],
    [1, 1, 2, 1],
  ];

  function pipeBit(tile, dir) {
    return rotMask(tile.mask, tile.rot) & PIPE_BITS[dir];
  }

  function pipesSolved(pz) {
    const g = pz.grid;
    const visit = new Set();
    const queue = [[0, 1, 'W']];
    while (queue.length) {
      const [cx, cy] = queue.shift();
      const key = cx + ',' + cy;
      if (visit.has(key)) continue;
      visit.add(key);
      const tile = g[cy][cx];
      const bit = rotMask(tile.mask, tile.rot);
      const dirs = [
        ['N', 0, -1, 'S'],
        ['E', 1, 0, 'W'],
        ['S', 0, 1, 'N'],
        ['W', -1, 0, 'E'],
      ];
      for (const [dir, dx, dy, opposite] of dirs) {
        if (!(bit & PIPE_BITS[dir])) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || ny >= g.length || nx >= g[0].length) {
          if (dir === 'E' && cx === g[0].length - 1 && cy === 1) return true;
          continue;
        }
        const nt = g[ny][nx];
        if (rotMask(nt.mask, nt.rot) & PIPE_BITS[opposite]) queue.push([nx, ny]);
      }
    }
    return false;
  }

  const CHIP_TARGET = [1, 3, 5, 4, 2];

  const PIPE_SETS = {
    0: {
      masks: [
        [5, 3, 3, 7],
        [5, 3, 3, 5],
        [3, 5, 3, 5],
      ],
      solution: [
        [0, 1, 2, 0],
        [1, 3, 0, 1],
        [1, 1, 2, 1],
      ],
    },
    2: {
      masks: [
        [3, 3, 3, 3, 3],
        [5, 3, 3, 3, 3],
        [3, 5, 3, 5, 3],
      ],
      solution: [
        [0, 1, 2, 1, 2],
        [1, 3, 0, 3, 0],
        [0, 1, 2, 1, 0],
      ],
    },
  };

  const CHIP_SETS = {
    1: { target: [1, 3, 5, 4, 2], start: [2, 5, 1, 4, 3] },
    3: { target: [2, 4, 6, 5, 3, 1], start: [5, 2, 6, 1, 4, 3] },
  };

  function startPuzzle(id) {
    game.mode = 'puzzle';
    hideAllOverlays();
    showPuzzleBack(true);
    game.particles = [];

    if (id === 0 || id === 2) {
      const set = PIPE_SETS[id];
      const grid = set.masks.map((row, y) =>
        row.map((mask, x) => {
          const sol = set.solution[y][x];
          let rot = sol;
          if ((x + y) % 2 === 0) rot = (sol + 1 + ((x * 3 + y) % 3)) % 4;
          return { mask, rot, sol };
        }),
      );
      game.puzzle = { id, grid, solved: false, t: 0 };
    } else if (id === 1 || id === 3) {
      const set = CHIP_SETS[id];
      game.puzzle = { id, chips: set.start.slice(), target: set.target.slice(), sel: -1, solved: false, t: 0 };
    } else {
      game.puzzle = { id: 4, dials: [5, 5, 5], target: [2, 4, 1], solved: false, t: 0 };
    }
  }

  function pipeCellRect(pz, cx, cy) {
    const cols = pz.grid[0].length;
    const rows = pz.grid.length;
    const size = cols > 4 ? 30 : 34;
    const x0 = (VW - size * cols) / 2;
    const y0 = 150;
    return { x: x0 + cx * size, y: y0 + cy * size, w: size, h: size };
  }

  function chipRect(pz, i) {
    const n = pz.chips.length;
    const w = n > 5 ? 26 : 30;
    const gap = n > 5 ? 7 : 8;
    const total = w * n + gap * (n - 1);
    const x0 = (VW - total) / 2;
    return { x: x0 + i * (w + gap), y: 214, w, h: 40 };
  }

  function dialRect(i) {
    const w = 46;
    const gap = 22;
    const total = w * 3 + gap * 2;
    const x0 = (VW - total) / 2;
    return { x: x0 + i * (w + gap), y: 200, w, h: 62 };
  }

  function puzzleTap(p) {
    const pz = game.puzzle;
    if (!pz || pz.solved) return;
    if (p.y > VH - 60 && p.x < 96) {
      sfx.ui();
      showMenu();
      return;
    }
    sfx.ui();

    if (pz.grid) {
      const rows = pz.grid.length;
      const cols = pz.grid[0].length;
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          if (hit(p, pipeCellRect(pz, cx, cy))) {
            pz.grid[cy][cx].rot = (pz.grid[cy][cx].rot + 1) % 4;
            beep(300 + cy * 40 + cx * 20, 0.05, 'square', 0.04);
            if (pipesSolved(pz)) solvePuzzle();
            return;
          }
        }
      }
      return;
    }

    if (pz.chips) {
      for (let i = 0; i < pz.chips.length; i++) {
        if (hit(p, chipRect(pz, i))) {
          if (pz.sel === -1) pz.sel = i;
          else if (pz.sel === i) pz.sel = -1;
          else {
            const t = pz.chips[pz.sel];
            pz.chips[pz.sel] = pz.chips[i];
            pz.chips[i] = t;
            pz.sel = -1;
            beep(420 + i * 40, 0.06, 'square', 0.05);
            if (pz.chips.every((v, idx) => v === pz.target[idx])) solvePuzzle();
          }
          return;
        }
      }
      return;
    }

    if (pz.dials) {
      for (let i = 0; i < 3; i++) {
        if (hit(p, dialRect(i))) {
          pz.dials[i] = (pz.dials[i] % 9) + 1;
          beep(320 + pz.dials[i] * 30, 0.06, 'square', 0.05);
          if (pz.dials.every((v, idx) => v === pz.target[idx])) solvePuzzle();
          return;
        }
      }
    }
  }

  function solvePuzzle() {
    const pz = game.puzzle;
    if (!pz || pz.solved) return;
    pz.solved = true;
    sfx.win();
    save.bolts += 25;
    if (pz.id === 0) {
      save.flags.doubleJump = true;
      if (!save.flags.doubleJumpShown) save.flags.doubleJumpShown = true;
    }
    persist();
    setTimeout(() => {
      Yandex.fullscreen();
      advanceStep();
    }, 850);
  }

  // ---------- финал ----------

  function startFinale2() {
    game.mode = 'finale2';
    game.finale2 = { t: 0, done: false };
    hideAllOverlays();
    sfx.win();
  }

  function drawFinale2() {
    const f = game.finale2 || { t: 0 };
    const t = f.t;
    const friend = !!(save.flags && save.flags.friend);

    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#04060b');
    g.addColorStop(1, '#0c1626');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);

    // звёзды
    for (let i = 0; i < 60; i++) {
      const sx = (i * 41 + 13) % VW;
      const sy = (i * 29 + t * (t > 4 ? 30 : 4)) % VH;
      ctx.globalAlpha = 0.25 + (i % 6) / 12;
      px(sx, sy, 1, 1, '#dfe9ff');
    }
    ctx.globalAlpha = 1;

    // станция «Маяк» слева
    const stX = 20 - Math.min(40, t * 6);
    const stY = 150;
    px(stX, stY, 70, 26, '#2b3c58');
    px(stX + 8, stY + 26, 22, 60, '#22314a');
    px(stX + 44, stY + 26, 18, 46, '#22314a');
    px(stX + 6, stY + 6, 58, 3, '#48618a');
    // огни станции
    const lightsOn = t > 1.5;
    for (let i = 0; i < 5; i++) {
      px(stX + 8 + i * 12, stY + 14, 3, 3, lightsOn ? '#7ce0a3' : '#2f8f5d');
    }
    // антенна
    px(stX + 34, stY - 12, 2, 12, '#48618a');
    // второй робот у станции
    if (friend) {
      const rx2 = stX + 80 + Math.min(50, t * 10);
      const ry2 = stY + 60;
      px(rx2, ry2, 7, 10, '#bfd4ec');
      px(rx2 + 1, ry2 - 3, 5, 3, '#7ce0a3');
      px(rx2 - 2, ry2 + 10, 2, 3, '#6d829e');
      px(rx2 + 7, ry2 + 10, 2, 3, '#6d829e');
      // трос
      px(rx2 + 10, ry2 + 4, Math.max(4, 30 - t * 2), 1, '#8fb0d6');
    }

    // ракета
    const lift = t < 2 ? 0 : Math.min(300, (t - 2) * 65);
    const rx = VW / 2 - 4 + (t > 6 ? 30 : 0);
    const ry = 250 - lift;
    px(rx + 4, ry, 12, 10, '#e8eef7');
    px(rx + 3, ry + 10, 14, 22, '#dbe8f7');
    px(rx + 5, ry + 32, 10, 8, '#c8d6e8');
    px(rx + 7, ry - 5, 6, 5, '#ff6b6b');
    px(rx + 8, ry + 13, 5, 5, '#7fe8ff');
    px(rx - 1, ry + 28, 5, 12, '#ff6b6b');
    px(rx + 13, ry + 28, 5, 12, '#ff6b6b');
    if (t > 2) {
      const fh = 10 + (Math.floor(t * 18) % 2) * 6;
      px(rx + 5, ry + 40, 10, fh, '#ff8a3d');
      px(rx + 7, ry + 40, 6, fh + 3, '#ffd166');
    }

    // текст в HTML
    if (t < 2) updateFinaleUI('РЕАКТОР ЗАПУЩЕН', '');
    else if (t < 6) updateFinaleUI('ОТХОД ОТ СТАНЦИИ', friend ? 'экипаж: два' : 'экипаж: один');
    else updateFinaleUI('КУРС — ЗЕМЛЯ', friend ? 'экипаж: два' : 'экипаж: один');
  }

  function updateFinale2(dt) {
    if (!game.finale2) return;
    game.finale2.t += dt;
    if (game.finale2.t > 9.5 && !game.finale2.done) {
      game.finale2.done = true;
      advanceStep();
    }
  }

  function startFinale() {
    game.mode = 'finale';
    game.finale = { t: 0, done: false };
    ui.hud.classList.add('hidden');
    ui.pause.classList.add('hidden');
    ui.story.classList.add('hidden');
    ui.dead.classList.add('hidden');
    sfx.win();
  }

  function finaleTap() {
    if (game.finale && game.finale.t < 9) {
      game.finale.t = 9;
    }
  }

  // ---------- отрисовка мира ----------
  function px(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }


  function drawStationBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#080d16');
    g.addColorStop(0.5, '#0e1726');
    g.addColorStop(1, '#070b12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);

    const off = game.camX * 0.22;

    // панели обшивки
    for (let i = -1; i < 9; i++) {
      const x = Math.round(i * 46 - (off % 46));
      px(x, 0, 44, VH, '#101a2b');
      px(x, 0, 2, VH, '#1c2b40');
      px(x + 42, 0, 2, VH, '#080e17');
    }

    // иллюминаторы со звёздами
    for (let i = 0; i < 4; i++) {
      const wx = ((i * 88 - off * 1.3) % (VW + 140) + VW + 140) % (VW + 140) - 70;
      const wy = 120 + (i % 2) * 26;
      px(wx - 2, wy - 2, 40, 30, '#2b3c58');
      px(wx, wy, 36, 26, '#050912');
      for (let s = 0; s < 7; s++) {
        const sx = wx + 3 + ((s * 13 + i * 7) % 30);
        const sy = wy + 3 + ((s * 11 + i * 5) % 20);
        ctx.globalAlpha = 0.5 + (s % 3) * 0.2;
        px(sx, sy, 1, 1, '#dfe9ff');
      }
      ctx.globalAlpha = 1;
      px(wx, wy + 26, 36, 2, '#1c2b40');
    }

    // рёбра жёсткости и трубы
    px(0, 66, VW, 6, '#1a2740');
    px(0, 66, VW, 1, '#2b3c58');
    px(0, 214, VW, 4, '#16223a');
    for (let i = 0; i < 6; i++) {
      const x = ((i * 52 - off * 1.1) % (VW + 60) + VW + 60) % (VW + 60) - 30;
      px(x, 70, 6, 24, '#243450');
      px(x + 1, 72, 4, 20, '#0d1626');
    }

    // мигающие аварийные лампы
    const blink = Math.floor(game.time * 1.6) % 2 === 0;
    for (let i = 0; i < 3; i++) {
      const x = ((i * 90 - off * 1.5) % (VW + 120) + VW + 120) % (VW + 120) - 60;
      ctx.globalAlpha = blink ? 0.35 : 0.15;
      ctx.beginPath();
      ctx.arc(x + 8, 300, 16, 0, Math.PI * 2);
      ctx.fillStyle = '#ff6b6b';
      ctx.fill();
      ctx.globalAlpha = 1;
      px(x + 4, 296, 8, 8, blink ? '#ff9d9d' : '#7d2f3a');
    }

    // вертикальные кабели
    for (let i = 0; i < 7; i++) {
      const x = ((i * 37 - off * 0.9) % (VW + 40) + VW + 40) % (VW + 40) - 20;
      ctx.globalAlpha = 0.25;
      px(x, 0, 1, VH, '#3b83c9');
      ctx.globalAlpha = 1;
    }
  }

  function drawBackground() {
    if (game.level && game.level.theme === 'station') {
      drawStationBackground();
      return;
    }
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#111c2e');
    g.addColorStop(0.45, '#1b2c45');
    g.addColorStop(1, '#0d1622');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);

    // дальняя стена: панели с фаской
    const off = game.camX * 0.25;
    for (let i = -1; i < 8; i++) {
      const x = Math.round(i * 56 - (off % 56));
      px(x, 0, 54, VH, '#1a2941');
      px(x, 0, 2, VH, '#263a58');
      px(x + 52, 0, 2, VH, '#0f1a2a');
      px(x + 6, 26, 42, 52, '#15233a');
      px(x + 6, 26, 42, 2, '#2f4a6e');
      px(x + 6, 130, 42, 74, '#15233a');
      px(x + 6, 130, 42, 2, '#2f4a6e');
    }

    // магистральные трубы
    px(0, 74, VW, 7, '#2e4460');
    px(0, 74, VW, 2, '#4b6b93');
    px(0, 206, VW, 5, '#283d57');
    px(0, 206, VW, 1, '#436288');

    // лампы дневного света
    for (let i = 0; i < 5; i++) {
      const lx = ((i * 74 - off * 1.6) % (VW + 120) + VW + 120) % (VW + 120) - 60;
      const flick = (i === 2 && Math.sin(game.time * 17) > 0.85) ? 0.35 : 1;
      ctx.globalAlpha = 0.22 * flick;
      ctx.fillStyle = '#bfe3ff';
      ctx.beginPath();
      ctx.ellipse(lx + 16, 96, 24, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = flick;
      px(lx, 90, 32, 3, '#d8f0ff');
      px(lx + 2, 93, 28, 1, '#7fb8e8');
      ctx.globalAlpha = 1;
    }

    // мониторы на стене
    for (let i = 0; i < 3; i++) {
      const mx = ((i * 96 - off * 1.2) % (VW + 140) + VW + 140) % (VW + 140) - 70;
      px(mx, 150, 34, 22, '#0a1526');
      px(mx + 2, 152, 30, 18, '#123a52');
      const bars = Math.floor(game.time * 3 + i) % 5;
      for (let b = 0; b < bars; b++) px(mx + 4 + b * 6, 164 - b * 2, 3, b * 2 + 2, '#5fe0c8');
      px(mx + 12, 174, 10, 3, '#0a1526');
    }

    // кабели
    ctx.strokeStyle = '#20334c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= VW; i += 6) {
      const k = i / VW;
      ctx.lineTo(i, 226 + Math.sin(k * 9 + off * 0.02) * 5);
    }
    ctx.stroke();
  }

  function drawSolids() {
    for (const s of game.level.solids) {
      const x = s.x - game.camX;
      const y = s.y - game.camY;
      if (x > VW + 20 || x + s.w < -20) continue;
      px(x, y, s.w, s.h, '#1c2c42');
      px(x, y, s.w, 4, '#6f90b8');
      px(x, y, s.w, 1, '#a9c6e6');
      px(x, y + 4, s.w, 2, '#3d5675');
      for (let i = 8; i < s.w - 6; i += 16) {
        px(x + i, y + 9, 2, 2, '#8fb0d6');
        px(x + i + 1, y + 16, 2, 2, '#16243a');
      }
    }
    // шипы
    for (const sp of game.level.spikes || []) {
      const x = sp.x - game.camX;
      const y = sp.y - game.camY;
      for (let i = 0; i + 6 <= sp.w; i += 6) {
        ctx.fillStyle = C.danger;
        ctx.beginPath();
        ctx.moveTo(x + i, y + 12);
        ctx.lineTo(x + i + 3, y);
        ctx.lineTo(x + i + 6, y + 12);
        ctx.closePath();
        ctx.fill();
      }
    }
    // пар
    for (const st of game.level.steam || []) {
      const t = (game.time + st.phase) % st.period;
      const active = t < 0.75;
      const x = st.x - game.camX;
      const y = st.y - game.camY;
      px(x, y - 4, st.w, 4, C.metal);
      if (active) {
        for (let i = 0; i < 6; i++) {
          const h = 20 + i * 6;
          ctx.globalAlpha = 0.5 - i * 0.07;
          px(x + 2 + (i % 2) * 4, y - 8 - h, st.w - 8, h, C.white);
        }
        ctx.globalAlpha = 1;
      }
    }
    // зоны невесомости
    for (const z of game.level.gravityZones || []) {
      const x = z.x0 - game.camX;
      const w = z.x1 - z.x0;
      if (x > VW || x + w < 0) continue;
      ctx.globalAlpha = 0.07;
      px(x, 0, w, 360, '#7fc8ff');
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 6; i++) {
        const yy = 40 + ((i * 63 + Math.sin(game.time * 1.6 + i) * 10 + game.time * 8) % 300);
        px(x + 8 + (i % 4) * 14, yy, 2, 2, '#bfe3ff');
      }
      ctx.globalAlpha = 1;
    }

    // лазерные затворы
    for (const lz of game.level.lasers || []) {
      const x = lz.x - game.camX;
      const y = lz.y - game.camY;
      const effH = Math.max(0, Math.min(lz.h, 268 - lz.y));
      if (x < -20 || x > VW + 20) continue;
      px(x - 5, y - 8, 18, 8, '#4a5a72');
      px(x - 5, y + effH, 18, 8, '#4a5a72');
      px(x - 2, y - 6, 12, 4, '#7f93ad');
      const t = (game.time + lz.phase) % lz.period;
      const on = t < 1.1;
      const warn = !on && t > lz.period - 0.4;
      if (on) {
        ctx.globalAlpha = 0.22;
        px(x - 4, y, 16, effH, '#ff6b6b');
        ctx.globalAlpha = 1;
        px(x + 1, y, 5, effH, '#ff8a8a');
        px(x + 2, y, 3, effH, '#ffe1e1');
        px(x + 2, y, 3, effH, '#ffffff');
      } else if (warn) {
        ctx.globalAlpha = 0.7;
        px(x + 2, y, 3, effH, '#ff6b6b');
        px(x + 2, y, 3, Math.min(20, effH), '#ffe1e1');
        ctx.globalAlpha = 1;
      } else {
        px(x + 2, y, 3, effH, 'rgba(255,107,107,0.12)');
      }
    }

    // дверь
    const g = game.level.goal;
    if (g) {
      const x = g.x - game.camX;
      const y = g.y - game.camY;
      px(x - 3, y - 3, g.w + 6, g.h + 3, '#5d7ea8');
      px(x, y, g.w, g.h, '#0f2a20');
      px(x + 3, y + 3, g.w - 6, g.h - 6, '#2f8f5d');
      px(x + 5, y + 5, g.w - 10, g.h - 10, '#7ce0a3');
      px(x + g.w / 2 - 2, y + g.h / 2 - 2, 4, 4, '#0a1220');
      px(x + 4, y - 8, g.w - 8, 5, '#ffd166');
    }
    // контрольные точки
    for (const cp of game.level.checkpoints || []) {
      const x = cp.x - game.camX;
      const y = cp.y - game.camY;
      const active = game.respawn && game.respawn.x === cp.x;
      px(x, y - 22, 2, 22, active ? C.green : C.grey);
      px(x, y - 24, 10, 7, active ? C.green : C.grey);
    }
  }

  function drawItems() {
    const L = game.level;
    L.parts.forEach((p, i) => {
      if (L.taken.has('p' + i)) return;
      const x = p.x - game.camX;
      const y = p.y - game.camY + Math.sin(game.time * 3 + i) * 1.5;
      px(x, y, 9, 9, C.warm);
      px(x + 2, y + 2, 5, 5, C.warmDk);
      px(x + 4, y - 3, 1, 3, C.warm);
    });
    L.bolts.forEach((b, i) => {
      if (L.taken.has('b' + i)) return;
      const x = b.x - game.camX;
      const y = b.y - game.camY + Math.sin(game.time * 4 + i * 0.7) * 1.2;
      px(x, y, 7, 7, C.accent);
      px(x + 2, y + 2, 3, 3, C.wall);
    });
  }

  // ---------- внешний вид робота ----------
  const SKINS = {
    standard: {
      name: 'Стандартный корпус',
      price: 0,
      art: [
        '..AA....',
        '.HBBH...',
        'HBBBBH..',
        'HBEEBH..',
        'HBBBBH..',
        '.BBBB...',
        '.BCCB...',
        '.CCCC...',
        '.CCCC...',
        '.CCCC...',
        '.C..C...',
        'LL..LL..',
        'LL..LL..',
      ],
    },
    scout: {
      name: 'Разведчик',
      price: 260,
      art: [
        '..AA....',
        '.HBBH...',
        '.BBBB...',
        '.BEEB...',
        '.BBBB...',
        '.BBBB...',
        '.BCCB...',
        '.CCCC...',
        '.C..C...',
        '.C..C...',
        'LL..LL..',
        'LL..LL..',
        '........',
      ],
    },
    heavy: {
      name: 'Магнитный тягач',
      price: 320,
      art: [
        '..AA....',
        '.HBBH...',
        'HBBBBB..',
        'HBEEBH..',
        'HBBBBB..',
        'BBBBBB..',
        '.CCCC...',
        '.CCCC...',
        'CCCCCC..',
        '.C..C...',
        'LL..LL..',
        'LL..LL..',
        '........',
      ],
    },
  };

  const COLORS = {
    blue: { name: 'Сталь', price: 0, A: '#ffd166', H: '#8fb0d6', B: '#dbe8f7', E: '#3b83c9', C: '#bfd4ec', L: '#6d829e' },
    amber: { name: 'Янтарь', price: 120, A: '#ff6b6b', H: '#e0a44a', B: '#ffe3ad', E: '#b4530c', C: '#f2c98a', L: '#7a5a33' },
    green: { name: 'Хвоя', price: 120, A: '#ffd166', H: '#7ce0a3', B: '#d9f7e4', E: '#1f7a4d', C: '#a8e6c3', L: '#4f7a62' },
    red: { name: 'Кирпич', price: 120, A: '#ffd166', H: '#ff8a8a', B: '#ffe1e1', E: '#a32020', C: '#f6b3b3', L: '#7a3b3b' },
    mono: { name: 'Ночная смена', price: 180, A: '#7fe8ff', H: '#9aa7b8', B: '#e8eef7', E: '#2b3c58', C: '#c3ccd9', L: '#5a687c' },
  };

  function drawSprite(art, palette, ox, oy, unit, flip) {
    for (let ry = 0; ry < art.length; ry++) {
      const row = art[ry];
      for (let rx = 0; rx < row.length; rx++) {
        const ch = row[rx];
        if (ch === '.' || ch === ' ') continue;
        const color = palette[ch];
        if (!color) continue;
        const dx = flip ? row.length - 1 - rx : rx;
        px(ox + dx * unit, oy + ry * unit, unit, unit, color);
      }
    }
  }

  function drawRobot() {
    const x = Math.round(player.x - game.camX);
    const y = Math.round(player.y - game.camY);
    const f = player.face;
    const air = !player.onGround;
    const walkFrame = player.onGround && Math.abs(player.vx) > 6 ? Math.floor(player.anim) % 2 : 0;
    const unit = 2;
    const artW = 8 * unit;
    const artH = 13 * unit;

    if (player.onGround) {
      ctx.globalAlpha = 0.28;
      px(x - 1, y + player.h - 1, player.w + 2, 2, '#05070c');
      ctx.globalAlpha = 1;
    }

    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#9fd8ff';
    ctx.beginPath();
    ctx.arc(x + player.w / 2, y + player.h / 2, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const ox = x + (player.w - artW) / 2;
    const oy = y + player.h - artH + walkFrame;
    const shape = SKINS[save.skin && SKINS[save.skin.shape] ? save.skin.shape : 'standard'];
    const palette = COLORS[save.skin && COLORS[save.skin.color] ? save.skin.color : 'blue'];
    drawSprite(shape.art, palette, ox, oy, unit, f < 0);

    const eyeX = ox + (f < 0 ? 2 * unit : 3 * unit);
    px(eyeX, oy + 3 * unit, 2 * unit, unit, '#7fe8ff');

    if (air && player.vy < -60 && player.jumps >= 2) {
      px(x + player.w / 2 - 2, y + player.h + 1, 4, 2, '#ffd166');
      px(x + player.w / 2 - 1, y + player.h + 3, 2, 3, '#ff6b6b');
    }
  }

  function drawParticles() {
    for (const p of game.particles) {
      ctx.globalAlpha = Math.max(0, p.life * 3);
      px(p.x - game.camX, p.y - game.camY, p.size, p.size, p.color);
    }
    ctx.globalAlpha = 1;
  }

  function drawTouchControls() {
    const drawBtn = (b, label, active) => {
      ctx.globalAlpha = active ? 0.85 : 0.45;
      px(b.x, b.y, b.w, b.h, active ? C.metal : C.void);
      ctx.globalAlpha = active ? 1 : 0.7;
      ctx.fillStyle = C.accent;
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
      ctx.globalAlpha = 1;
    };
    drawBtn(buttons.left, '◀', touch.left || input.left);
    drawBtn(buttons.right, '▶', touch.right || input.right);
    drawBtn(buttons.jump, '▲', input.jump);
  }

  function drawMessage() {
    if (!game.msg) return;
    ctx.globalAlpha = Math.min(1, game.msgTimer * 2);
    ctx.fillStyle = 'rgba(5,7,12,0.82)';
    ctx.fillRect(30, VH / 2 - 26, VW - 60, 52);
    ctx.strokeStyle = C.metalHi;
    ctx.lineWidth = 1;
    ctx.strokeRect(30.5, VH / 2 - 25.5, VW - 61, 51);
    ctx.fillStyle = C.white;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = String(game.msg).split('\n');
    lines.forEach((ln, i) => ctx.fillText(ln, VW / 2, VH / 2 - 8 + i * 14));
    ctx.globalAlpha = 1;
  }

  function render() {
    if (game.mode === 'play' || game.mode === 'paused' || game.mode === 'dead') {
      drawBackground();
      drawSolids();
      drawItems();
      drawRobot();
      drawParticles();
      if (SHOW_TOUCH) drawTouchControls();
      drawMessage();
      if (game.flash > 0) {
        ctx.globalAlpha = game.flash;
        ctx.fillStyle = C.white;
        ctx.fillRect(0, 0, VW, VH);
        ctx.globalAlpha = 1;
      }
    } else if (game.mode === 'puzzle') {
      drawPuzzle();
    } else if (game.mode === 'finale') {
      drawFinale();
    } else if (game.mode === 'finale2') {
      drawFinale2();
    } else if (game.mode === 'menu') {
      drawMenuBackdrop();
    }
  }

  function drawMenuBackdrop() {
    ctx.fillStyle = '#070b12';
    ctx.fillRect(0, 0, VW, VH);
    const t = game.time;
    for (let i = 0; i < 40; i++) {
      const x = (i * 37) % VW;
      const y = (i * 53 + t * (6 + (i % 5))) % VH;
      ctx.globalAlpha = 0.25 + ((i % 7) / 20);
      px(x, y, 1, 1, C.accent);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- цикл ----------
  let last = performance.now();
  let paused = false;

  function advance(dt) {
    if (game.mode !== 'paused') game.time += dt;
    if (game.mode === 'play') {
      movePlayer(dt);
      interact(dt);
    }
    for (const p of game.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 240 * dt;
      p.life -= dt;
    }
    game.particles = game.particles.filter((p) => p.life > 0);
    game.flash = Math.max(0, game.flash - dt * 3);
    game.shake = Math.max(0, game.shake - dt);
    if (game.mode === 'puzzle') updatePuzzle(dt);
    if (game.mode === 'finale') updateFinale(dt);
    if (game.mode === 'finale2') updateFinale2(dt);
  }

  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (!paused) {
      advance(dt);
      render();
    }
    requestAnimationFrame(loop);
  }

  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    last = performance.now();
  });

  // ---------- заглушки для следующего этапа ----------
  function updatePuzzleUI(pz) {
    const box = document.getElementById('puzzle-ui');
    if (!box) return;
    const title = document.getElementById('pz-title');
    const sub = document.getElementById('pz-sub');
    const cond = document.getElementById('pz-cond');

    const titles = {
      0: 'Схема питания',
      1: 'Чипы питания',
      2: 'Энергосеть станции',
      3: 'Ядро питания',
      4: 'Пульт реактора',
    };
    title.textContent = titles[pz.id] || 'Головоломка';

    const conds = [];
    if (pz.grid) {
      sub.textContent = 'Нажимай на муфты, чтобы поворачивать их. Собери путь от левого входа к правому выходу.';
      conds.push({ text: 'Цепь замкнута', ok: pipesSolved(pz) });
    } else if (pz.chips) {
      sub.textContent =
        pz.target.length > 5
          ? 'Меняй чипы местами: сначала чётные по возрастанию, затем нечётные по убыванию.'
          : 'Меняй чипы местами: сначала нечётные по возрастанию, затем чётные по убыванию.';
      const right = pz.chips.filter((v, i) => v === pz.target[i]).length;
      conds.push({ text: 'На своих местах: ' + right + ' из ' + pz.chips.length, ok: right === pz.chips.length });
    } else if (pz.dials) {
      sub.textContent = 'Нажимай на колёсики, чтобы увеличивать числа. Нужно выполнить все три условия сразу.';
      const [a, b, c] = pz.dials;
      conds.push({ text: 'Первое число вдвое меньше второго (' + a + ' × 2 = ' + b + ')', ok: a * 2 === b });
      conds.push({ text: 'Третье число равно единице (сейчас ' + c + ')', ok: c === 1 });
      conds.push({ text: 'Сумма всех трёх равна семи (сейчас ' + (a + b + c) + ')', ok: a + b + c === 7 });
    }

    cond.innerHTML = conds
      .map((c) => '<div class="cond' + (c.ok ? ' ok' : '') + '">' + (c.ok ? '✓ ' : '• ') + c.text + '</div>')
      .join('');
    box.classList.remove('hidden');
  }

  function hidePuzzleUI() {
    const box = document.getElementById('puzzle-ui');
    if (box) box.classList.add('hidden');
  }

  function drawPuzzle() {
    const pz = game.puzzle;
    if (!pz) return;
    const isStation = pz.id >= 2;
    ctx.fillStyle = isStation ? '#080d16' : '#0b1220';
    ctx.fillRect(0, 0, VW, VH);

    px(8, 40, VW - 16, VH - 110, isStation ? '#101a2b' : '#121d2e');
    px(8, 40, VW - 16, 2, '#2f4a6e');
    px(8, 40, 2, VH - 110, '#2f4a6e');
    if (isStation) {
      px(10, 42, VW - 20, 1, '#7fc8ff');
    }

    updatePuzzleUI(pz);

    if (pz.grid) {
      const cols = pz.grid[0].length;
      const rows = pz.grid.length;
      const first = pipeCellRect(pz, 0, 1);
      const last = pipeCellRect(pz, cols - 1, 1);
      px(first.x - 14, first.y + 12, 12, 10, '#7ce0a3');
      px(last.x + last.w + 2, last.y + 12, 12, 10, '#ffd166');

      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const r = pipeCellRect(pz, cx, cy);
          const tile = pz.grid[cy][cx];
          const edge = (cy === 1 && (cx === 0 || cx === cols - 1));
          px(r.x, r.y, r.w, r.h, edge ? '#1b2c45' : '#14213a');
          px(r.x, r.y, r.w, 1, '#2b4466');
          const bit = rotMask(tile.mask, tile.rot);
          const cxm = r.x + r.w / 2;
          const cym = r.y + r.h / 2;
          const arm = r.w / 2 - 3;
          const col = edge ? '#ffd166' : '#8fb0d6';
          const core = edge ? '#ffd166' : '#5b7ea8';
          px(cxm - 3, cym - 3, 6, 6, core);
          if (bit & 1) px(cxm - 2, cym - arm, 4, arm, col);
          if (bit & 2) px(cxm + 2, cym - 2, arm, 4, col);
          if (bit & 4) px(cxm - 2, cym + 2, 4, arm, col);
          if (bit & 8) px(cxm - arm - 2, cym - 2, arm, 4, col);
        }
      }
    } else if (pz.chips) {
      const r0 = chipRect(pz, 0);
      const rn = chipRect(pz, pz.chips.length - 1);
      px(r0.x - 6, 206, rn.x + rn.w - r0.x + 12, 56, '#0e1726');
      for (let i = 0; i < pz.chips.length; i++) {
        const r = chipRect(pz, i);
        const selected = pz.sel === i;
        const ok = pz.chips[i] === pz.target[i];
        px(r.x, r.y, r.w, r.h, selected ? '#2b4466' : '#1b2c45');
        px(r.x, r.y, r.w, 1, selected ? '#7fc8ff' : '#2f4a6e');
        px(r.x + 4, r.y + 4, r.w - 8, r.h - 8, ok ? '#16352b' : '#0f1a2a');
        ctx.fillStyle = ok ? '#7ce0a3' : '#cfe3ff';
        ctx.font = 'bold 15px monospace';
        ctx.fillText(String(pz.chips[i]), r.x + r.w / 2, r.y + r.h / 2 + 1);
        ctx.fillStyle = '#6d829e';
        ctx.font = '6px monospace';
        ctx.fillText(String(i + 1), r.x + r.w / 2, r.y + r.h + 8);
      }
    } else if (pz.dials) {
      for (let i = 0; i < 3; i++) {
        const r = dialRect(i);
        px(r.x, r.y, r.w, r.h, '#1b2c45');
        px(r.x, r.y, r.w, 2, '#2f4a6e');
        px(r.x + 3, r.y + 3, r.w - 6, r.h - 6, '#0f1a2a');
        ctx.fillStyle = '#cfe3ff';
        ctx.font = 'bold 24px monospace';
        ctx.fillText(String(pz.dials[i]), r.x + r.w / 2, r.y + r.h / 2 + 2);
        ctx.fillStyle = '#6d829e';
        ctx.font = '6px monospace';
        ctx.fillText('▲', r.x + r.w / 2, r.y - 4);
      }
    }

  }

  function updatePuzzle(dt) {
    const pz = game.puzzle;
    if (!pz) return;
    pz.t += dt;
    if (!pz.solved) {
      if (pz.dials) {
        const [a, b, c] = pz.dials;
        if (a * 2 === b && c === 1 && a + b + c === 7) solvePuzzle();
      }
      if (pz.grid && pz.t > 0.4 && pipesSolved(pz)) solvePuzzle();
    }
    if (pz.t > 0.15 && !pz.backBound) {
      pz.backBound = true;
    }
  }



  function updateFinaleUI(title, sub) {
    const box = document.getElementById('finale-ui');
    if (!box) return;
    const t = document.getElementById('fin-title');
    const s = document.getElementById('fin-sub');
    if (t.textContent !== title) t.textContent = title;
    if (s.textContent !== sub) s.textContent = sub;
    box.classList.remove('hidden');
  }

  function hideFinaleUI() {
    const box = document.getElementById('finale-ui');
    if (box) box.classList.add('hidden');
  }

  function showPuzzleBack(on) {
    const box = document.getElementById('pz-back');
    if (box) box.classList.toggle('hidden', !on);
  }

  function drawFinale() {
    const f = game.finale || { t: 0 };
    const t = f.t;

    // небо
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#05070c');
    g.addColorStop(1, '#101c2e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);

    // звёзды, которые «летят» после старта
    for (let i = 0; i < 50; i++) {
      const sx = (i * 53 + 7) % VW;
      const speed = t > 5 ? 160 : 10;
      const sy = (i * 37 + t * speed) % VH;
      ctx.globalAlpha = 0.3 + (i % 5) / 10;
      px(sx, sy, 1, t > 5 ? 3 : 1, '#dfe9ff');
    }
    ctx.globalAlpha = 1;

    // земля/луна внизу
    const groundY = Math.min(VH - 60, 330 + Math.max(0, t - 3) * 40);
    ctx.fillStyle = '#1a2c44';
    ctx.beginPath();
    ctx.ellipse(VW / 2, groundY + 150, 260, 120, 0, 0, Math.PI * 2);
    ctx.fill();

    // ракета
    const lift = t < 2 ? 0 : Math.min(320, (t - 2) * 90);
    const rx = VW / 2 - 14;
    const ry = groundY - 84 - lift;
    // корпус
    px(rx + 6, ry, 16, 12, '#e8eef7');
    px(rx + 4, ry + 12, 20, 26, '#dbe8f7');
    px(rx + 6, ry + 38, 16, 10, '#c8d6e8');
    px(rx + 8, ry + 48, 12, 6, '#8fb0d6');
    // нос
    px(rx + 10, ry - 6, 8, 6, '#ff6b6b');
    px(rx + 12, ry - 9, 4, 4, '#ffd166');
    // окно
    px(rx + 10, ry + 16, 8, 8, '#7fe8ff');
    px(rx + 12, ry + 18, 4, 4, '#1b3a5c');
    // иллюминатор-обод
    px(rx + 8, ry + 14, 12, 1, '#8fb0d6');
    // плавники
    px(rx - 2, ry + 34, 8, 16, '#ff6b6b');
    px(rx + 20, ry + 34, 8, 16, '#ff6b6b');
    // дюзы
    px(rx + 8, ry + 54, 12, 4, '#4a5a72');

    // пламя
    if (t > 1.6) {
      const flick = Math.floor(t * 20) % 2;
      const fh = 12 + flick * 6 + Math.sin(t * 14) * 3;
      px(rx + 8, ry + 58, 12, 4, '#ffd166');
      px(rx + 9, ry + 58 + 4, 10, fh, '#ff8a3d');
      px(rx + 11, ry + 58 + 4, 6, fh + 4, '#ff6b6b');
      px(rx + 12, ry + 60 + 4, 4, fh + 8, '#fff3c4');
    }

    // дым на старте
    if (t > 1.6 && t < 5) {
      for (let i = 0; i < 8; i++) {
        const k = (t - 1.6) * 0.8 + i * 0.1;
        ctx.globalAlpha = Math.max(0, 0.5 - k * 0.2);
        px(rx - 10 - k * 26, ry + 56 + (i % 3) * 6, 10, 8, '#9fb4d0');
        px(rx + 30 + k * 24, ry + 58 + ((i + 1) % 3) * 6, 10, 8, '#9fb4d0');
      }
      ctx.globalAlpha = 1;
    }

    // текст в HTML
    if (t < 1.6) updateFinaleUI('ПУСК', 'двигатели готовы');
    else if (t < 4) updateFinaleUI('ДВИГАТЕЛИ ЗАПУЩЕНЫ', '');
    else updateFinaleUI('ОРБИТА', 'проект «Ракета» выполнен');
  }

  function updateFinale(dt) {
    if (!game.finale) return;
    game.finale.t += dt;
    if (game.finale.t > 9.5 && !game.finale.done) {
      game.finale.done = true;
      advanceStep();
    }
  }




  // ---------- старт ----------
  showMenu();
  Yandex.init();
  // Если есть сохранение — сразу продолжаем с текущего шага. Раньше здесь стояло
  // `classList.add(...) && runStep(...)`: add() возвращает undefined, поэтому
  // runStep не вызывался, а меню уже было спрятано — игрок видел пустой экран.
  if (save.step > 0) {
    ui.menu.classList.add('hidden');
    runStep(save.step);
  }
  requestAnimationFrame(loop);

  window.__iskra = { game, save, player, STEPS, LEVELS, runStep, advance, get death() { return game.lastDeath; } };
})();

















