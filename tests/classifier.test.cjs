// Exercise the shipped classifier, without a network or browser dependency.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const classification = html.slice(html.indexOf('const dec=new TextDecoder'), html.indexOf('/* ---------------- render ---------------- */'));
const words = html.slice(html.indexOf('const SAID='), html.indexOf('\nfunction reindex'));
function runtime() {
  const scope = vm.createContext({ TextDecoder, TextEncoder, btoa, scanned: 10 });
  vm.runInContext(classification + '\n' + words + `
    globalThis.classifyText = text => classify(new TextEncoder().encode(text));
    globalThis.visible = (text, count = 1) => {
      const message = classifyText(text);
      wordIndex(Array.from({length: count}, () => message));
      return speech(message);
    };
    globalThis.classifyBytes = bytes => classify(Uint8Array.from(bytes));
    globalThis.variants = texts => {
      const messages = texts.map(classifyText);
      wordIndex(messages); return messages.map(speech);
    };`, scope);
  return scope;
}
const cases = [
  ['Chinese message with a number', '我未来10个月内一定要拿到苏州户口！！！', true],
  ['Chinese sentence', '我们一起建设更好的比特币社区', true],
  ['Japanese', '今日はとても良い天気ですね', true],
  ['Korean', '안녕하세요 여러분 오늘도 좋은 하루 보내세요', true],
  ['Thai without spaces', 'สวัสดีครับทุกคนวันนี้อากาศดีมาก', true],
  ['Russian', 'Всем привет! Хорошего дня!', true],
  ['Arabic', 'مرحباً بالجميع، أتمنى لكم يوماً سعيداً!', true],
  ['Hebrew', 'שלום לכולם, שיהיה לכם יום טוב!', true],
  ['French', 'Bonjour à tous, très heureux d’être ici !', true],
  ['Spanish', '¡Hola! ¿Cómo están todos hoy?', true],
  ['Russian greeting', 'Привет', true],
  ['Arabic greeting', 'مرحباً', true],
  ['Hebrew greeting', 'שלום', true],
  ['Accented word', 'été', true],
  ['Decomposed accent', 'e\u0301te\u0301', true],
  ['Greeting with punctuation', '¡Hola!', true],
  ['Emoji', '👋🌍', true],
  ['Joined family emoji', '👨‍👩‍👧‍👦', true],
  ['Emoticon', ':(', true],
  ['Punctuation', '!!!', true],
  ['English', 'Hello Bitcoin world!', true],
  ['Known marker', 'CNTRPRTY', false],
  ['Known marker in punctuation', '«ordi!»', false],
  ['Token JSON', '{"p":"brc-20","op":"mint","tick":"ordi","amt":"1000"}', false],
  ['Token JSON with Chinese', '{"p":"brc-20","memo":"你好"}', false],
  ['Hex hash', 'abcdef0123456789'.repeat(4), false],
  ['Base64', Buffer.from('a binary protocol payload identifier').toString('base64'), false],
  ['Bridge order', '0x' + 'a'.repeat(40) + ':to:bitcoin', false],
];
for (const [name, text, expected] of cases) {
  test(name, () => assert.equal(runtime().visible(text), expected));
}
test('Repeated markers are suppressed but common greetings remain', () => {
  const app = runtime();
  assert.equal(app.visible('custommarker', 5), false);
  assert.equal(app.visible('hello', 100), true);
});
test('Unicode and punctuation variants share the same frequency', () => {
  assert.ok(runtime().variants(['été', 'e\u0301te\u0301', 'été!', '«été»', 'ÉTÉ']).every(v => !v));
});
test('Binary and control bytes remain data', () => {
  const app = runtime();
  assert.equal(app.classifyBytes([0xff, 0xfe, 0xfd, 0]).kind, 'data');
  assert.equal(app.classifyBytes([1, 2, 3, 4]).kind, 'data');
});
test('PGP messages and images keep their existing classification', () => {
  const app = runtime();
  assert.equal(app.classifyText('-----BEGIN PGP SIGNED MESSAGE-----\nHello Bitcoin').kind, 'pgp');
  assert.equal(app.classifyBytes([0x89, 0x50, 0x4e, 0x47, ...new Array(20).fill(0)]).kind, 'img');
});
