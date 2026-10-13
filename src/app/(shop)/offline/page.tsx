import { WifiOff } from "lucide-react";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <WifiOff className="size-10 text-muted-foreground" />
      <h1 className="mt-4 text-2xl font-semibold">You are offline</h1>
      <p className="mt-2 text-muted-foreground">Check your internet connection and try again. Your cart is saved on this device.</p>
    </main>
  );
}
