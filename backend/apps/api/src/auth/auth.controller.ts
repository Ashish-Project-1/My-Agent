import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import {
  type AuthSessionResponse,
  LoginRequest,
  REFRESH_COOKIE,
  RegisterRequest,
} from "@ua/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Principal } from "../common/principal.js";
import { CurrentPrincipal } from "../common/principal.js";
import { Public } from "../common/public.decorator.js";
import { requestMeta } from "../common/request-meta.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import type { AppConfig } from "../config.js";
import { CONFIG } from "../config.module.js";
// Value import: Nest reads the injected token from decorator metadata.
import { AuthService } from "./auth.service.js";
import { clearSessionCookies, setSessionCookies } from "./session-cookies.js";

/**
 * Auth HTTP surface (docs/planning/07 §3.1).
 *
 * Cookies are the default credential; the body carries it too for native clients,
 * but the session cookie is always issued. CSRF is enforced on unsafe methods.
 */
@Controller("v1")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post("auth/register")
  @HttpCode(201)
  async register(
    @Body(new ZodValidationPipe(RegisterRequest)) body: RegisterRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponse> {
    const issued = await this.auth.register(body, requestMeta(request, this.config));
    setSessionCookies(reply, this.config, issued);
    return issued.body;
  }

  @Public()
  @Post("auth/login")
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(LoginRequest)) body: LoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponse> {
    const issued = await this.auth.login(body, requestMeta(request, this.config));
    setSessionCookies(reply, this.config, issued);
    return issued.body;
  }

  @Public()
  @Post("auth/refresh")
  @HttpCode(200)
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponse> {
    const meta = requestMeta(request, this.config);
    const presented = request.cookies[REFRESH_COOKIE];
    const issued = await this.auth.refresh(presented, meta);
    setSessionCookies(reply, this.config, issued);
    return issued.body;
  }

  @Post("auth/logout")
  @HttpCode(204)
  async logout(
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const meta = requestMeta(request, this.config);
    await this.auth.logout(principal, meta);
    clearSessionCookies(reply, this.config);
  }

  @Get("me")
  async me(@CurrentPrincipal() principal: Principal) {
    return this.auth.currentUser(principal);
  }
}
