import {firebaseConfig} from './firebase-config.js';
import {initialGame, transition} from './game.js';

const sdk = 'https://www.gstatic.com/firebasejs/10.14.1/';
export const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.databaseURL);
export const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const DAY = 24 * 60 * 60 * 1000;

export async function connect(onStatus) {
  if (!configured) throw Error('Für Online-Partien fehlt die Firebase-Konfiguration.');
  const [{initializeApp}, authApi, db] = await Promise.all([
    import(sdk + 'firebase-app.js'), import(sdk + 'firebase-auth.js'), import(sdk + 'firebase-database.js')
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = authApi.getAuth(app);
  await auth.authStateReady();
  const user = auth.currentUser || (await authApi.signInAnonymously(auth)).user;
  return new Multiplayer(db, db.getDatabase(app), user.uid, onStatus);
}

export class Multiplayer {
  constructor(api, database, uid, onStatus) {
    Object.assign(this, {api, database, uid, online: false, offset: 0, onStatus});
    api.onValue(this.ref('.info/serverTimeOffset'), snapshot => { this.offset = snapshot.val() || 0; });
    this.connectedListeners = new Set();
    api.onValue(this.ref('.info/connected'), snapshot => {
      this.online = snapshot.val() === true;
      onStatus(this.online);
      if (this.online) {
        for (const ready of this.connectedListeners) ready();
        this.markPresent().catch(() => {});
      }
    });
  }

  ref(path) { return this.api.ref(this.database, path); }
  now() { return Date.now() + this.offset; }

  waitForConnection(timeout = 8000) {
    if (this.online) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const connected = () => {
        clearTimeout(timer);
        this.connectedListeners.delete(connected);
        resolve();
      };
      const timer = setTimeout(() => {
        this.connectedListeners.delete(connected);
        reject(Error('Keine Verbindung zur Realtime Database. Prüfe Internet und Firebase-Konfiguration.'));
      }, timeout);
      this.connectedListeners.add(connected);
    });
  }

  async change(code, update) {
    const result = await this.api.runTransaction(this.ref('rooms/' + code), update, {applyLocally: false});
    return result.committed;
  }

  async create(config, catalog) {
    for (let attempt = 0; attempt < 18; attempt++) {
      const code = String(1000 + seed() % 9000);
      const now = this.now();
      const host = {uid: this.uid, name: config.name, ready: false, placed: false};
      const {name, ...settings} = config;
      const serialized = JSON.stringify(catalog);
      if (serialized.length > 160000) throw Error('Dieser Lehrerkatalog ist für eine Online-Lobby zu groß.');
      const room = {instance: String(seed()), host, config: settings, catalog: serialized, stage: 'waiting',
        round: 1, expires: now + DAY - 5000};
      try {
        await this.api.set(this.ref('rooms/' + code), room);
        return code;
      } catch (error) {
        if (!/permission.denied/i.test(error.code || error.message)) throw error;
      }
    }
    throw Error('Es konnte kein freier Lobbycode vergeben werden. Versuche es erneut.');
  }

  async join(code, name) {
    const snapshot = await this.api.get(this.ref('rooms/' + code));
    const room = snapshot.val();
    if (!room || room.expires <= this.now()) throw Error('Diese Lobby wurde nicht gefunden oder ist abgelaufen.');
    if (room.host.uid === this.uid || room.guest?.uid === this.uid) return;
    if (room.guest || room.stage !== 'waiting') throw Error('Die Lobby ist bereits belegt.');
    const joined = await this.change(code, previous => {
      if (!previous) return null;
      if (previous.instance !== room.instance || previous.stage !== 'waiting' || previous.guest) return;
      return {...previous, guest: {uid: this.uid, name, ready: false, placed: false}};
    });
    if (!joined) throw Error('Die Lobby ist inzwischen belegt oder wurde geschlossen.');
  }

  watch(code, onRoom, onPresence, onError) {
    this.unwatch();
    this.code = code;
    this.presenceId = String(seed());
    this.stopRoom = this.api.onValue(this.ref('rooms/' + code), snapshot => onRoom(snapshot.val()), onError);
    this.stopPresence = this.api.onValue(this.ref('presence/' + code), snapshot => onPresence(snapshot.val() || {}), () => {});
    if (this.online) this.markPresent().catch(() => {});
  }

  async markPresent() {
    if (!this.code) return;
    const ref = this.ref('presence/' + this.code + '/' + this.uid + '/' + this.presenceId);
    await this.api.onDisconnect(ref).remove();
    if (!this.code || ref.key !== this.presenceId) return;
    await this.api.set(ref, true);
  }

  unwatch() {
    this.stopRoom?.();
    this.stopPresence?.();
    if (this.code && this.online) this.api.remove(this.ref('presence/' + this.code + '/' + this.uid + '/' + this.presenceId)).catch(() => {});
    this.code = null;
  }

  changeRoom(room, update, code = this.code) {
    return this.change(code, current => {
      if (!current) return null;
      if (current.instance !== room.instance || current.round !== room.round || current.expires <= this.now()) return;
      const role = current.host.uid === this.uid ? 'host' : current.guest?.uid === this.uid ? 'guest' : null;
      if (role) return update(current, role);
    });
  }

  ready(room, value) {
    return this.changeRoom(room, (current, role) => {
      if (current.stage === 'waiting') return {...current, [role]: {...current[role], ready: value}};
    });
  }

  start(room) {
    return this.changeRoom(room, (current, role) => {
      if (role === 'host' && current.stage === 'waiting' && current.host.ready && current.guest?.ready) {
        return {...current, stage: 'setup'};
      }
    });
  }

  lock(room) {
    const gameSeed = seed();
    return this.changeRoom(room, (current, role) => {
      if (current.stage !== 'setup' || current[role].placed) return;
      current[role].placed = true;
      if (current.host.placed && current.guest.placed) {
        current.stage = 'battle';
        current.game = initialGame(current.config, gameSeed, this.now());
      }
      return current;
    });
  }

  move(room, pool, action, board) {
    return this.changeRoom(room, (current, role) => {
      if (current.stage !== 'battle') return;
      const game = transition(current.game, current.config, pool, role === 'host' ? 0 : 1, action, this.now(), board);
      if (game) return {...current, game};
    });
  }

  rematch(room) {
    return this.changeRoom(room, (current, role) => {
      if (current.game?.phase !== 'over') return;
      current[role].again = true;
      if (current.host.again && current.guest.again) {
        for (const player of [current.host, current.guest]) {
          player.placed = false;
          delete player.again;
        }
        current.stage = 'setup';
        current.round++;
        delete current.game;
      }
      return current;
    });
  }

  expire(code, room) {
    return this.change(code, current => {
      if (!current) return null;
      if (current.instance === room.instance && current.host.uid === this.uid && current.expires <= this.now()) return null;
    });
  }

  leave(room) {
    return this.changeRoom(room, (current, role) => {
      if (role === 'host') return null;
      if (current.stage === 'waiting') {
        delete current.guest;
        current.host.ready = false;
      } else {
        current.stage = 'closed';
      }
      return current;
    });
  }
}
