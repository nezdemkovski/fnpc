import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { MastraAuthProvider } from "@mastra/core/server";
import type { ISSOProvider, ISessionProvider, Session, User } from "@mastra/core/auth";
import type { HonoRequest } from "hono";

export type SharedAuthConfig = {
  baseUrl: string;
  jwksUrl: string;
  issuer: string;
  audience: string;
  sessionSecret: string;
};

type SharedAuthUser = User & {
  emailVerified?: boolean;
};

type SharedAuthSession = Session & {
  authCookie: string;
};

const MASTRA_SESSION_COOKIE = "mastra-token";
const AUTH_FLOW_COOKIE = "fnpc-auth-flow";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const FLOW_MAX_AGE_SECONDS = 10 * 60;

export class SharedAuthProvider
  extends MastraAuthProvider<SharedAuthUser>
  implements ISSOProvider<SharedAuthUser>, ISessionProvider<SharedAuthSession>
{
  readonly isSimpleAuth = true;

  private readonly authOrigin: string;
  private readonly project: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private callbackCookieHeader = "";

  constructor(private readonly config: SharedAuthConfig) {
    super({ name: "shared-auth" });

    const baseUrl = new URL(config.baseUrl);
    const match = baseUrl.pathname.match(/^\/api\/([^/]+)\/auth\/?$/);
    if (!match) {
      throw new Error("AUTH_BASE_URL must look like https://host/api/<realm>/auth");
    }

    this.authOrigin = baseUrl.origin;
    this.project = match[1];
    this.jwks = createRemoteJWKSet(new URL(config.jwksUrl));
  }

  getLoginButtonConfig() {
    return {
      provider: "shared-auth",
      text: "Sign in with Auth",
      description: "Use the shared homelab auth service.",
    };
  }

  getLoginUrl(redirectUri: string, state: string) {
    const loginUrl = new URL(`/login/${this.project}`, this.authOrigin);
    loginUrl.searchParams.set("redirect_uri", redirectUri);
    loginUrl.searchParams.set("state", state);
    loginUrl.searchParams.set("mode", "login");
    loginUrl.searchParams.set("code_challenge", this.pkceChallenge(redirectUri, state));
    loginUrl.searchParams.set("code_challenge_method", "S256");
    return loginUrl.toString();
  }

  getLoginCookies(redirectUri: string, state: string) {
    return [
      this.cookie(
        AUTH_FLOW_COOKIE,
        this.seal({ redirectUri, state }),
        FLOW_MAX_AGE_SECONDS,
      ),
    ];
  }

  setCallbackCookieHeader(cookieHeader: string | null) {
    this.callbackCookieHeader = cookieHeader ?? "";
  }

  async handleCallback(code: string, state: string) {
    const flow = this.unseal<{ redirectUri: string; state: string }>(
      parseCookie(this.callbackCookieHeader).get(AUTH_FLOW_COOKIE) ?? "",
    );
    if (!flow || flow.state !== state) {
      throw new Error("Invalid auth flow");
    }

    const response = await fetch(this.realmApiUrl("/login/token"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        redirect_uri: flow.redirectUri,
        code_verifier: this.pkceVerifier(flow.redirectUri, state),
      }),
    });

    if (!response.ok) {
      throw new Error(`Auth token exchange failed with ${response.status}`);
    }

    const payload = await response.json().catch(() => null);
    const authCookie = typeof payload?.sessionCookie === "string" ? payload.sessionCookie : "";
    if (!authCookie) {
      throw new Error("Auth session cookie is missing");
    }

    const token = await this.jwtFromAuthCookie(authCookie);
    const user = await this.verifyJwt(token);

    return {
      user,
      tokens: {
        accessToken: token,
      },
      cookies: [
        this.cookie(
          MASTRA_SESSION_COOKIE,
          this.seal({
            id: randomBytes(16).toString("base64url"),
            userId: user.id,
            authCookie,
            createdAt: Date.now(),
            expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
          }),
          SESSION_MAX_AGE_SECONDS,
        ),
        this.clearCookie(AUTH_FLOW_COOKIE),
      ],
    };
  }

  async authenticateToken(token: string, request: HonoRequest) {
    const bearerUser = await this.verifyJwtOrNull(token);
    if (bearerUser) return bearerUser;

    const sessionCookie =
      token ||
      parseCookie(request.header("cookie") ?? "").get(MASTRA_SESSION_COOKIE) ||
      "";
    const session = await this.validateSession(sessionCookie);
    if (!session) return null;

    return this.userFromAuthCookie(session.authCookie);
  }

  authorizeUser() {
    return true;
  }

  mapUserToResourceId(user: SharedAuthUser) {
    return user.id;
  }

  async createSession(userId: string, metadata?: Record<string, unknown>) {
    const authCookie = typeof metadata?.authCookie === "string" ? metadata.authCookie : "";
    if (!authCookie) {
      throw new Error("authCookie metadata is required");
    }

    return {
      id: randomBytes(16).toString("base64url"),
      userId,
      authCookie,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    };
  }

  async validateSession(sessionId: string) {
    const payload = this.unseal<{
      id: string;
      userId: string;
      authCookie: string;
      createdAt: number;
      expiresAt: number;
    }>(sessionId);
    if (!payload || payload.expiresAt <= Date.now()) return null;

    return {
      id: payload.id,
      userId: payload.userId,
      authCookie: payload.authCookie,
      createdAt: new Date(payload.createdAt),
      expiresAt: new Date(payload.expiresAt),
    };
  }

  async destroySession() {
    return;
  }

  async refreshSession(sessionId: string) {
    const session = await this.validateSession(sessionId);
    if (!session) return null;

    return {
      ...session,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    };
  }

  getSessionIdFromRequest(request: Request) {
    return parseCookie(request.headers.get("cookie") ?? "").get(MASTRA_SESSION_COOKIE) ?? null;
  }

  getSessionHeaders(session: SharedAuthSession) {
    return {
      "Set-Cookie": this.cookie(
        MASTRA_SESSION_COOKIE,
        this.seal({
          id: session.id,
          userId: session.userId,
          authCookie: session.authCookie,
          createdAt: session.createdAt.getTime(),
          expiresAt: session.expiresAt.getTime(),
        }),
        SESSION_MAX_AGE_SECONDS,
      ),
    };
  }

  getClearSessionHeaders() {
    return {
      "Set-Cookie": this.clearCookie(MASTRA_SESSION_COOKIE),
    };
  }

  async getCurrentUser(request: Request) {
    const sessionId = this.getSessionIdFromRequest(request);
    const session = sessionId ? await this.validateSession(sessionId) : null;
    if (!session) return null;
    return this.userFromAuthCookie(session.authCookie);
  }

  async getUser(userId: string) {
    return { id: userId };
  }

  private realmApiUrl(path: string) {
    return `${this.authOrigin}/api/${this.project}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private authApiUrl(path: string) {
    return `${this.config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private async userFromAuthCookie(authCookie: string) {
    const token = await this.jwtFromAuthCookie(authCookie);
    return this.verifyJwt(token);
  }

  private async jwtFromAuthCookie(authCookie: string) {
    const response = await fetch(this.authApiUrl("/get-session"), {
      headers: { Cookie: authCookie },
    });
    if (!response.ok) {
      throw new Error("Auth session is invalid");
    }

    const token = response.headers.get("set-auth-jwt");
    if (!token) {
      throw new Error("Auth JWT is missing");
    }
    return token;
  }

  private async verifyJwtOrNull(token: string) {
    try {
      return await this.verifyJwt(token);
    } catch {
      return null;
    }
  }

  private async verifyJwt(token: string): Promise<SharedAuthUser> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.config.issuer,
      audience: this.acceptedAudiences(),
    });

    if (!payload.sub) {
      throw new Error("JWT subject is missing");
    }

    return {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
      emailVerified: payload.email_verified === true,
    };
  }

  private acceptedAudiences() {
    const audiences = this.config.audience
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (audiences.length === 0) return undefined;
    if (audiences.length === 1) return audiences[0];
    return audiences;
  }

  private pkceVerifier(redirectUri: string, state: string) {
    return createHmac("sha256", this.config.sessionSecret)
      .update(`fnpc:pkce:${redirectUri}:${state}`)
      .digest("base64url");
  }

  private pkceChallenge(redirectUri: string, state: string) {
    return createHash("sha256")
      .update(this.pkceVerifier(redirectUri, state))
      .digest("base64url");
  }

  private key() {
    return createHash("sha256").update(this.config.sessionSecret).digest();
  }

  private seal(value: unknown) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
  }

  private unseal<T>(value: string): T | null {
    const [version, iv, tag, ciphertext] = value.split(":");
    if (version !== "v1" || !iv || !tag || !ciphertext) return null;

    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key(),
        Buffer.from(iv, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
      return JSON.parse(plaintext) as T;
    } catch {
      return null;
    }
  }

  private cookie(name: string, value: string, maxAge: number) {
    return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
  }

  private clearCookie(name: string) {
    return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  }
}

export const createSharedAuthProvider = (config: SharedAuthConfig) => {
  return new SharedAuthProvider(config);
};

const parseCookie = (header: string) => {
  const result = new Map<string, string>();
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (!name || value.length === 0) continue;
    result.set(name, decodeURIComponent(value.join("=")));
  }
  return result;
};
