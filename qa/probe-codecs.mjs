export default async function ({ page }) {
  await page.waitForSelector(".home");
  const r = await page.evaluate(async () => {
    const out = { secure: isSecureContext, coi: crossOriginIsolated, hasVD: typeof VideoDecoder, origin: location.origin };
    for (const codec of ["avc1.640028", "avc1.64002a", "avc1.42E01E", "hvc1.1.6.L153.B0", "vp09.00.10.08", "av01.0.08M.08"]) {
      try { out[codec] = (await VideoDecoder.isConfigSupported({ codec, codedWidth: 1920, codedHeight: 1080 })).supported; } catch (e) { out[codec] = "err " + e.message; }
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
}
