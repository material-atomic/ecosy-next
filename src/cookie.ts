import "server-only";
import { cookies } from "next/headers";
import { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import { IS_PROD } from "./utils";

export class Cookie {
  static async get(name: string): Promise<string | null> {
    const cookieStore = await cookies();
    return cookieStore.get(name)?.value || null;
  }

  static async set(name: string, value: string, options?: Partial<ResponseCookie>): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.set(name, value, Object.assign({
      httpOnly: true,
      secure: IS_PROD,
      sameSite: "lax",
      path: "/",
    }, options));
  }

  static async delete(name: string): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(name);
  }

  static async has(name: string): Promise<boolean> {
    const cookieStore = await cookies();
    return cookieStore.has(name);
  }
}
