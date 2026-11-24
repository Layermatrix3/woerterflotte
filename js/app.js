import {el, button, section, row, field, select, read, store, backLink} from './ui.js';
import {types, modes, levels, questionPool, getQuestion, validateCatalog} from './questions.js';
import {shipSpecs, randomFleet, placement, coordinates, chooseShot} from './board.js';
import {powers, initialGame, transition, summary, cellAvailable} from './game.js';
import {configured, connect, seed} from './multiplayer.js';
import {soundsPage, learnPage, teacherPage} from './pages.js';
import {sound, soundSettings} from './sounds.js';

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const status = document.querySelector('#connection');
const mute = document.querySelector('#mute');
const defaults = {name:'', mode:'classic', level:2, size:10, time:45, count:5, special:false, ai:2, custom:false};
let selection = {...defaults, ...read('options', {})};
let page = 'home';
let catalog;
let online;
let connection;
let room;
let code;
let present = {};
let catalogSource;
let activeCatalog;
let pool;
let specs;
let board = [];
let enemy = [];
let selected = 0;
let vertical = false;
let local;
let showingRoom = false;
let seenGame = '';
let busy = false;
let moveBusy = false;
let resolveBusy = false;
let aiTimer;
let toastTimer;
let feedback;
let learnFilter;
let resume = read('resume', null);
let roomError = '';
let setupFocus;
const initialCode = new URLSearchParams(location.search).get('lobby') || '';

const feedbackText = {
  right:'Richtige Antwort!', wrong:'Lösung', timeout:'Zeit abgelaufen. Lösung',
  hit:'Treffer!', miss:'Fehlschuss', sunk:'Schiff versenkt!', radar:'Radar ausgewertet', blocked:'Angriff abgewehrt!'
};

function notify(message, error = false) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = error ? 'visible error' : 'visible';
  toastTimer = window.setTimeout(() => { toast.className = ''; }, 4300);
}

function report(error) {
  const firebase = {
    'auth/operation-not-allowed':'Die anonyme Anmeldung muss in Firebase aktiviert werden.',
    'auth/unauthorized-domain':'Diese Webadresse muss in Firebase freigegeben werden.',
    'auth/network-request-failed':'Firebase ist gerade nicht erreichbar.',
    PERMISSION_DENIED:'Firebase hat die Aktion abgelehnt. Die Lobby ist belegt, abgelaufen oder die Sicherheitsregeln passen nicht.'
  };
  notify(firebase[error?.code] || (/permission.denied/i.test(error?.message) ? firebase.PERMISSION_DENIED :
    error?.message || 'Die Aktion konnte nicht abgeschlossen werden.'), true);
}

function guarded(work) {
  return async event => {
    event?.preventDefault();
    if (busy) return;
    busy = true;
    const submit = event?.submitter;
    if (submit) submit.disabled = true;
    try { await work(event); }
    catch (error) { report(error); }
    finally { busy = false; if (submit) submit.disabled = false; }
  };
}

function updateStatus() {
  const text = online?.online ? 'Live verbunden' : !navigator.onLine || online ? 'Offline' :
    configured ? 'Online-Spiel verfügbar' : 'Lokales Spiel verfügbar';
  status.textContent = text;
  status.classList.toggle('live', Boolean(online?.online));
  if (code && ['room','setup','battle'].includes(page)) {
    updatePresence();
    if (online?.online) schedule();
  }
}

async function network() {
  if (!navigator.onLine) throw Error('Du bist offline. Prüfe deine Internetverbindung.');
  if (!connection) connection = connect(() => setTimeout(updateStatus, 0)).catch(error => {
    connection = null;
    throw error;
  });
  online = await connection;
  await online.waitForConnection();
  updateStatus();
  return online;
}

function sharedGame() { return code ? room?.game : local?.game; }
function config() { return code ? room?.config : local?.config; }
function role() { return code && room?.guest?.uid === online.uid ? 1 : 0; }
function time() { return code ? online.now() : Date.now(); }
function names() { return code ? [room.host.name, room.guest?.name || 'Gast'] : [local.config.name, 'Computer']; }
function boardKey(target = room) { return 'board-' + code + '-' + target.instance + '-' + target.round + '-' + online.uid; }

function show(id) {
  page = id;
  render();
  window.scrollTo(0, 0);
}

function resetPlacement() {
  board = [];
  selected = 0;
  vertical = false;
  setupFocus = null;
  feedback = null;
}

function prepare(settings, questions) {
  activeCatalog = questions;
  specs = shipSpecs(settings, questions);
  pool = questionPool(questions, settings.mode, settings.level);
  if (!pool.length) throw Error('Für diesen Modus sind keine Fragen vorhanden.');
}

function savedCatalog() {
  return validateCatalog(read('catalog', catalog));
}

function goHome() {
  if (code) {
    online.unwatch();
    room = null;
    code = null;
    present = {};
  }
  local = null;
  showingRoom = false;
  show('home');
}

function clearLobby() {
  resume = null;
  try { store('resume', null); } catch { /* Lokaler Speicher ist deaktiviert. */ }
  goHome();
}

function attachRoom(newCode) {
  code = newCode;
  room = null;
  roomError = '';
  present = {};
  showingRoom = false;
  local = null;
  resetPlacement();
  show('room');
  online.watch(newCode, next => {
    if (code !== newCode) return;
    if (!next || next.stage === 'closed' || next.expires <= time()) {
      if (next?.expires <= time() && next.host.uid === online.uid) online.expire(newCode, next).catch(() => {});
      if (next?.stage === 'closed' && next.host.uid === online.uid) online.leave(next).catch(() => {});
      clearLobby();
      notify('Die Lobby wurde geschlossen oder ist abgelaufen.', true);
      return;
    }
    if (next.host.uid !== online.uid && next.guest?.uid !== online.uid) {
      clearLobby();
      notify('Du gehörst nicht mehr zu dieser Lobby.', true);
      return;
    }
    const changedRound = !room || next.instance !== room.instance || next.round !== room.round;
    if (changedRound) {
      resetPlacement();
      try {
        prepare(next.config, validateCatalog(JSON.parse(next.catalog)));
        board = read(boardKey(next), []);
      } catch (error) {
        clearLobby();
        report(error);
        return;
      }
    }
    if (room && !room.guest && next.guest) {
      sound('join');
      notify(next.guest.name + ' ist beigetreten.');
    }
    room = next;
    if (!resume || resume.code !== code || resume.instance !== room.instance) {
      resume = {code, instance:room.instance};
      try { store('resume', resume); } catch { /* Spiel bleibt im aktuellen Tab verfügbar. */ }
    }
    const stage = page === 'learn' && learnFilter?.fromBattle && next.game?.phase === 'over' ? 'learn' : room.stage === 'waiting' || (showingRoom && room.game?.phase === 'over') ? 'room' :
      room.stage === 'setup' ? 'setup' : 'battle';
    const current = page;
    if (changedRound) showingRoom = false;
    observe();
    if (stage !== current) show(stage);
    else if (stage !== 'learn') render();
    schedule();
  }, next => {
    present = next;
    updatePresence();
  }, () => {
    if (code !== newCode) return;
    roomError = 'Die Lobby ist nicht erreichbar. Prüfe den Code und die Verbindung.';
    if (!room) {
      clearLobby();
      notify(roomError, true);
    } else {
      updatePresence();
      notify(roomError, true);
    }
  });
}

function updatePresence() {
  if (!room) return;
  for (const player of [room.host, room.guest]) {
    const label = player && document.getElementById('presence-' + player.uid);
    if (label) {
      const connected = online.online && Boolean(present[player.uid]);
      label.textContent = connected ? 'Verbunden' : 'Nicht verbunden';
      label.classList.toggle('live', connected);
    }
  }
  const offline = document.querySelector('#reconnecting');
  if (offline) offline.hidden = online.online && !roomError;
}

function observe() {
  const game = sharedGame();
  if (!game) return;
  const key = (room ? room.instance + '/' + room.round : local.id) + '/' + game.revision;
  if (key === seenGame) return;
  seenGame = key;
  const event = game.event;
  if (!event) feedback = null;
  if (event) {
    const label = feedbackText[event.kind] || '';
    const detail = event.answer ? ': ' + event.answer : event.sunk?.length ? ' ' + event.sunk.join(', ') : '';
    feedback = {label: label + detail, kind:event.kind, cell:event.cell, actor:event.actor};
    if (event.actor === role() || !['right','wrong','timeout'].includes(event.kind)) {
      sound(event.kind);
      if (game.revision > 0) notify(label + detail);
    }
  }
  if (game.phase === 'over') sound(game.winner === role() ? 'win' : 'lose');
}

async function move(type, details = {}) {
  const game = sharedGame();
  if (!game || (code && !online.online) || (type === 'resolve' ? resolveBusy : moveBusy)) return;
  const action = {type, revision:game.revision, ...details};
  if (type === 'resolve') resolveBusy = true;
  else moveBusy = true;
  try {
    if (code) {
      await online.move(room, pool, action, board);
    } else {
      const actor = details.actor ?? role();
      const defender = game.turn === 0 ? enemy : board;
      const result = transition(game, config(), pool, actor, action, time(), defender);
      if (result) {
        local.game = result;
        observe();
        render();
      }
    }
  } catch (error) { report(error); }
  finally {
    if (type === 'resolve') resolveBusy = false;
    else moveBusy = false;
    schedule();
  }
}

function schedule() {
  clearTimeout(aiTimer);
  const game = sharedGame();
  if (!game || page !== 'battle' || game.phase === 'over') return;
  if (code) {
    if (online.online && game.phase === 'pending' && game.turn !== role() && board.length) {
      aiTimer = setTimeout(() => move('resolve'), 220);
    }
    return;
  }
  if (game.phase === 'pending') {
    aiTimer = setTimeout(() => move('resolve', {actor:1 - game.turn}), 420);
  } else if (game.turn === 1) {
    aiTimer = setTimeout(() => {
      if (game.phase === 'question') {
        const question = getQuestion(pool, game.seed, game.index);
        const chance = [.65, .82, .95][config().ai - 1];
        move('answer', {actor:1, value:Math.random() < chance ? question.answer : ''});
      } else {
        const cell = chooseShot(config().size, game.p[1].shots || {}, config().ai);
        sound('fire');
        move('fire', {actor:1, cell});
      }
    }, 850);
  }
}

setInterval(() => {
  const game = sharedGame();
  if (code && room && room.expires <= time()) {
    if (online.online && role() === 0) online.expire(code, room).catch(() => {});
    clearLobby();
    notify('Die Lobby ist abgelaufen.', true);
    return;
  }
  if (!game || page !== 'battle' || game.phase !== 'question') return;
  const remaining = Math.max(0, Math.ceil((game.deadline - time()) / 1000));
  const timer = document.querySelector('#timer');
  if (timer) { timer.textContent = remaining + ' s'; timer.classList.toggle('urgent', remaining <= 5); }
  if (!remaining) move('timeout');
}, 250);

function homePage() {
  const actions = [
    ['Lobby erstellen','create'], ['Lobby beitreten','join'], ['Einzelspieler','solo'], ['Spielanleitung','help'],
    ['Fremdwörter lernen','learn'], ['Einstellungen','settings'], ['Lehrermodus','teacher']
  ];
  return el('div', {className:'home-shell'},
    el('section', {className:'hero'},
      el('div', {className:'hero-copy'},
        el('div', {className:'kicker'}, el('span', {className:'signal'}), 'TAKTISCHES WORTDUELL'),
        el('h1', {}, 'WÖRTER', el('span', {}, 'FLOTTE')),
        el('p', {className:'tagline'}, 'Lerne. Ziele. Versenke.'),
        el('p', {className:'intro'}, 'Knacke Fremdwörter, erteile Feuerfreigabe und versenke die gegnerische Flotte.'),
        button('Spielen', () => show('play'), {className:'primary launch'}),
        resume ? button('Partie fortsetzen', guarded(async () => { await network(); attachRoom(resume.code); }), {className:'ghost resume'}) : null),
      el('div', {className:'hero-graphic', ariaHidden:'true'},
        el('div', {className:'water'}), el('div', {className:'sweep'}), el('img', {src:'./assets/ship.svg', alt:''}),
        el('div', {className:'graphic-label'}, el('span', {className:'signal'}), 'MARINE-RADAR'))),
    el('nav', {className:'menu-grid', ariaLabel:'Hauptmenü'},
      actions.map(([label, target], index) => button(el('span', {}, el('span', {className:'menu-icon', ariaHidden:'true'},
        ['⊕','⌗','◈','≡','▤','⚙','◇'][index]), label), () => openPage(target), {className:'menu-button'}))),
    el('footer', {}, 'WÖRTERFLOTTE', el('span', {}, 'Für den Unterricht · allein oder zu zweit')));
}

function openPage(target) {
  if (target === 'learn') learnFilter = undefined;
  show(target);
}

function configurePage(solo) {
  const opts = {...selection};
  const form = el('form');
  const name = el('input', {name:'name', required:true, maxLength:20, autocomplete:'nickname',
    placeholder: solo ? 'Kapitän' : 'Dein Spitzname', value:opts.name});
  if (solo && !name.value) name.value = 'Kapitän';
  const size = select({6:'6 × 6',8:'8 × 8',10:'10 × 10'}, opts.size, {name:'size'});
  const count = select({2:'2 Schiffe',3:'3 Schiffe',4:'4 Schiffe',5:'5 Schiffe'}, opts.count, {name:'count'});
  const limit = select({15:'15 Sekunden',25:'25 Sekunden',45:'45 Sekunden',90:'90 Sekunden'}, opts.time, {name:'time'});
  const mode = select(modes, opts.mode, {name:'mode', onChange: () => {
    if (mode.value === 'quick') { size.value = '6'; count.value = '2'; limit.value = '15'; }
  }});
  const level = select(levels, opts.level, {name:'level'});
  const ai = select(levels, opts.ai, {name:'ai'});
  const special = el('input', {type:'checkbox', checked:opts.special});
  const custom = el('input', {type:'checkbox', checked:opts.custom});
  form.append(el('div', {className:'form-grid'}, field('Spielername', name), field('Spielmodus', mode),
    field('Fragen-Schwierigkeit', level), field('Spielfeldgröße', size), field('Zeit pro Frage', limit), field('Flotte', count),
    solo ? field('Computergegner', ai) : null),
  row(el('label', {className:'check'}, special, ' Spezialfähigkeiten'),
    el('label', {className:'check'}, custom, ' Lokalen Lehrerkatalog verwenden')),
  row(el('button', {type:'submit', className:'primary'}, solo ? 'Zur Schiffsplatzierung' : 'Lobby erstellen'), backLink(goHome)));
  form.addEventListener('submit', guarded(async () => {
    const settings = {name:checkName(name.value), mode:mode.value, level:+level.value, size:+size.value,
      time:+limit.value, count:+count.value, special:special.checked, ai:+ai.value};
    selection = {...settings, custom:custom.checked};
    const questions = custom.checked ? savedCatalog() : catalog;
    prepare(settings, questions);
    try { store('options', selection); } catch { /* Einstellungen gelten für diese Sitzung. */ }
    resetPlacement();
    if (solo) {
      local = {id:seed(), config:settings, catalog:questions};
      show('setup');
    } else {
      const mp = await network();
      attachRoom(await mp.create(settings, questions));
    }
  }));
  return section(solo ? 'Einzelspieler' : 'Lobby erstellen',
    !solo && !configured ? el('p', {className:'notice'}, 'Online-Partien benötigen eine einmalige Firebase-Einrichtung. Einzelspieler und Lernbereich sind verfügbar.') : null,
    form);
}

function checkName(input) {
  const name = input.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!/^[A-Za-zÄÖÜäöüß0-9][A-Za-zÄÖÜäöüß0-9 ._'-]{0,19}$/.test(name)) {
    throw Error('Der Name braucht 1 bis 20 Zeichen. Erlaubt sind Buchstaben, Zahlen, Leerzeichen, Punkt, Bindestrich, Unterstrich und Apostroph.');
  }
  return name;
}

function joinPage() {
  const name = el('input', {required:true,maxLength:20,autocomplete:'nickname',placeholder:'Dein Spitzname',value:selection.name});
  const id = el('input', {required:true,maxLength:4,inputMode:'numeric',pattern:'[1-9][0-9]{3}',placeholder:'4821',
    value:/^[1-9]\d{3}$/.test(initialCode) ? initialCode : '', autocomplete:'off'});
  return section('Lobby beitreten', !configured ? el('p', {className:'notice'}, 'Online-Partien benötigen eine einmalige Firebase-Einrichtung.') : null,
    el('form', {onSubmit:guarded(async () => {
      const nickname = checkName(name.value);
      const mp = await network();
      await mp.join(id.value, nickname);
      selection.name = nickname;
      try { store('options', selection); } catch { /* Name gilt für diese Sitzung. */ }
      attachRoom(id.value);
      sound('join');
    })}, el('div', {className:'form-grid'}, field('Spielername', name), field('Vierstelliger Lobbycode', id)),
    row(el('button', {type:'submit', className:'primary'}, 'Beitreten'), backLink(goHome))));
}

function inviteURL() {
  const url = new URL('./', location.href);
  url.searchParams.set('lobby', code);
  return url.href;
}

let qrModule;
function invite() {
  const url = inviteURL();
  const link = el('input', {readOnly:true, value:url, onFocus:event => event.currentTarget.select()});
  const canvas = el('canvas', {className:'qr-code', width:128, height:128, role:'img', ariaLabel:'QR-Code zur Lobby'});
  const qrStatus = el('span', {className:'muted'}, 'QR-Code lädt …');
  qrModule ||= new Promise((resolve, reject) => {
    const script = el('script', {src:'./js/vendor/qrcode.js',
      onLoad:() => typeof window.qrcode === 'function' ? resolve(window.qrcode) : reject(Error('QR-Modul fehlt.')),
      onError:() => reject(Error('QR-Modul nicht erreichbar.'))});
    document.head.append(script);
  }).catch(error => { qrModule = null; throw error; });
  qrModule.then(makeCode => {
    const qr = makeCode(0, 'M');
    qr.addData(url);
    qr.make();
    const count = qr.getModuleCount();
    const scale = Math.max(2, Math.floor(200 / (count + 8)));
    canvas.width = canvas.height = (count + 8) * scale;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#092238';
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (qr.isDark(y, x)) context.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
      }
    }
    qrStatus.remove();
  }).catch(() => { canvas.hidden = true; qrStatus.textContent = 'QR-Code gerade nicht verfügbar.'; });
  return el('div', {className:'invite'}, el('div', {}, el('span', {className:'muted'}, 'Lobbycode'),
    el('strong', {className:'lobby-code'}, code), field('Einladungslink', link),
    button('Link kopieren', guarded(async () => {
      link.select();
      if (navigator.clipboard) await navigator.clipboard.writeText(url);
      else if (!document.execCommand('copy')) throw Error('Der Link ist markiert und kann manuell kopiert werden.');
      notify('Einladungslink kopiert.');
    }), {className:'small'})), el('div', {}, canvas, qrStatus));
}

function leaveButton() {
  return button(role() === 0 ? 'Lobby auflösen' : 'Lobby verlassen', guarded(async () => {
    if (!room) { clearLobby(); return; }
    if (!online.online) throw Error('Die Verbindung fehlt. Über das Hauptmenü kannst du die Lobby später fortsetzen.');
    const current = room;
    await online.leave(current);
    if (code) clearLobby();
  }), {className:'ghost'});
}

function roomPage() {
  if (!room) return section('Lobby', el('p', {}, roomError || 'Lobby wird geladen …'), backLink(goHome));
  const player = role() === 0 ? room.host : room.guest;
  const waiting = room.stage === 'waiting';
  const players = [room.host, room.guest].map((person, index) => el('div', {className:'player-card'},
    el('span', {className:'muted'}, index === 0 ? 'Gastgeber' : 'Zweiter Spieler'),
    el('strong', {}, person?.name || 'Wartet auf Beitritt'),
    person ? el('span', {className:'presence', id:'presence-' + person.uid}) : null,
    person ? el('span', {}, person.ready ? 'Bereit' : 'Nicht bereit') : null));
  return section('Online-Lobby', el('p', {id:'reconnecting', className:'notice', hidden:true}, 'Verbindung unterbrochen. Die Lobby bleibt gespeichert.'),
    el('p', {className:'muted'}, modes[room.config.mode] + ' · ' + levels[room.config.level] + ' · ' +
      room.config.size + ' × ' + room.config.size + ' · ' + room.config.time + ' s'),
    el('div', {className:'players'}, players), waiting ? invite() : null,
    row(waiting ? button(player.ready ? 'Bereitschaft zurücknehmen' : 'Bereit', guarded(async () => {
      if (!online.online) throw Error('Warte, bis die Verbindung wiederhergestellt ist.');
      await online.ready(room, !player.ready);
    }), {className:'primary'}) : button('Ergebnis anzeigen', () => { showingRoom = false; show('battle'); }),
    waiting && role() === 0 ? button('Spiel starten', guarded(async () => {
      if (!online.online) throw Error('Warte, bis die Verbindung wiederhergestellt ist.');
      await online.start(room);
    }), {disabled:!(room.host.ready && room.guest?.ready)}) : null,
    !waiting ? rematchButton() : null, leaveButton(), backLink(goHome)));
}

function place(cell) {
  const size = config().size;
  if (selected < 0) return;
  const cells = placement(size, cell, specs[selected].length, vertical, board.filter((_, index) => index !== selected));
  if (!cells) {
    render();
    notify('Das Schiff würde überlappen oder aus dem Raster ragen.', true);
    return;
  }
  board[selected] = {...specs[selected], cells};
  selected = specs.findIndex((_, index) => !board[index]);
  setupFocus = cell;
  render();
  document.querySelector('[data-cell="' + cell + '"]')?.focus({preventScroll:true});
}

function grid(title, boardSize, options = {}) {
  const {ships = [], shots = {}, interactive = false, handler, setup = false, impact} = options;
  const gridNode = el('div', {className:'board-grid'});
  gridNode.style.setProperty('--size', boardSize);
  const own = new Map(ships.flatMap(ship => ship ? ship.cells.map((cell, index) => [cell, ship.letters?.[index] || '']) : []));
  gridNode.append(el('span', {className:'axis'}, ''));
  for (let column = 0; column < boardSize; column++) gridNode.append(el('span', {className:'axis'}, column + 1));
  for (let line = 0; line < boardSize; line++) {
    gridNode.append(el('span', {className:'axis'}, String.fromCharCode(65 + line)));
    for (let column = 0; column < boardSize; column++) {
      const index = line * boardSize + column;
      const shot = shots[index];
      const details = {hit:'Treffer',miss:'Fehlschuss',sunk:'Versenkt'}[shot] || (own.has(index) ? 'Eigenes Schiff' : 'Wasser');
      const className = ['cell', shot || (own.has(index) ? 'ship' : 'sea'),
        index === impact ? 'impact' : '', setup && index === setupFocus ? 'selected-cell' : ''].join(' ');
      const props = {className, 'data-cell':index, ariaLabel:coordinates(index, boardSize) + ' · ' + details};
      const content = shot ? {hit:'×', miss:'•', sunk:'✦'}[shot] : own.get(index) || '';
      gridNode.append(interactive && !shot ? button(content, () => handler(index), props) : el('div', {...props, role:'img'}, content));
    }
  }
  return el('section', {className:'board-panel'}, el('h3', {}, title), gridNode);
}

let drag;
window.addEventListener('pointermove', event => {
  if (!drag || drag.pointer !== event.pointerId) return;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8 && !drag.moved) return;
  drag.moved = true;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('button[data-cell]');
  if (target === drag.target) return;
  drag.target?.classList.remove('drag-target');
  drag.target = target;
  target?.classList.add('drag-target');
});
window.addEventListener('pointerup', event => {
  if (!drag || drag.pointer !== event.pointerId) return;
  const current = drag;
  drag = null;
  current.target?.classList.remove('drag-target');
  if (current.moved) {
    selected = current.index;
    if (current.target) place(Number(current.target.dataset.cell));
    else render();
  }
});
window.addEventListener('pointercancel', () => { drag?.target?.classList.remove('drag-target'); drag = null; });

function setupPage() {
  const settings = config();
  const locked = Boolean(code && (role() === 0 ? room.host.placed : room.guest.placed));
  const complete = specs.every((_, index) => Boolean(board[index]));
  const fleet = specs.map((spec, index) => button(el('span', {},
    el('strong', {}, spec.name), el('small', {}, spec.length + ' Felder' + (board[index] ? ' · platziert' : ''))), () => {
    selected = index;
    render();
    document.querySelector('[data-ship="' + index + '"]')?.focus({preventScroll:true});
  }, {
    className:'ship-option' + (selected === index ? ' selected' : ''),
    disabled:locked, 'data-ship':index, ariaPressed:String(selected === index),
    onPointerDown:event => {
      if (!locked && event.isPrimary && event.button === 0) {
        drag = {index, pointer:event.pointerId, x:event.clientX, y:event.clientY, moved:false};
      }
    }
  }));
  return section('Flotte positionieren',
    el('p', {className:'muted'}, locked ? 'Deine Flotte steht. Warte auf die andere Flotte.' :
      'Wähle ein Schiff und tippe auf sein Startfeld. Du kannst Schiffe auch direkt ins Raster ziehen.'),
    code ? el('p', {id:'reconnecting', className:'notice', hidden:true}, 'Offline. Die Partie wird nach dem Verbinden fortgesetzt.') : null,
    el('div', {className:'setup-layout'}, grid('Dein Flottenfeld', settings.size, {ships:board, interactive:!locked, handler:place, setup:true}),
      el('div', {className:'setup-controls'}, el('div', {className:'fleet'}, fleet),
        row(button(vertical ? 'Drehen · senkrecht' : 'Drehen · waagerecht', () => {
          vertical = !vertical;
          render();
          document.querySelector('#rotate')?.focus({preventScroll:true});
        }, {disabled:locked, id:'rotate'}),
        button('Zufällig', () => { board = randomFleet(settings.size, specs); selected = -1; render(); }, {disabled:locked}),
        button('Zurücksetzen', () => { resetPlacement(); render(); }, {disabled:locked})),
        button(locked ? 'Flotte bereit' : 'Flotte bestätigen', guarded(async () => {
          if (code) {
            if (!online.online) throw Error('Warte, bis die Verbindung wiederhergestellt ist.');
            store(boardKey(), board);
            await online.lock(room);
          } else {
            enemy = randomFleet(settings.size, specs);
            local.game = initialGame(settings, seed(), Date.now());
            feedback = null;
            show('battle');
            schedule();
          }
        }), {className:'primary', disabled:locked || !complete}))),
    row(code ? leaveButton() : null, backLink(goHome)));
}

function questionBlock(question, onAnswer, header = []) {
  const input = el('input', {required:true, maxLength:260, placeholder:'Deine Antwort', autocomplete:'off',
    autocapitalize:'off', spellcheck:false, enterKeyHint:'go', 'aria-label':'Deine Antwort'});
  return el('div', {className:'question'},
    row(el('span', {className:'kicker'}, types[question.type]), header),
    el('h3', {}, question.prompt),
    question.options.length
      ? el('div', {className:'options'}, question.options.map(option => button(option, () => onAnswer(option))))
      : el('form', {className:'answer-form', onSubmit:event => {
        event.preventDefault();
        if (input.value.trim()) onAnswer(input.value);
      }}, input, el('button', {type:'submit', className:'primary'}, 'Antwort prüfen')));
}

function powerBar(game) {
  const self = game.p[role()];
  if (!config().special) return null;
  const consumed = game.usedPower === game.index;
  const questions = game.phase === 'question' && game.turn === role();
  const targeting = game.phase === 'target' && game.turn === role() && !consumed && game.remaining === 1;
  const multiple = questions && getQuestion(pool, game.seed, game.index).options.length >= 4;
  return el('div', {className:'powers'}, el('span', {className:'muted'}, 'Spezialfähigkeiten · ' + self.stats.credits + ' Ladungen'),
    row(Object.entries(powers).map(([id, label]) => button(label, () => move('power', {power:id}), {
      className:'small', disabled:!self.stats.credits || (id === 'joker' ? !multiple || game.joker : !targeting || (id === 'shield' && self.shield))
    }))), self.shield ? el('small', {}, 'Dein Schutzschild ist aktiv.') : null);
}

function battlePage() {
  const game = sharedGame();
  if (game.phase === 'over') return resultsPage(game);
  const settings = config();
  const mine = role();
  const ownTurn = game.turn === mine;
  const self = game.p[mine];
  const other = game.p[1 - mine];
  const labels = names();
  const stats = summary(game, mine);
  const timer = Math.max(0, Math.ceil((game.deadline - time()) / 1000));
  const prompt = game.phase === 'pending' ? 'Schuss wird ausgewertet …' : !ownTurn ? 'Dein Gegner ist dran!' :
    game.phase === 'target' ? game.power ? powers[game.power] + ' · Zielfeld wählen' :
      'Feuer frei · ' + game.remaining + (game.remaining === 1 ? ' Schuss' : ' Schüsse') : 'Beantworte die Frage';
  let question;
  if (game.phase === 'question' && ownTurn) {
    question = getQuestion(pool, game.seed, game.index);
    if (game.joker) {
      const decoy = question.options.find(option => option !== question.answer);
      question.options = question.options.filter(option => option === question.answer || option === decoy);
    }
  }
  return el('div', {className:'battle'},
    el('div', {className:'battle-top'},
      el('div', {}, el('span', {className:'kicker'}, modes[settings.mode]), el('h2', {}, labels[mine] + ' gegen ' + labels[1 - mine])),
      el('div', {className:'turn-label' + (ownTurn ? ' your-turn' : '')}, 'Zug ' + (game.index + 1) + ' · ' + labels[game.turn])),
    code ? el('p', {id:'reconnecting', className:'notice', hidden:true}, 'Verbindung unterbrochen. Online-Aktionen werden nach der Wiederverbindung freigegeben.') : null,
    code && !board.length ? el('p', {className:'notice'}, 'Deine Flotte fehlt im lokalen Speicher. Öffne die Partie auf dem Gerät, auf dem du sie platziert hast.') : null,
    el('div', {className:'metrics'},
      ['Eigene Schiffe ' + (settings.count - other.stats.sunk), 'Gegnerische Schiffe ' + (settings.count - self.stats.sunk),
        'Richtig ' + stats.right, 'Falsch ' + stats.wrong, 'Trefferquote ' + stats.accuracy + '%',
        'Ø Antwortzeit ' + stats.average.toFixed(1).replace('.', ',') + ' s'].map(item => el('span', {}, item))),
    el('div', {className:'combat-layout'},
      el('div', {className:'boards'},
        grid('Eigene Flotte', settings.size, {ships:board, shots:other.shots, impact:feedback?.actor !== mine ? feedback?.cell : undefined}),
        grid('Gegnerisches Feld', settings.size, {shots:self.shots, impact:feedback?.actor === mine ? feedback?.cell : undefined,
          interactive:ownTurn && game.phase === 'target', handler:cell => {
            if (!cellAvailable(game, settings, cell)) return;
            sound('fire');
            move('fire', {cell});
          }})),
      el('aside', {className:'combat-controls'},
        feedback && (feedback.actor === mine || !['right','wrong','timeout'].includes(feedback.kind))
          ? el('div', {className:'battle-feedback ' + feedback.kind, role:'status'}, feedback.label) : null,
        question ? questionBlock(question, value => move('answer', {value}),
          el('span', {id:'timer', className:'timer' + (timer <= 5 ? ' urgent' : '')}, timer + ' s'))
          : el('h3', {className:'battle-prompt'}, prompt),
        self.scan ? el('p', {className:'muted'}, 'Letzter Scan um ' + coordinates(self.scan.cell, settings.size) + ': ' + self.scan.count + ' ungetroffene Schiffsteile.') : null,
        powerBar(game))),
    row(code ? leaveButton() : null, backLink(goHome)));
}

function rematchButton() {
  const player = code && (role() === 0 ? room.host : room.guest);
  return button(player?.again ? 'Warte auf Revanche …' : 'Revanche', guarded(async () => {
    if (code) {
      if (!online.online) throw Error('Warte, bis die Verbindung wiederhergestellt ist.');
      await online.rematch(room);
    } else {
      local = {...local, id:seed(), game:null};
      resetPlacement();
      show('setup');
    }
  }), {className:'primary', disabled:Boolean(player?.again)});
}

function resultsPage(game) {
  const labels = names();
  const won = role() === game.winner;
  const stats = summary(game, role());
  const duration = Math.max(0, Math.round((game.finished - game.started) / 1000));
  const keys = {right:'Richtige Antworten', wrong:'Falsche Antworten', sunk:'Versenkte Schiffe',
    best:'Längste richtige Serie', points:'Punkte'};
  return section(won ? 'Sieg!' : 'Niederlage',
    el('p', {}, labels[game.winner] + ' gewinnt gegen ' + labels[1 - game.winner] + '. Spieldauer ' +
      Math.floor(duration / 60) + ' min ' + duration % 60 + ' s.'),
    el('div', {className:'score-grid'}, labels.map((name, index) => {
      const result = summary(game, index);
      return el('article', {className:'player-card'}, el('h3', {}, name),
        el('dl', {}, Object.entries(keys).map(([key, title]) => [el('dt', {}, title), el('dd', {}, result[key])]),
          el('dt', {}, 'Trefferquote'), el('dd', {}, result.accuracy + '%'),
          el('dt', {}, 'Ø Antwortzeit'), el('dd', {}, result.average.toFixed(1).replace('.', ',') + ' s')));
    })),
    el('h3', {}, 'Deine Fragen zum Wiederholen'),
    stats.errors.length ? el('ul', {className:'error-list'}, stats.errors.map(item =>
      el('li', {}, el('strong', {}, item.word), el('span', {}, item.prompt), el('span', {}, 'Richtige Lösung: ' + item.answer))))
      : el('p', {className:'muted'}, 'Alle beantworteten Fragen waren richtig.'),
    row(rematchButton(), button('Neue Partie', () => {
      const target = code ? 'play' : 'solo';
      goHome();
      show(target);
    }), code ? button('Zurück zur Lobby', () => { showingRoom = true; show('room'); }) : null,
    stats.errors.length ? button('Fehler wiederholen', () => {
      learnFilter = {words: stats.errors.map(item => item.word), catalog:activeCatalog, fromBattle:true};
      show('learn');
    }) : null, backLink(goHome)));
}

function helpPage() {
  return section('Spielanleitung', el('ol', {className:'help-list'},
    el('li', {}, 'Erstelle eine Lobby und teile Code oder QR-Link. Beide melden sich bereit und der Gastgeber startet. Im Einzelspieler kannst du direkt beginnen.'),
    el('li', {}, 'Platziere deine Schiffe. Du kannst sie drehen, automatisch verteilen oder einzeln antippen und ziehen.'),
    el('li', {}, 'Beantworte in deinem Zug eine Fremdwörter-Frage. Richtig gibt Feuerfreigabe. Bei einem Fehler oder Ablauf des Zeitlimits wechselt der Zug.'),
    el('li', {}, 'Tippe ein freies Feld der gegnerischen Flotte an. Treffer sind rot, Fehlschüsse weiß und versenkte Schiffe orange. Wer die gegnerische Flotte zuerst versenkt, gewinnt.')),
    el('h3', {}, 'Spezialfähigkeiten'), el('p', {}, 'Wenn aktiviert, gibt es nach je drei richtigen Antworten in Folge eine Ladung (maximal zwei). Pro Zug ist eine Fähigkeit für die Zielphase möglich.'),
    el('ul', {className:'help-list'},
      el('li', {}, 'Radar meldet ungetroffene Schiffsteile in einem 3 × 3-Bereich. Ein regulärer Schuss bleibt.'),
      el('li', {}, 'Doppelschuss erlaubt zwei Schüsse. Der Luftangriff trifft ein Zielfeld samt direkten Nachbarfeldern.'),
      el('li', {}, 'Das Schutzschild blockiert den nächsten direkten Angriff oder Luftangriff.'),
      el('li', {}, 'Der Joker entfernt zwei falsche Antworten einer Frage mit vier Optionen.')), backLink(goHome));
}

function render() {
  if (!catalog) return;
  const pages = {
    home:homePage, create:() => configurePage(false), join:joinPage, solo:() => configurePage(true), room:roomPage,
    setup:setupPage, battle:battlePage, help:helpPage, settings:() => soundsPage(goHome, updateSound),
    teacher:() => teacherPage(savedCatalog(), catalog, changed => {
      if (changed) selection = {...defaults, ...read('options', {})};
      goHome();
    }, notify),
    learn:() => learnPage(learnFilter?.catalog || savedCatalog(), learnFilter?.words, questionBlock, () => {
      if (learnFilter?.fromBattle && sharedGame()) show('battle');
      else goHome();
    }, Boolean(learnFilter?.fromBattle)),
    play:() => section('Spielen', row(button('Lobby erstellen', () => show('create'), {className:'primary'}),
      button('Lobby beitreten', () => show('join')), button('Einzelspieler', () => show('solo')), backLink(goHome)))
  };
  app.replaceChildren(pages[page]());
  if (code) updatePresence();
}

function updateSound() {
  mute.textContent = soundSettings.muted ? 'Ton aus' : 'Ton an';
  mute.setAttribute('aria-pressed', String(soundSettings.muted));
  try { store('sound', soundSettings); } catch { /* Einstellung gilt für diese Sitzung. */ }
}

document.addEventListener('click', event => { if (event.target.closest('button')) sound('click'); }, true);
document.querySelector('#home').addEventListener('click', goHome);
mute.addEventListener('click', () => {
  soundSettings.muted = !soundSettings.muted;
  updateSound();
  if (page === 'settings') render();
});
window.addEventListener('online', updateStatus);
window.addEventListener('offline', updateStatus);
Object.assign(soundSettings, read('sound', {}));
document.documentElement.dataset.theme = read('theme', 'dark');
updateSound();
updateStatus();

async function startApp() {
  try {
    const response = await fetch('./data/fremdwoerter.json');
    if (!response.ok) throw Error('Der Fremdwörterkatalog konnte nicht geladen werden.');
    catalog = validateCatalog(await response.json());
    show(/^[1-9]\d{3}$/.test(initialCode) ? 'join' : 'home');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (error) {
    app.replaceChildren(section('Wörterflotte konnte nicht starten', el('p', {},
      location.protocol === 'file:' ? 'Öffne das Spiel über einen lokalen Webserver oder GitHub Pages.' : error.message),
    button('Neu laden', () => location.reload())));
  }
}

startApp();
