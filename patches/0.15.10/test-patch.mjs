import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatGateway, SOURCE_QQ, SOURCE_PROACTIVE } from './lib/gateway.js';
import { askedForVoice } from './lib/voice.js';
import { LlmRouter } from './lib/llm.js';

function gateway({ speak = 'mirror', maxChars = 10, synthesize, hasQueued = false } = {}) {
	const sent = [];
	const journal = [];
	const notes = [];
	const queue = [];
	const synthesized = [];
	const g = Object.create(ChatGateway.prototype);
	Object.assign(g, {
		bound: new Map([['s', { channel_id: 'group:1', title: 'test', workspace_path: '.' }]]),
		interjectTurns: new Set(), turns: new Map(), turnMood: new Map(),
		waiters: new Map(), follow: new Map(), lastSpoke: new Map(), closedUntil: new Map(),
		soul: { journalOut: (_id, text) => journal.push(text), recallInfo: () => [] },
		stickers: null, slang: null,
		voice: {
			readyFor: () => true,
			getConfig: () => ({ maxChars, speak }),
			synthesize: async (text) => {
				synthesized.push(text);
				return synthesize ? synthesize(text) : Buffer.from('audio');
			}
		},
		channel: { send: async (_id, segs) => { sent.push(segs); return String(sent.length); } },
		outbox: { hasQueued: () => hasQueued, enqueue: (item) => queue.push(item) },
		moodOf: () => ({ delay: 0 }), moodPick: (_m, images) => images,
		cleanOut: (text) => text, moodVoice: () => true,
		voiceFailReason: () => 'TTS unavailable', note: (kind, data) => notes.push({ kind, ...data }),
		firstDelay: () => 0, sleep: async () => {}, rememberOwn: () => {},
		qqConfig: () => ({ followUpCount: 0, followUpSmart: false }),
		getConfig: () => ({ voice: { maxChars, speak } }), random: () => 0.5,
		log: () => {}, resolveImageFile: () => ({ type: 'image', data: { file: 'image' } })
	});
	return { g, sent, journal, notes, queue, synthesized };
}

test('voice intent recognition', () => {
	for (const text of ['唱首歌来听听', '发条语音', '怎么又变成文字了', '别打字']) {
		assert.equal(askedForVoice([{ text }]), true, text);
	}
	for (const text of ['你好', '我发了个语音给你', '这个语音很好听']) {
		assert.equal(askedForVoice([{ text }]), false, text);
	}
});

test('middle marker preserves text and voice, quote and journal', async () => {
	const { g, sent, journal, synthesized } = gateway();
	await g.sendReply('s', { text: '好的【语音】你好世界', replyTo: '42', images: [] });
	assert.equal(sent.length, 2);
	assert.equal(sent[0][0].type, 'reply');
	assert.equal(sent[0][0].data.id, '42');
	assert.equal(sent[1][0].type, 'record');
	assert.deepEqual(synthesized, ['你好世界']);
	assert.equal(journal[0], '好的\n[语音] 你好世界');
});

test('voice requested without marker, split Unicode without loss and preserve cap', async () => {
	const { g, sent, synthesized } = gateway();
	const text = '😀😀😀😀😀，甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥';
	await g.sendReply('s', { text, voiceAsked: true, images: [] });
	assert.ok(synthesized.every((s) => [...s].length <= 10));
	assert.equal(sent.filter((m) => m[0].type === 'record').length, 3);
	assert.ok(sent.slice(3).every((m) => m[0].type === 'text'));
	assert.equal(synthesized.join('') + sent.slice(3).map((m) => m[0].data.text).join(''), text);
});

test('explicit never setting is respected when asked for voice', async () => {
	const { g, sent, synthesized } = gateway({ speak: 'never' });
	await g.sendReply('s', { text: '只能发文字了', voiceAsked: true, images: [] });
	assert.equal(synthesized.length, 0);
	assert.equal(sent[0][0].type, 'text');
});

test('TTS failure falls back to text and logs filtered event', async () => {
	const { g, sent, notes } = gateway({ synthesize: async () => null });
	await g.sendReply('s', { text: '[语音]你好', images: [] });
	assert.equal(sent[0][0].type, 'text');
	assert.equal(sent[0][0].data.text, '你好');
	assert.ok(notes.some((n) => n.kind === 'filtered' && n.reason.includes('语音没发成')));
});

test('deduplication keeps upstream paragraph tracking after voice split', async () => {
	const { g, sent } = gateway();
	const text = '[语音]这是一条超过十二个字而且需要拆分的完整消息内容';
	await g.sendReply('s', { text, images: [] });
	const count = sent.length;
	await g.sendReply('s', { text, images: [] });
	assert.equal(sent.length, count);
});

test('queued messages are not immediately recorded as sent', async () => {
	const { g, sent, queue } = gateway({ hasQueued: true });
	await g.sendReply('s', { text: '这是排队发送但还没有发出去的消息', images: [] });
	assert.equal(sent.length, 0);
	assert.ok(queue.length > 0);
	assert.equal(g.recentSent?.size ?? 0, 0);
});

test('reply and voice intent travel with the source turn', () => {
	const { g } = gateway();
	g.onSessionEvent({ id: 's' }, { type: 'user/message', data: { message: { id: 'm1', source: { kind: SOURCE_QQ, replyTo: 'r1', voiceAsked: true } } } });
	assert.equal(g.turns.get('s').replyTo, 'r1');
	assert.equal(g.turns.get('s').voiceAsked, true);
	g.onSessionEvent({ id: 's' }, { type: 'user/message', data: { message: { id: 'm2', source: { kind: SOURCE_PROACTIVE } } } });
	assert.equal(g.turns.get('s').replyTo, null);
	assert.equal(g.turns.get('s').voiceAsked, false);
});

test('temperature retry survives empty-response retry without looping', async () => {
	const requests = [];
	const ctx = {
		llm: {
			stream: async function* (request) {
				requests.push(request);
				if (requests.length === 1) throw new Error("Unsupported parameter: 'temperature'");
				if (requests.length === 2) return;
				yield { type: 'text-delta', text: 'success' };
			}
		}
	};
	const router = new LlmRouter({ ctx, db: {}, getConfig: () => ({}) });
	router.record = () => {};
	router.resolve = async () => ({ provider: 'p', model: 'm' });
	assert.equal(await router.call('prompt'), 'success');
	assert.equal(requests.length, 3);
	assert.equal(requests[0].temperature, 0.7);
	assert.ok(!('temperature' in requests[1]));
	assert.ok(!('temperature' in requests[2]));
});

test('unrelated errors mentioning temperature do not trigger special retry', async () => {
	let count = 0;
	const ctx = { llm: { stream: async function* () { count++; throw new Error('temperature service timeout'); } } };
	const router = new LlmRouter({ ctx, db: {}, getConfig: () => ({}) });
	router.record = () => {};
	router.resolve = async () => ({ provider: 'p', model: 'm' });
	assert.equal(await router.call('prompt'), null);
	assert.equal(count, 1);
});
