import QRCode from "qrcode"

export async function ticketQrPngDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 512,
    color: { dark: "#010101", light: "#ffffff" },
  })
}

export async function ticketQrPngBytes(payload: string): Promise<Uint8Array> {
  const buffer = await QRCode.toBuffer(payload, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 512,
    color: { dark: "#010101", light: "#ffffff" },
    type: "png",
  })
  return new Uint8Array(buffer)
}
