'use strict';

/**
 * A skill that does not parse, or a model answer that does not satisfy it.
 * `file` carries the offending path when known, so hosts can point at the
 * source without string-matching the message.
 */
class SkillError extends Error {
  constructor(message, file) {
    super(file ? `loading ${file}: ${message}` : message);
    this.name = 'SkillError';
    this.file = file || null;
  }
}

module.exports = { SkillError };
