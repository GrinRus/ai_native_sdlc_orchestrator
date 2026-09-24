export function sanitizeMarkdownPreview(value) {
  const input = String(value ?? "");
  const lowercase = input.toLowerCase();
  const output = [];
  let index = 0;
  let textStart = 0;
  while (index < input.length) {
    if (input[index] !== "<") {
      index += 1;
      continue;
    }
    output.push(input.slice(textStart, index));
    if (lowercase.startsWith("<script", index)) {
      const closingStart = lowercase.indexOf("</script", index + 7);
      if (closingStart < 0) {
        index = input.length;
        textStart = index;
        break;
      }
      const closingEnd = input.indexOf(">", closingStart + 2);
      index = closingEnd < 0 ? input.length : closingEnd + 1;
    } else {
      const tagEnd = input.indexOf(">", index + 1);
      if (tagEnd < 0) {
        index = input.length;
        textStart = index;
        break;
      }
      index = tagEnd + 1;
    }
    textStart = index;
  }
  output.push(input.slice(textStart));
  return output.join("").replace(/!\[[^\]]*\]\(https?:\/\/[^)]+\)/giu, "[remote embed omitted]");
}
