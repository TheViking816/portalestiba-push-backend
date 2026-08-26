const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'push', 'notify-new-hire.js'), 'utf8');

test('el correo de activación no repite el mensaje principal en el cuerpo', () => {
    assert.match(source, /<h2>Tu cuenta ya está activada<\/h2><p>Puedes entrar en App CPE y consultar tus datos\.<\/p>/);
    assert.doesNotMatch(source, /<p>Tu cuenta ya está activada\.<\/p>/);
});
