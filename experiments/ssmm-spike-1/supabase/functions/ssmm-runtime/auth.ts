export async function constantTimeSecretMatch(
  supplied: string | null,
  expected: string,
): Promise<boolean> {
  if (supplied === null) return false;
  const encoder = new TextEncoder();
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const actual = new Uint8Array(actualDigest);
  const wanted = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < wanted.length; index++) {
    difference |= actual[index] ^ wanted[index];
  }
  return difference === 0;
}
