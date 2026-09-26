'use strict';

/**
 * @file src/utils/shortener.js
 * @description Short code generation utility.
 *
 * Generates a random alphanumeric code of CODE_GEN_LENGTH characters by
 * sampling uniformly from BASE62_CHARSET. No collision check is performed
 * here; the UNIQUE constraint on the `urls` table is the authoritative
 * guard, and the controller handles the resulting 409 if one occurs.
 */

const { BASE62_CHARSET, CODE_GEN_LENGTH } = require('../config');

/**
 * Generate a random Base62 short code.
 *
 * @returns {string} A CODE_GEN_LENGTH-character alphanumeric string.
 */
function generateCode() {
  var code = '';
  for (var i = 0; i < CODE_GEN_LENGTH; i++) {
    var charIndex = Math.floor(Math.random() * BASE62_CHARSET.length);
    code += BASE62_CHARSET[charIndex];
  }
  return code;
}

module.exports = { generateCode };
