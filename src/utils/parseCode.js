function parseCode(text) {
  if (!text) {
    return null;
  }
  const trimmed = String(text).trim();
  const match = trimmed.match(/\bKODI?:\s*(\d+)\b/);
  if (match) {
    return Number(match[1]);
  }
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return null;
}

module.exports = parseCode;
