import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { MastraAuthProvider } from "@mastra/core/server";
import type {
  ISSOProvider,
  ISessionProvider,
  Session,
  User,
} from "@mastra/core/auth";
import type { HonoRequest } from "hono";

export interface MastraAuthRealmOptions {
  authUrl?: string;
  realm?: string;
  sessionSecret?: string;
  name?: string;
}

type NormalizedConfig = {
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

type AuthFlow = {
  redirectUri: string;
  state: string;
  stateId: string;
};

const MASTRA_SESSION_COOKIE = "mastra-token";
const AUTH_FLOW_COOKIE = "fnpc-auth-flow";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const FLOW_MAX_AGE_SECONDS = 10 * 60;

export class MastraAuthRealm
  extends MastraAuthProvider<SharedAuthUser>
  implements ISSOProvider<SharedAuthUser>, ISessionProvider<SharedAuthSession>
{
  readonly isSimpleAuth = true;

  private readonly config: NormalizedConfig;
  private readonly authOrigin: string;
  private readonly project: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private callbackCookieHeader = "";

  constructor(options: MastraAuthRealmOptions = {}) {
    super({ name: options.name ?? "realm-auth" });

    const { authUrl, realm } = resolveAuthTarget(options);
    const sessionSecret =
      options.sessionSecret ?? process.env.AUTH_SESSION_SECRET;
    if (!sessionSecret) {
      throw new Error(
        "A session secret is required: pass `sessionSecret` or set AUTH_SESSION_SECRET.",
      );
    }

    const issuer = `${authUrl}/api/${realm}`;
    const baseUrl = `${issuer}/auth`;

    this.authOrigin = new URL(authUrl).origin;
    this.project = realm;
    this.config = {
      baseUrl,
      jwksUrl: `${baseUrl}/.well-known/jwks.json`,
      issuer,
      audience: [realm, issuer].join(","),
      sessionSecret,
    };
    this.jwks = createRemoteJWKSet(new URL(this.config.jwksUrl));
  }

  getLoginButtonConfig() {
    return {
      provider: "realm-auth",
      text: "Sign in",
      description: "Sign in to access FNPC Studio.",
    };
  }

  getLoginUrl(redirectUri: string, state: string) {
    const loginUrl = new URL(`/login/${this.project}`, this.authOrigin);
    loginUrl.searchParams.set("redirect_uri", redirectUri);
    loginUrl.searchParams.set("state", state);
    loginUrl.searchParams.set("mode", "login");
    loginUrl.searchParams.set(
      "code_challenge",
      this.pkceChallenge(redirectUri, state),
    );
    loginUrl.searchParams.set("code_challenge_method", "S256");
    return loginUrl.toString();
  }

  getLoginCookies(redirectUri: string, state: string) {
    return [
      this.cookie(
        AUTH_FLOW_COOKIE,
        this.seal({ redirectUri, state, stateId: this.stateId(state) }),
        FLOW_MAX_AGE_SECONDS,
      ),
    ];
  }

  setCallbackCookieHeader(cookieHeader: string | null) {
    this.callbackCookieHeader = cookieHeader ?? "";
  }

  async handleCallback(code: string, state: string) {
    const flow = this.unseal<AuthFlow>(
      parseCookie(this.callbackCookieHeader).get(AUTH_FLOW_COOKIE) ?? "",
    );
    if (!flow || flow.stateId !== state) {
      throw new Error("Invalid auth flow");
    }

    const response = await fetch(this.realmApiUrl("/login/token"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        redirect_uri: flow.redirectUri,
        code_verifier: this.pkceVerifier(flow.redirectUri, flow.state),
      }),
    });

    if (!response.ok) {
      throw new Error(`Auth token exchange failed with ${response.status}`);
    }

    const payload = await response.json().catch(() => null);
    const authCookie =
      typeof payload?.sessionCookie === "string" ? payload.sessionCookie : "";
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

    const cookieHeader = requestHeader(request, "cookie");
    const sessionCookie =
      token || parseCookie(cookieHeader).get(MASTRA_SESSION_COOKIE) || "";
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
    const authCookie =
      typeof metadata?.authCookie === "string" ? metadata.authCookie : "";
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

  async destroySession(sessionId: string) {
    const session = await this.validateSession(sessionId);
    if (!session?.authCookie) return;

    try {
      await fetch(this.authApiUrl("/sign-out"), {
        method: "POST",
        headers: { Cookie: session.authCookie },
      });
    } catch {
      return;
    }
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
    return (
      parseCookie(request.headers.get("cookie") ?? "").get(
        MASTRA_SESSION_COOKIE,
      ) ?? null
    );
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
    return new Bun.CryptoHasher("sha256", this.config.sessionSecret)
      .update(`fnpc:pkce:${redirectUri}:${state}`)
      .digest("base64url");
  }

  private pkceChallenge(redirectUri: string, state: string) {
    return new Bun.CryptoHasher("sha256")
      .update(this.pkceVerifier(redirectUri, state))
      .digest("base64url");
  }

  private stateId(state: string) {
    return state.split("|", 1)[0] ?? state;
  }

  private key() {
    return new Bun.CryptoHasher("sha256")
      .update(this.config.sessionSecret)
      .digest();
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

const resolveAuthTarget = (options: MastraAuthRealmOptions) => {
  const explicitUrl = options.authUrl ?? process.env.AUTH_URL;
  const explicitRealm = options.realm ?? process.env.AUTH_REALM;
  if (explicitUrl && explicitRealm) {
    return { authUrl: explicitUrl.replace(/\/+$/, ""), realm: explicitRealm };
  }

  const baseUrl = process.env.AUTH_BASE_URL;
  if (baseUrl) {
    const url = new URL(baseUrl);
    const match = url.pathname.match(/^\/api\/([^/]+)\/auth\/?$/);
    if (match) {
      return { authUrl: url.origin, realm: explicitRealm ?? match[1] };
    }
  }

  throw new Error(
    "Auth target is required: set `authUrl`+`realm` (or AUTH_URL+AUTH_REALM), " +
      "or AUTH_BASE_URL=https://host/api/<realm>/auth.",
  );
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

const requestHeader = (request: HonoRequest | Request, name: string) => {
  if ("header" in request && typeof request.header === "function") {
    return request.header(name) ?? "";
  }
  if ("headers" in request && typeof request.headers?.get === "function") {
    return request.headers.get(name) ?? "";
  }
  return "";
};
