'use strict';

// @crtrs/skill -- the public surface. One module per piece of the contract:
//
//   parse    SKILL.md -> { tools, rendered, ... }   (src/parse.js)
//   compile  skill -> model-facing system text      (src/compile.js)
//   resolve  model answer -> { tool, args, argv }   (src/resolve.js)
//
// The package never calls a model. You own the loop; it referees both
// directions of the contract: what the model may call, and what it actually
// called. Full types in index.d.ts.

const { SkillError } = require('./error');
const { parseSkill, parseSkillFile, includedFiles } = require('./parse');
const { programs } = require('./argv');
const { compile } = require('./compile');
const { resolve } = require('./resolve');

module.exports = {
  SkillError,
  parseSkill,
  parseSkillFile,
  includedFiles,
  programs,
  compile,
  resolve,
};
