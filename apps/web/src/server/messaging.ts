import "server-only";
import { lazyEnv } from "@website/config/env";
import { createSqlMessageLog } from "@website/db/sql";
import { createMessenger } from "@website/domain/messaging";
import { createResendSender, emailChannel, wahaChannel } from "@website/email";
import { webDb } from "./db";
import { getWebEnv } from "./env";

export const messenger = lazyEnv(() => {
  const env = getWebEnv();
  return createMessenger({
    log: createSqlMessageLog(webDb()),
    channels: {
      email: emailChannel(
        env.RESEND_API_KEY ? createResendSender({ apiKey: env.RESEND_API_KEY }) : null,
        env.EMAIL_FROM_TRANSACTIONAL,
      ),
      // only the recruitment group notices (step 11.8) use it
      whatsapp: wahaChannel(
        env.WAHA_BASE_URL && env.WAHA_API_KEY
          ? { baseUrl: env.WAHA_BASE_URL, apiKey: env.WAHA_API_KEY, session: env.WAHA_SESSION }
          : null,
      ),
    },
    mode: env.MESSAGING_MODE,
    appEnv: env.APP_ENV,
    testRecipients: env.MESSAGING_TEST_RECIPIENTS,
    now: () => new Date(),
  });
});
