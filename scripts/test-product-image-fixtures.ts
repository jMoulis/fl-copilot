import sharp from "sharp";
/** Deliberately synthetic alpha fixture, never a generated product photograph. */
export async function alphaProductImageFixture() {
  return new Uint8Array(
    await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 600,
              height: 600,
              channels: 4,
              background: { r: 200, g: 0, b: 0, alpha: 1 },
            },
          })
            .png()
            .toBuffer(),
          left: 212,
          top: 212,
        },
      ])
      .png()
      .toBuffer(),
  );
}
