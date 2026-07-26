'use strict';

// Proof that every tool.schema is STANDARD JSON Schema: every schema this
// package produces must compile under ajv (draft 2020-12, strict mode) and
// validate/reject real argument objects correctly.

const assert = require('assert');
const { join } = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { parseSkill, parseSkillFile } = require('..');

const skill = parseSkillFile(join(__dirname, 'SKILL.md'));
const [access, stats] = skill.tools;

// 1. Strict compile: ajv in strict mode rejects anything that is not clean,
// standard JSON Schema. Every tool.schema must compile without a warning.
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv); // registers the spec's standard formats (email, uri, ...)

const validateAccess = ajv.compile(access.schema);
const validateStats = ajv.compile(stats.schema);

// 2. The compiled validators enforce what the skill declared.
assert.strictEqual(validateAccess({ operation: 'accept', user: 'x@y.z' }), true);
assert.strictEqual(validateAccess({ user: 'x@y.z' }), true, 'operation has a default, not required');

assert.strictEqual(validateAccess({ operation: 'accept' }), false, 'user is required');
assert.strictEqual(validateAccess({ operation: 'purge', user: 'x@y.z' }), false, 'enum violation');
assert.strictEqual(validateAccess({ operation: 'accept', user: 'not-an-email' }), false, 'format=email enforced');
assert.strictEqual(validateAccess({ operation: 'accept', user: 42 }), false, 'type enforced');

assert.strictEqual(validateStats({}), true);

// 3. Custom formats stay standard: per JSON Schema 2020-12 `format` is an
// annotation, so a schema using an invented format must still compile and
// validate once the validator is told to treat formats as annotations.
const iban = parseSkill(
  '```tool\nid: t\nparams:\n  x:\n    type: string\n    format: iban\nrun: echo $x\n```',
).tools[0];
const annotating = new Ajv2020({ strict: true, validateFormats: false });
const validateIban = annotating.compile(iban.schema);
assert.strictEqual(validateIban({ x: 'ES91 2100 0418 4502 0005 1332' }), true);
assert.strictEqual(validateIban({ x: 7 }), false, 'type still enforced alongside the annotation');

console.log('ajv ok');
