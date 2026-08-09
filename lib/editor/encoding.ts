export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("The rendered page could not be encoded for publishing.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] });
}
