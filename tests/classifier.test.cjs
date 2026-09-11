// Exercise the shipped classifier, without a network or browser dependency.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const classification = html.slice(html.indexOf('const dec=new TextDecoder'), html.indexOf('/* ---------------- render ---------------- */'));
const words = html.slice(html.indexOf('const MARK='), html.indexOf('\nfunction reindex'));
function runtime() {
  const scope = vm.createContext({ TextDecoder, TextEncoder, btoa, scanned: 10 });
  vm.runInContext(classification + '\n' + words + `
    globalThis.classifyText = text => classify(new TextEncoder().encode(text));
    globalThis.visible = (text, count = 1) => {
      const message = classifyText(text);
      return Array.from({length: count}, () => message).every(speech);
    };
    globalThis.classifyBytes = bytes => classify(Uint8Array.from(bytes));
    globalThis.classifyPayloadBytes = bytes => classifyPayload(Uint8Array.from(bytes));
    globalThis.variants = texts => {
      const messages = texts.map(classifyText);
      return messages.map(speech);
    };`, scope);
  return scope;
}
const cases = [
  ['Chinese message with a number', '我未来10个月内一定要拿到苏州户口！！！', true],
  ['Chinese sentence', '我们一起建设更好的比特币社区', true],
  ['Japanese', '今日はとても良い天気ですね', true],
  ['Korean', '안녕하세요 여러분 오늘도 좋은 하루 보내세요', true],
  ['Thai without spaces', 'สวัสดีครับทุกคนวันนี้อากาศดีมาก', true],
  ['Lao without spaces', 'ສະບາຍດີທຸກຄົນ', true],
  ['Khmer without spaces', 'សួស្តីអ្នកទាំងអស់គ្នា', true],
  ['Burmese without spaces', 'အားလုံးမင်္ဂလာပါ', true],
  ['Hindi', 'सभी को नमस्ते', true],
  ['Bengali', 'সবাইকে শুভেচ্ছা', true],
  ['Gujarati', 'નમસ્તે મિત્રો', true],
  ['Punjabi', 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ', true],
  ['Tamil', 'அனைவருக்கும் வணக்கம்', true],
  ['Telugu', 'అందరికీ నమస్కారం', true],
  ['Kannada', 'ಎಲ್ಲರಿಗೂ ನಮಸ್ಕಾರ', true],
  ['Malayalam', 'എല്ലാവർക്കും നമസ്കാരം', true],
  ['Odia', 'ସମସ୍ତଙ୍କୁ ନମସ୍କାର', true],
  ['Sinhala', 'ආයුබෝවන් හැමෝටම', true],
  ['Nepali', 'सबैलाई नमस्कार', true],
  ['Urdu', 'سب کو سلام', true],
  ['Persian', 'سلام به همه', true],
  ['Greek', 'Γεια σας φίλοι', true],
  ['Armenian', 'Բարեւ բոլորին', true],
  ['Georgian', 'გამარჯობა ყველას', true],
  ['Amharic', 'ሰላም ለሁላችሁ', true],
  ['Tifinagh', 'ⴰⵣⵓⵍ ⴼⵍⵍⴰⵡⵏ', true],
  ['Cherokee', 'ᎣᏏᏲ ᎤᎵᎮᎵᏍᏗ', true],
  ['Inuktitut syllabics', 'ᐊᐃ ᓄᓇᕗᑦ', true],
  ['Thaana combining vowels', 'ސަލާމް', true],
  ['Syriac', 'ܫܠܡܐ', true],
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
  ['Persian zero-width non-joiner', 'می\u200cخواهم', true],
  ['Hindi zero-width joiner', 'क्\u200dषमा', true],
  ['Mongolian vowel separator', 'ᠪᠠᠢᠨ\u180eᠠ', true],
  ['Tibetan tsek-separated words', 'ཁྱེད་རང་ག་འདྲ་འདུག', true],
  ['Dzongkha greeting', 'ཀུ་ཟུ་བཟང་པོ།', true],
  ['Amharic Ethiopic wordspace', 'ሰላም\u1361ለሁላችሁ', true],
  ['Persian with right-to-left mark', '\u200fسلام', true],
  ['Arabic directional isolation', '\u2067مرحبا\u2069', true],
  ['Vietnamese one-letter acknowledgement', 'Ừ', true],
  ['Tamil one-letter interjection', 'ஓ', true],
  ['Zero-width word separator', 'Hello\u200bworld', true],
  ['Tab-separated chat', 'Hi\tall', true],
  ['German long compound', 'Donaudampfschifffahrtsgesellschaft', true],
  ['Lowercase long compound', 'donaudampfschifffahrtsgesellschaft', true],
  ['Fully vocalized Arabic', 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ', true],
  ['Vocalized Hebrew', 'שָׁלוֹם לְכוּלָּם', true],
  ['Emoji', '👋🌍', true],
  ['Joined family emoji', '👨‍👩‍👧‍👦', true],
  ['Emoji-only message longer than the prose threshold', '👨‍👩‍👧‍👦 👨‍👩‍👧‍👦 👨‍👩‍👧‍👦', true],
  ['Emoticon', ':(', true],
  ['Punctuation', '!!!', true],
  ['English', 'Hello Bitcoin world!', true],
  ['Known marker', 'CNTRPRTY', false],
  ['Known marker in punctuation', '«ordi!»', false],
  ['Known marker with a joiner', 'o\u200drdi', false],
  ['Known marker with RTL formatting', '\u2067CNTRPRTY\u2069', false],
  ['Formatting controls alone', '\u200b\u200c\u200d\u200e\u200f\u2067\u2069', false],
  ['Combining marks alone', '\u0301\u0300\u0302', false],
  ['Token JSON', '{"p":"brc-20","op":"mint","tick":"ordi","amt":"1000"}', false],
  ['Token JSON with Chinese', '{"p":"brc-20","memo":"你好"}', false],
  ['Token JSON inside directional controls', '\u2067{"p":"brc-20","memo":"你好"}\u2069', false],
  ['Hex hash', 'abcdef0123456789'.repeat(4), false],
  ['Alphabetic hex hash', 'abcdef'.repeat(11), false],
  ['Base64', Buffer.from('a binary protocol payload identifier').toString('base64'), false],
  ['Unpadded alphabetic base64', 'TWFu'.repeat(16), false],
  ['Bridge order', '0x' + 'a'.repeat(40) + ':to:bitcoin', false],
];
for (const [name, text, expected] of cases) {
  test(name, () => assert.equal(runtime().visible(text), expected));
}
test('Repeated human words remain visible across languages while known markers stay excluded', () => {
  const app = runtime();
  for (const greeting of ['hello', 'bonjour', 'gracias', 'مرحبا', 'שלום', 'नमस्ते', 'Ừ']) {
    assert.equal(app.visible(greeting, 100), true, greeting);
  }
  assert.equal(app.visible('CNTRPRTY', 100), false);
  assert.equal(app.visible('ordi', 100), false);
  assert.equal(app.visible('hello', 100), true);
});
test('Canonical accent and punctuation variants do not hide human words', () => {
  assert.ok(runtime().variants(['été', 'e\u0301te\u0301', 'été!', '«été»', 'ÉTÉ']).every(Boolean));
});
test('Known markers remain excluded when spelling uses formatting or punctuation', () => {
  assert.ok(runtime().variants(['ordi', 'ORDI', '«ordi!»', 'o\u200drdi', '\u2067ordi\u2069']).every(v => !v));
});

test('Classification preserves original joins, separators, accents and direction controls', () => {
  const app = runtime();
  for (const text of ['می\u200cخواهم', 'क्\u200dषमा', 'ᠪᠠᠢᠨ\u180eᠠ', 'Hello\u200bworld',
    'ሰላም\u1361ለሁላችሁ', '\u2067مرحبا\u2069', 'e\u0301te\u0301', 'Hi\tall']) {
    assert.equal(app.classifyText(text).text, text);
  }
});

test('Binary and control bytes remain data', () => {
  const app = runtime();
  assert.equal(app.classifyBytes([0xff, 0xfe, 0xfd, 0]).kind, 'data');
  assert.equal(app.classifyBytes([1, 2, 3, 4]).kind, 'data');
});
test('PGP messages remain text while binary payloads stay outside Conversation', () => {
  const app = runtime();
  assert.equal(app.classifyText('-----BEGIN PGP SIGNED MESSAGE-----\nHello Bitcoin').kind, 'pgp');
  assert.equal(app.classifyBytes([0x89, 0x50, 0x4e, 0x47, ...new Array(20).fill(0)]).kind, 'data');
});

test('Reply detection does not decode arbitrary binary or PNG headers as UTF-8', () => {
  const app = runtime();
  assert.equal(app.classifyPayloadBytes([0xff, 0x0a, 0x01]).kind, 'data');
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(20).fill(0)];
  assert.equal(app.classifyPayloadBytes(png).kind, 'data');
  assert.equal(app.classifyPayloadBytes(png).replyTo, '');
});
