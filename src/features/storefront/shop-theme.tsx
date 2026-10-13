"use client";

import { useEffect } from "react";

/**
 * Applies the website theme to <html> as well, so pop-ups rendered outside the
 * page (item dialog, cart sheet, toasts) match. The server-rendered wrapper
 * already carries the same class and colours for the first paint. Restores the
 * previous state when leaving the shop (staff screens have their own theme).
 */
export function ShopTheme({ dark, brand, brandForeground }: { dark: boolean; brand: string | null; brandForeground: string | null }) {
  useEffect(() => {
    const html = document.documentElement;
    const hadDark = html.classList.contains("dark");
    const prev = { brand: html.style.getPropertyValue("--brand"), fg: html.style.getPropertyValue("--brand-foreground"), scheme: html.style.colorScheme };
    if (dark) {
      html.classList.add("dark");
      html.style.colorScheme = "dark";
    }
    if (brand) html.style.setProperty("--brand", brand);
    if (brandForeground) html.style.setProperty("--brand-foreground", brandForeground);
    return () => {
      if (dark && !hadDark) html.classList.remove("dark");
      html.style.colorScheme = prev.scheme;
      if (prev.brand) html.style.setProperty("--brand", prev.brand);
      else html.style.removeProperty("--brand");
      if (prev.fg) html.style.setProperty("--brand-foreground", prev.fg);
      else html.style.removeProperty("--brand-foreground");
    };
  }, [dark, brand, brandForeground]);
  return null;
}
