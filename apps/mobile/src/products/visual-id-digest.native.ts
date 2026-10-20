export async function digestVisualId(material: string) {
  const { digestStringAsync, CryptoDigestAlgorithm } =
    await import("expo-crypto");
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, material);
}
