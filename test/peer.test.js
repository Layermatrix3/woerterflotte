import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {setImmediate as tick} from 'node:timers/promises';
import {PeerOnline, validCode} from '../js/peer-online.js';
import {getQuestion, questionPool, validateCatalog} from '../js/questions.js';

class Channel extends EventEmitter {
  open = false;
  send(data) { queueMicrotask(() => { if (this.open) this.other.emit('data', structuredClone(data)); }); }
  close() {
    if (!this.open) return;
    this.open = this.other.open = false;
    this.emit('close');
    this.other.emit('close');
  }
}
class TestPeer extends EventEmitter {
  static peers = new Map();
  constructor(id = String(Math.random())) {
    super();
    this.id = id;
    TestPeer.peers.set(id, this);
    queueMicrotask(() => this.emit('open', id));
  }
  connect(id) {
    const remote = TestPeer.peers.get(id);
    const outgoing = new Channel(), incoming = new Channel();
    outgoing.peer = id;
    incoming.peer = this.id;
    outgoing.other = incoming;
    incoming.other = outgoing;
    queueMicrotask(() => {
      remote.emit('connection', incoming);
      outgoing.open = incoming.open = true;
      outgoing.emit('open');
    });
    return outgoing;
  }
  destroy() { this.destroyed = true; TestPeer.peers.delete(this.id); }
}
const catalog = validateCatalog(JSON.parse(readFileSync(new URL('../data/fremdwoerter.json', import.meta.url))));
const config = {name:'Lea',size:6,count:2,time:45,special:false,level:2,ai:2,mode:'classic'};

test('Peer-Ablauf: Raumcode, Gast, Sperren, Schussbericht, Wiederverbindung und Verlassen', async () => {
  const host = new PeerOnline(TestPeer, () => {});
  const guest = new PeerOnline(TestPeer, () => {});
  const other = new PeerOnline(TestPeer, () => {});
  try {
    const code = await host.create(config,catalog);
    assert.ok(validCode(code));
    await guest.join(code,'Kim');
    await assert.rejects(other.join(code,'Robin'),/bereits belegt/);
    let home, away;
    host.watch(code, state => { home = state; }, () => {}, assert.fail);
    guest.watch(code, state => { away = state; }, () => {}, assert.fail);
    await tick();
    assert.equal(home.guest.name,'Kim');
    await host.ready(home,true);
    await guest.ready(away,true);
    await tick();
    await host.start(home);
    await tick();
    await guest.lock(away);
    await tick();
    await host.lock(home);
    await tick();
    assert.equal(away.stage,'battle');
    const pool = questionPool(catalog,config.mode,config.level);
    const correct = getQuestion(pool,home.game.seed,home.game.index).answer;
    assert.equal(await guest.move(away,pool,{type:'answer',revision:0,value:correct}),false);
    assert.equal(await host.move(home,pool,{type:'answer',revision:0,value:correct}),true);
    await tick();
    assert.equal(await host.move(home,pool,{type:'fire',revision:1,cell:0}),true);
    await tick();
    const board = [{name:'Sehr geheim',cells:[0,1]}];
    assert.equal(await guest.move(away,pool,{type:'resolve',revision:2},board),true);
    await tick();
    assert.equal(home.game.p[0].shots[0],'hit');
    assert.ok(!JSON.stringify(home).includes('Sehr geheim'));
    assert.equal(away.game.turn,1);
    guest.channel.close();
    assert.equal(guest.online,false);
    await guest.dial();
    assert.equal(guest.online,true);
    await guest.leave(away);
    await tick();
    assert.equal(home.stage,'closed');
  } finally {
    host.stop(); guest.stop(); other.stop();
  }
});
