import { ImageResponse } from "next/og";
import { KITCHEN } from "@/lib/config";

// WhatsApp/Facebook link preview. Keep it simple so the PNG stays small (WhatsApp skips images > ~300 KB).
export const alt = `${KITCHEN.name} – weekend pre-orders`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#c2410c",
          color: "white",
        }}
      >
        <div style={{ fontSize: 96, fontWeight: 800 }}>{KITCHEN.name}</div>
        <div style={{ fontSize: 40, marginTop: 16, color: "#ffedd5", maxWidth: 1000 }}>{KITCHEN.tagline}</div>
        <div
          style={{
            display: "flex",
            marginTop: 40,
            fontSize: 34,
            fontWeight: 700,
            background: "white",
            color: "#9a3412",
            padding: "12px 28px",
            borderRadius: 999,
            alignSelf: "flex-start",
          }}
        >
          Pre-order for Sat & Sun · Pay by UPI
        </div>
      </div>
    ),
    size,
  );
}
