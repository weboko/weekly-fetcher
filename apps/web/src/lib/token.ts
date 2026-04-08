let encoderPromise: Promise<{ encode: (input: string) => number[] }> | null = null;

async function getEncoder() {
  if (!encoderPromise) {
    encoderPromise = import("js-tiktoken").then(({ getEncoding }) => getEncoding("o200k_base"));
  }

  return encoderPromise;
}

export async function estimateTokens(input: string): Promise<number> {
  try {
    const encoder = await getEncoder();
    return encoder.encode(input).length;
  } catch {
    return Math.ceil(input.length / 4);
  }
}
