import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/core/auth";

// Better Auth endpoints: /api/auth/sign-in/email, /api/auth/sign-out, /api/auth/get-session …
export const { GET, POST } = toNextJsHandler(auth);
