import type { MetadataRoute } from "next";
import { getPublicProfile } from "@/server/modules/storefront/store";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { profile } = await getPublicProfile();
  return {
    name: profile.name,
    short_name: profile.name.length > 12 ? profile.name.split(" ")[0] : profile.name,
    description: profile.tagline || `Order online from ${profile.name}`,
    start_url: "/menu",
    scope: "/",
    display: "standalone",
    background_color: "#fbfaf8",
    theme_color: "#e2622b",
    orientation: "portrait",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
