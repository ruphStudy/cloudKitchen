import { ImageResponse } from "next/og";
import { KITCHEN } from "@/lib/config";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon for iOS/Android "Add to home screen". */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#c2410c",
          color: "#fff7ed",
          fontSize: 88,
          fontWeight: 800,
        }}
      >
        {KITCHEN.name
          .split(/\s+/)
          .map((w) => w[0])
          .join("")
          .slice(0, 2)
          .toUpperCase()}
      </div>
    ),
    size,
  );
}
