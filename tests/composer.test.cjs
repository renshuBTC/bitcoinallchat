const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const capture = html.split('\n').find(line => line.includes("QA.addEventListener('keydown'"));
const handler = html.split('\n').find(line => line.startsWith("$('q').onkeydown="));
const footer = html.split('\n').find(line => line.includes("if(qa) qa.addEventListener('keydown'"));
for (const [name, overrides, expected] of [
  ['Enter opens signing', {}, 1],
  ['Shift+Enter inserts a line break', {shiftKey: true}, 0],
  ['IME confirmation does not open signing', {isComposing: true}, 0],
]) {
  test(name, () => {
    let sends = 0, prevented = 0, notices = 0, onCapture, onFooter;
    const input = {addEventListener: (_name, fn) => {onFooter = fn;}}, button = {disabled: false};
    const scope = vm.createContext({
      QA: {addEventListener: (_name, fn) => {onCapture = fn;}},
      $: id => id === 'q' ? input : button,
      send: () => {sends++;},
      armFooter: () => {notices++;},
    });
    vm.runInContext(capture + '\n' + handler + '\n' + footer, scope);
    const event = {key: 'Enter', shiftKey: false, isComposing: false, preventDefault: () => {prevented++;}, ...overrides};
    onCapture(event);
    input.onkeydown(event);
    onFooter(event);
    assert.equal(sends, expected);
    assert.equal(notices, expected);
    if (!expected) assert.equal(prevented, 0);
  });
}
