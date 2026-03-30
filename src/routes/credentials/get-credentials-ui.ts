import type { FastifyInstance } from "fastify";

import { parseBoolean } from "../shared/ui-auth.js";
import type { UiRouteDependencies } from "../types.js";
import type { CredentialRouteContext } from "./context.js";
import { resolveCredentialRoutePath, type CredentialRouteOptions } from "./prefix.js";
import { listVisibleProviders } from "./visible-accounts.js";

export async function registerGetCredentialsUiRoute(
  app: FastifyInstance,
  deps: UiRouteDependencies,
  ctx: CredentialRouteContext,
  options?: CredentialRouteOptions,
): Promise<void> {
  app.get<{ Querystring: { readonly reveal?: string } }>(resolveCredentialRoutePath("/credentials", options), async (request, reply) => {
    const reveal = parseBoolean(request.query.reveal);
    const providers = await listVisibleProviders({
      credentialStore: ctx.credentialStore,
      keyPool: deps.keyPool,
      revealSecrets: reveal,
    });
    const requestLogSummary = deps.requestLogStore.providerSummary();
    const keyPoolStatuses = await deps.keyPool.getAllStatuses().catch(() => ({}));

    reply.send({
      providers,
      keyPoolStatuses,
      requestLogSummary,
    });
  });
}
