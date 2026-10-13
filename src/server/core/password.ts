import "server-only";
import { hashPassword, verifyPassword } from "better-auth/crypto";

/** Same scrypt format Better Auth uses, so accounts created here can sign in normally. */
export const hashSecret = (plain: string) => hashPassword(plain);
export const verifySecret = (hash: string, plain: string) => verifyPassword({ hash, password: plain });
