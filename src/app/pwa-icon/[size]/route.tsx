import { ImageResponse } from "next/og";
import { getPublicProfile } from "@/server/modules/storefront/store";

/** App icon generated from the business name (no image files to maintain). */
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const px = size === "512" ? 512 : size === "180" ? 180 : 192;
  const { profile } = await getPublicProfile();
  const letters = profile.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #f0743a 0%, #d0501d 100%)",
          color: "white",
          fontSize: px * 0.42,
          fontWeight: 700,
          letterSpacing: -px * 0.01,
        }}
      >
        {letters}
      </div>
    ),
    { width: px, height: px, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
