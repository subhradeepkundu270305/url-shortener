'use strict';

/**
 * @file src/utils/validator.js
 * @description Pure validation helpers for URLs and short codes.
 *
 * Both functions are side-effect-free: they accept a value, apply rules
 * in order, and return either null (valid) or an error string (invalid).
 * This makes them easy to unit-test without any HTTP or database setup.
 */

const { MAX_URL_LENGTH, CODE_MIN_LENGTH, CODE_MAX_LENGTH } = require('../config');

/**
 * Validate a candidate destination URL.
 *
 * Rules applied in order (first failure short-circuits):
 *  1. Must be a string.
 *  2. Must be non-empty.
 *  3. Must not exceed MAX_URL_LENGTH characters.
 *  4. Must start with `http://` or `https://`.
 *  5. Must not contain any space character.
 *  6. Must contain at least one dot (minimal domain format check).
 *
 * @param {string} url - The URL value to validate.
 * @returns {string|null} An error message, or null if the URL is valid.
 */
function validateUrl(url) {
  if (typeof url !== 'string')                                    return 'url must be string';
  if (url.length === 0)                                           return 'url cannot be empty';
  if (url.length > MAX_URL_LENGTH)                                return 'url too long';
  if (!url.startsWith('http://') && !url.startsWith('https://')) return 'invalid protocol, must be http or https';
  if (url.includes(' '))                                          return 'url cannot contain spaces';
  if (url.split('.').length < 2)                                  return 'invalid domain format';
  return null;
}

/**
 * Validate a custom short code supplied by the caller.
 *
 * @param {string} code - The code value to validate.
 * @returns {string|null} An error message, or null if the code is valid.
 */
function validateCode(code) {
  if (code.length < CODE_MIN_LENGTH) return 'code too short';
  if (code.length > CODE_MAX_LENGTH) return 'code too long';
  return null;
}

module.exports = { validateUrl, validateCode };
