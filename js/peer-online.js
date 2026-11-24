import {initialGame, transition, battleReport} from './game.js';
import {questionPool, validateCatalog} from './questions.js';
import {read, store} from './ui.js';

export const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];
export const validCode = value => /^[A-HJ-NP-Z2-9]{6}$/.test(value);
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const peerId = code => 'woerterflotte-' + code.toLowerCase();
let library;

export async function connect(onStatus) {
  library ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
    script.onload = () => window.Peer ? resolve(window.Peer) : reject(Error('PeerJS konnte nicht geladen werden.'));
    script.onerror = () => reject(Error('Der Signalisierungsdienst konnte nicht geladen werden.'));
    document.head.append(script);
  }).catch(error => { library = null; throw error; });
  return new PeerOnline(await library, onStatus);
}

function localRead(key) { return read('peer-' + key, null); }
function localWrite(key, value) { try { store('peer-' + key, value); } catch { /* Die Sitzung bleibt im Tab verfügbar. */ } }

export class PeerOnline {
  constructor(Peer, onStatus) {
    this.Peer = Peer;
    this.onStatus = onStatus;
    this.uid = localRead('id') || Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
    localWrite('id', this.uid);
    this.online = false;
    this.requests = new Map();
    this.requestNumber = 0;
    this.clock = 0;
  }
  now() { return Date.now() + this.clock; }
  waitForConnection() { return Promise.resolve(); }

  status() {
    this.online = this.isHost ? Boolean(this.peer && !this.peer.destroyed && (!this.peer.disconnected || this.channel?.open)) :
      Boolean(this.channel?.open && this.room);
    this.onStatus(this.online);
    const present = {};
    if (this.room && this.online) {
      present[this.room.host.uid] = true;
      if (this.room.guest && this.channel?.open) present[this.room.guest.uid] = true;
    }
    this.onPresence?.(present);
  }

  async openPeer(id) {
    const peer = id ? new this.Peer(id) : new this.Peer();
    this.peer = peer;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { peer.destroy(); reject(Error('Der Raum konnte nicht verbunden werden.')); }, 12000);
      peer.on('open', () => {
        clearTimeout(timer);
        this.status();
        resolve(peer);
      });
      peer.on('disconnected', () => {
        if (this.peer !== peer) return;
        this.status();
        if (!peer.destroyed) {
          try { peer.reconnect(); } catch { /* Der nächste Beitrittsversuch startet neu. */ }
        }
      });
      peer.on('error', error => {
        clearTimeout(timer);
        reject(error);
        if (this.peer === peer) this.status();
      });
    });
  }

  async create(config, catalog) {
    this.stop();
    this.isHost = true;
    const {name, ...settings} = config;
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), value => alphabet[value & 31]).join('');
      this.code = code;
      this.room = {instance:String(seed()),host:{uid:this.uid,name,ready:false,placed:false},config:settings,
        catalog:JSON.stringify(catalog),stage:'waiting',round:1,expires:Date.now()+86400000};
      try {
        await this.serve();
        this.save();
        return code;
      } catch (error) {
        this.peer?.destroy();
        if (error.type !== 'unavailable-id') { this.stop(); throw error; }
      }
    }
    this.stop();
    throw Error('Kein freier Raumcode. Bitte versuche es noch einmal.');
  }

  async serve() {
    const peer = await this.openPeer(peerId(this.code));
    this.pool = questionPool(validateCatalog(JSON.parse(this.room.catalog)), this.room.config.mode, this.room.config.level);
    peer.on('connection', channel => {
      channel.on('data', message => this.receiveGuest(channel, message));
      channel.on('close', () => {
        if (this.channel !== channel) return;
        this.channel = null;
        this.status();
      });
      channel.on('error', () => channel.close());
    });
  }

  async join(code, name) {
    if (!validCode(code)) throw Error('Bitte gib einen sechsstelligen Raumcode ein.');
    this.stop();
    this.code = code;
    this.guestName = name;
    try {
      await this.openPeer();
      await this.dial();
    } catch (error) {
      this.stop();
      throw Error(error.type === 'peer-unavailable' ? 'Raum nicht gefunden. Prüfe den Code und ob der Gastgeber online ist.' : error.message);
    }
    localWrite('guest-' + code, {name});
  }

  dial() {
    const channel = this.peer.connect(peerId(this.code), {reliable:true});
    this.channel = channel;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { channel.close(); reject(Error('Der Gastgeber antwortet nicht. Prüfe den Raumcode.')); }, 10000);
      channel.on('open', () => channel.send({type:'hello',uid:this.uid,name:this.guestName}));
      channel.on('data', message => {
        if (channel !== this.channel || !message) return;
        if (message.type === 'refused') {
          clearTimeout(timer);
          reject(Error('Der Raum ist bereits belegt oder geschlossen.'));
          channel.close();
        } else if (message.type === 'state') {
          clearTimeout(timer);
          const wasConnected = Boolean(this.room);
          this.room = message.room;
          if (!wasConnected && Number.isFinite(message.now)) this.clock = message.now - Date.now();
          this.status();
          this.onRoom?.(this.room);
          resolve();
        } else if (message.type === 'ack') {
          this.requests.get(message.id)?.(message.ok);
        }
      });
      channel.on('error', error => { clearTimeout(timer); reject(error); });
      channel.on('close', () => {
        clearTimeout(timer);
        reject(Error('Die Verbindung zum Gastgeber wurde getrennt.'));
        if (channel !== this.channel) return;
        this.channel = null;
        for (const finish of this.requests.values()) finish(false);
        this.status();
        this.retry();
      });
    });
  }

  retry() {
    clearTimeout(this.retryTimer);
    if (!this.onRoom || this.isHost || !this.room || this.room.stage === 'closed') return;
    this.retryTimer = setTimeout(async () => {
      if (!this.onRoom || this.channel?.open) return;
      try {
        if (!this.peer || this.peer.destroyed) await this.openPeer();
        await this.dial();
      } catch { this.retry(); }
    }, 3500);
  }

  receiveGuest(channel, message) {
    if (!message || !this.room || this.room.stage === 'closed') return;
    if (message.type === 'hello') {
      const validName = typeof message.name === 'string' && /^[A-Za-zÄÖÜäöüß0-9][A-Za-zÄÖÜäöüß0-9 ._'-]{0,19}$/.test(message.name);
      const accepted = /^[a-f0-9]{32}$/.test(message.uid) && message.uid !== this.uid && validName &&
        (this.room.guest?.uid === message.uid || (!this.room.guest && this.room.stage === 'waiting'));
      if (!accepted || (this.channel?.open && this.channel !== channel && this.channel.peer !== channel.peer)) {
        channel.send({type:'refused'});
        setTimeout(() => channel.close(), 200);
        return;
      }
      this.channel = channel;
      this.room.guest ||= {uid:message.uid,name:message.name,ready:false,placed:false};
      this.publish();
      return;
    }
    if (channel !== this.channel || message.type !== 'action') return;
    const ok = this.apply('guest', message.action);
    channel.send({type:'ack',id:message.id,ok});
  }

  save() { if (this.isHost) localWrite('host-' + this.code, this.room); }
  publish() {
    this.save();
    if (this.channel?.open) this.channel.send({type:'state',room:this.room,now:Date.now()});
    const snapshot = this.room ? JSON.parse(JSON.stringify(this.room)) : null;
    queueMicrotask(() => { this.status(); this.onRoom?.(snapshot); });
  }

  async resume(code) {
    if (this.code === code && this.room) {
      if (!this.isHost && !this.channel?.open) await this.dial();
      return;
    }
    const saved = localRead('host-' + code);
    if (saved?.host.uid === this.uid && saved.expires > Date.now() && saved.stage !== 'closed') {
      this.stop();
      this.isHost = true;
      this.code = code;
      this.room = saved;
      try { await this.serve(); }
      catch (error) { this.stop(); throw error; }
      return;
    }
    const guest = localRead('guest-' + code);
    if (!guest) throw Error('Die gespeicherte Lobby ist auf diesem Gerät nicht verfügbar.');
    await this.join(code, guest.name);
  }

  watch(code, onRoom, onPresence, onError) {
    this.onRoom = onRoom;
    this.onPresence = onPresence;
    if (this.code !== code) { onError(); return; }
    queueMicrotask(() => {
      if (this.onRoom !== onRoom) return;
      this.status();
      onRoom(this.room ? JSON.parse(JSON.stringify(this.room)) : null);
    });
  }

  unwatch() {
    this.onRoom = null;
    this.onPresence = null;
  }

  stop() {
    this.unwatch();
    clearTimeout(this.retryTimer);
    const channel = this.channel;
    this.channel = null;
    channel?.close();
    const peer = this.peer;
    this.peer = null;
    peer?.destroy();
    this.room = null;
    this.code = null;
    this.isHost = false;
    this.clock = 0;
    this.status();
  }

  request(room, action) {
    const command = {...action, instance:room.instance,round:room.round};
    if (this.isHost) return Promise.resolve(this.apply('host',command));
    if (!this.channel?.open) return Promise.resolve(false);
    return new Promise(resolve => {
      const id = ++this.requestNumber;
      const timer = setTimeout(() => this.requests.get(id)?.(false), 5000);
      this.requests.set(id, ok => {
        clearTimeout(timer);
        this.requests.delete(id);
        resolve(ok);
      });
      try { this.channel.send({type:'action',id,action:command}); }
      catch { this.requests.get(id)?.(false); }
    });
  }

  apply(role, action) {
    const room = this.room;
    if (!room || !action || room.instance !== action.instance || room.round !== action.round ||
        room.expires <= Date.now() || !room[role] || room.stage === 'closed') return false;
    const actor = role === 'host' ? 0 : 1;
    const player = room[role];
    if (action.kind === 'ready' && room.stage === 'waiting' && typeof action.value === 'boolean') player.ready = action.value;
    else if (action.kind === 'start' && role === 'host' && room.stage === 'waiting' && room.host.ready &&
        room.guest?.ready && this.channel?.open) room.stage = 'setup';
    else if (action.kind === 'lock' && room.stage === 'setup' && !player.placed) {
      player.placed = true;
      if (room.host.placed && room.guest.placed) {
        room.stage = 'battle';
        room.game = initialGame(room.config, seed(), Date.now());
      }
    } else if (action.kind === 'move' && room.stage === 'battle' && this.channel?.open && action.move) {
      const game = room.game;
      const move = action.move;
      if (move.revision !== game.revision) return false;
      if (role === 'guest' && move.type === 'resolve') {
        if (game.phase !== 'pending' || game.turn !== 0 || !action.result) return false;
        const result = transition(game, room.config, this.pool, actor, move, Date.now(), null, action.result);
        if (!result) return false;
        room.game = result;
      } else {
        const result = transition(game, room.config, this.pool, actor, move, Date.now(), role === 'host' ? action.board : undefined);
        if (!result) return false;
        room.game = result;
      }
    } else if (action.kind === 'again' && room.game?.phase === 'over') {
      player.again = true;
      if (room.host.again && room.guest.again) {
        for (const seat of [room.host,room.guest]) { seat.placed = false; delete seat.again; }
        room.stage = 'setup';
        room.round++;
        delete room.game;
      }
    } else if (action.kind === 'leave') {
      if (role === 'guest' && room.stage === 'waiting') {
        delete room.guest;
        room.host.ready = false;
        const departed = this.channel;
        this.channel = null;
        departed?.send({type:'state',room:null});
        setTimeout(() => departed?.close(), 200);
      } else room.stage = 'closed';
    } else return false;
    this.publish();
    return true;
  }

  ready(room, value) { return this.request(room, {kind:'ready',value}); }
  start(room) { return this.request(room, {kind:'start'}); }
  lock(room) { return this.request(room, {kind:'lock'}); }
  rematch(room) { return this.request(room, {kind:'again'}); }
  async leave(room) {
    const accepted = await this.request(room, {kind:'leave'});
    if (room.host.uid === this.uid || !this.isHost) setTimeout(() => { if (this.code === null || this.room?.instance === room.instance) this.stop(); }, 250);
    return accepted;
  }
  expire(code, room) {
    if (this.code !== code || this.room?.instance !== room.instance || !this.isHost) return Promise.resolve(false);
    this.room.stage = 'closed';
    this.publish();
    setTimeout(() => { if (this.room?.instance === room.instance) this.stop(); }, 250);
    return Promise.resolve(true);
  }

  move(room, pool, move, board) {
    if (!this.isHost && move.type === 'resolve') {
      const evaluated = battleReport(room.game, room.config, board);
      return evaluated ? this.request(room, {kind:'move',move,result:evaluated}) : Promise.resolve(false);
    }
    return this.request(room, this.isHost ? {kind:'move',move,board} : {kind:'move',move});
  }
}
